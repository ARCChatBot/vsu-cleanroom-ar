// =====================================================================================
//  MI-CHIPS AI proxy (Cloudflare Worker)
//
//  Lets every student use the AI analyst without their own API key. The Anthropic key
//  lives here as a Worker secret and never reaches the browser.
//
//  The web app's Anthropic SDK calls  POST <proxy>/v1/messages  with a placeholder key.
//  This worker:
//    • only accepts requests from the origins in ALLOWED_ORIGINS (your GitHub Pages site),
//    • only forwards POST /v1/messages,
//    • only allows the model the app uses (ALLOWED_MODELS) and caps max_tokens,
//    • swaps in the real key and forwards to api.anthropic.com,
//    • answers CORS preflights.
//
//  Setup: see proxy/README.md.  Secrets/vars:
//    ANTHROPIC_API_KEY  (secret)  your Anthropic API key
//    ALLOWED_ORIGINS    (var)     comma-separated, e.g. "https://arcchatbot.github.io,http://localhost:5173"
//    ALLOWED_MODELS     (var)     comma-separated, default "claude-opus-5-5"
//    MAX_TOKENS_CAP     (var)     default 16000
// =====================================================================================

const UPSTREAM = 'https://api.anthropic.com';
// Request headers passed through to Anthropic (everything else, including the browser's
// placeholder x-api-key and any Authorization header, is dropped).
const FORWARD_HEADERS = ['content-type', 'anthropic-version', 'anthropic-beta'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = list(env.ALLOWED_ORIGINS);
    const originOk = allowed.includes(origin);
    const cors = originOk ? corsHeaders(origin, request) : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    }
    if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') {
      return json({ error: 'only POST /v1/messages is proxied' }, 404, cors);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'proxy has no ANTHROPIC_API_KEY secret' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400, cors); }

    const models = list(env.ALLOWED_MODELS || 'claude-opus-5-5');
    if (!models.includes(body.model)) return json({ error: `model not allowed: ${body.model}` }, 400, cors);
    if (body.stream) return json({ error: 'streaming is not enabled on this proxy' }, 400, cors);
    const cap = Number(env.MAX_TOKENS_CAP || 16000);
    if (!(body.max_tokens > 0) || body.max_tokens > cap) body.max_tokens = Math.min(Number(body.max_tokens) || cap, cap);

    const headers = new Headers({ 'x-api-key': env.ANTHROPIC_API_KEY });
    for (const h of FORWARD_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const out = new Headers(cors);
    out.set('content-type', upstream.headers.get('content-type') || 'application/json');
    for (const h of ['request-id', 'retry-after']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};

function list(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function corsHeaders(origin, request) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // The SDK sends several x-stainless-* and anthropic-* headers; echo what the browser asks for.
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'content-type, anthropic-version, anthropic-beta, x-api-key',
    'Access-Control-Expose-Headers': 'request-id, retry-after',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...extra } });
}
