// =====================================================================================
//  analyst.js
//  MI-CHIPS (NSF #2606117): the voice/text "AI analyst".
//
//  1. Local command parser: unambiguous commands ("explode the wafer map", "open the
//     thermal map in 3D", "collapse all", "arrange") run instantly, offline, with no key.
//  2. Claude (claude-opus-5-5) via the official Anthropic JS SDK, loaded on demand:
//     answers questions about the data from the dataset summaries, and can drive the app
//     through tools (open / close / explode / colormap / arrange / focus).
//  3. Local analyst fallback when no AI connection is configured: summary-based answers.
//
//  Credentials. This is a public static site, so no key ships with it. Either:
//    • each user enters their own Anthropic API key (kept only in their browser), or
//    • the site points at a small proxy that holds the key server-side
//      (proxy/cloudflare-worker.js); recommended for classes.
// =====================================================================================

import { datasetContext, summarize } from './summaries.js';
import { VIEW_KINDS } from '../data/datasets.js';
import { COLORMAPS } from '../render/colormap.js';

const MODEL = 'claude-opus-5-5';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const SETTINGS_KEY = 'michips.ai.settings';

// ---------------------------------------------------------------------------------
//  Settings (stored only in this browser)
// ---------------------------------------------------------------------------------

export function loadSettings() {
  const read = (store) => { try { return JSON.parse(store.getItem(SETTINGS_KEY) || 'null'); } catch { return null; } };
  return read(localStorage) || read(sessionStorage) || { apiKey: '', proxyUrl: '', remember: false, speak: true };
}

export function saveSettings(s) {
  try {
    localStorage.removeItem(SETTINGS_KEY); sessionStorage.removeItem(SETTINGS_KEY);
    (s.remember ? localStorage : sessionStorage).setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* storage blocked: settings last for this page only */ }
}

export const aiConfigured = (s) => !!(s.apiKey || s.proxyUrl);

// ---------------------------------------------------------------------------------
//  Local command parsing
// ---------------------------------------------------------------------------------

const ALIASES = [
  [/wafer|sheet resistance|\br ?s\b|die map/, 'rs-wafer'],
  [/thermal|temperature|heat ?map of the die|hot ?spot|junction/, 'thermal'],
  [/electric field|e[- ]?field|\|e\||field strength/, 'tcad-e'],
  [/potential|voltage map|tcad/, 'tcad-phi'],
  [/process window|focus[- ]exposure|\bfem\b|dose|bossung|\bcd map/, 'process-window'], // not bare "focus": that's the focus-mode command
  [/control chart|spc|gate cd|critical dimension|cpk|violation/, 'spc-cd'],
  [/c[- ]?v\b|capacitance|mos cap/, 'csv-mos_cv'],
  [/i[- ]?v\b|output curve|transistor|mosfet curve|drain current/, 'iv-nmos'],
];

export function matchDataset(text, datasets) {
  const t = text.toLowerCase();
  for (const [re, id] of ALIASES) if (re.test(t) && datasets.some((d) => d.id === id)) return datasets.find((d) => d.id === id);
  // fall back to title word overlap (covers imported CSVs)
  let best = null, score = 0;
  for (const d of datasets) {
    const words = d.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const s = words.filter((w) => t.includes(w)).length;
    if (s > score) { score = s; best = d; }
  }
  return best;
}

/** Returns an action list for clear commands, or null if the utterance should go to the analyst. */
export function parseCommand(text, app) {
  const t = text.toLowerCase().trim();
  const d = matchDataset(t, app.datasets) || (/\b(this|it|that)\b/.test(t) ? app.focused?.()?.dataset : null);
  const all = /\b(all|everything|every view|views)\b/.test(t) && !d;
  const isQuestion = /^(what|why|how|where|which|when|is|are|does|do|can|could|should|explain|analy[sz]e|summari[sz]e|tell|compare|describe)\b/.test(t);

  const spec = t.match(/\b(lsl|usl|lower spec(?: limit)?|upper spec(?: limit)?)\b[^0-9-]*(-?\d+(?:\.\d+)?)/);
  if (spec) return [{ type: 'setSpec', which: /usl|upper/.test(spec[1]) ? 'usl' : 'lsl', value: Number(spec[2]), datasetId: d?.id }];
  if (/\b(exit focus|unfocus|stop focus|done|back to all|show all views)\b/.test(t)) return [{ type: 'unfocus' }];
  if (/\b(focus|zoom in on|bring .* (front|forward|center|centre))\b/.test(t) && !isQuestion) return [{ type: 'focus', datasetId: d?.id }];
  if (/\b(explode|expand|separate|pull apart|break apart)\b/.test(t) && !isQuestion) return [{ type: 'explode', target: all || !d ? 'all' : d.id, exploded: true }];
  if (/\b(collapse|unexplode|put (it )?back|reassemble)\b/.test(t)) return [{ type: 'explode', target: all || !d ? 'all' : d.id, exploded: false }];
  if (/\b(arrange|organi[sz]e|bring .* (to|around) me|gather)\b/.test(t)) return [{ type: 'arrange' }];
  if (/\bclose\b/.test(t)) return all || !d ? [{ type: 'closeAll' }] : [{ type: 'close', datasetId: d.id }];
  if (/\b(bigger|larger|enlarge|scale up|zoom in)\b/.test(t)) return [{ type: 'scale', factor: 1.3 }];
  if (/\b(smaller|shrink|scale down|zoom out)\b/.test(t)) return [{ type: 'scale', factor: 1 / 1.3 }];
  if (/\b(rotate|turn|spin)\b/.test(t)) return [{ type: 'rotate', degrees: /\bleft|counter/.test(t) ? -45 : 45 }];
  if (/\b(open|show|display|bring up|load)\b/.test(t) && d && !isQuestion) {
    const kinds = VIEW_KINDS[d.kind];
    const kind = /\b3 ?d|surface|three/.test(t) && kinds.includes('3D') ? '3D' : kinds[0];
    return [{ type: 'open', datasetId: d.id, view: kind }];
  }
  return null;
}

// ---------------------------------------------------------------------------------
//  Claude analyst
// ---------------------------------------------------------------------------------

const TOOLS = (datasets) => {
  const ids = datasets.map((d) => d.id);
  const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
  return [
    { name: 'open_view', description: 'Open a visualization of a dataset in the room.', strict: true,
      input_schema: obj({ dataset_id: { type: 'string', enum: ids }, view: { type: 'string', enum: ['Plot', '2D', '3D', '3D map', 'Chart'], description: 'field: 2D or 3D; plot: Plot; wafer: 3D map; spc: Chart' } }, ['dataset_id', 'view']) },
    { name: 'close_view', description: 'Close every open view of a dataset, or all views when dataset_id is "all".', strict: true,
      input_schema: obj({ dataset_id: { type: 'string', enum: [...ids, 'all'] } }, ['dataset_id']) },
    { name: 'explode_view', description: 'Explode (animate apart into layers for better visibility) or collapse the views of a dataset, or of all open views.', strict: true,
      input_schema: obj({ target: { type: 'string', enum: [...ids, 'all'] }, exploded: { type: 'boolean' } }, ['target', 'exploded']) },
    { name: 'set_colormap', description: 'Change the colormap of a field or wafer view.', strict: true,
      input_schema: obj({ dataset_id: { type: 'string', enum: ids }, colormap: { type: 'string', enum: COLORMAPS.map((c) => c.name) } }, ['dataset_id', 'colormap']) },
    { name: 'arrange_views', description: 'Gather all open views on an arc around the user.', strict: true, input_schema: obj({}, []) },
    { name: 'focus_view', description: 'Bring one dataset front and centre in focus mode, with a toolbar for manipulating its data. Opens it first if needed.', strict: true,
      input_schema: obj({ dataset_id: { type: 'string', enum: ids } }, ['dataset_id']) },
    { name: 'exit_focus', description: 'Leave focus mode and show all views again.', strict: true, input_schema: obj({}, []) },
    { name: 'set_spec_limit', description: 'Change the lower (lsl) or upper (usl) spec limit of the wafer map or the control chart; statistics, in-spec percentage, Cpk/Ppk and violations recompute. Non-destructive (the toolbar has Reset).', strict: true,
      input_schema: obj({ dataset_id: { type: 'string', enum: datasets.filter((d) => d.kind === 'wafer' || d.kind === 'spc').map((d) => d.id) }, limit: { type: 'string', enum: ['lsl', 'usl'] }, value: { type: 'number' } }, ['dataset_id', 'limit', 'value']) },
  ];
};

const SYSTEM = `You are the MI-CHIPS lab data analyst inside a web/AR visualization app used by microelectronics students and engineers (Valdosta State University, Operation SEMI). The user speaks to you by voice; your reply is read aloud and shown on a small panel.

How to answer:
- Answer in 2–4 short spoken sentences of plain text: no markdown, lists, symbols or tables. Lead with the finding, quote the key numbers with units, and end with one practical implication or next check when useful.
- Base every number on the dataset summaries below; if something is not in the data, say so instead of guessing. The built-in datasets are teaching-grade synthetic data, so do not present them as real tool results.
- If the user asks you to show, open, close, focus, explode, collapse, recolor or arrange visualizations, or to change a spec limit, call the matching tool, then briefly say what you did. Summaries reflect any limits the user has adjusted. When a question is about a dataset that is not open, you may open it so they can see what you describe.
- "This", "it" or "that" refers to the focused dataset named in the latest system note.

Dataset summaries:
`;

let sdkPromise = null;
async function getClient(settings) {
  sdkPromise ||= import(SDK_URL);
  const { default: Anthropic } = await sdkPromise;
  return new Anthropic({
    apiKey: settings.apiKey || 'proxy-holds-key',
    ...(settings.proxyUrl ? { baseURL: settings.proxyUrl.replace(/\/$/, '') } : {}),
    dangerouslyAllowBrowser: true, // key is the user's own (or held by the proxy); never shipped with the site
  });
}

export class Analyst {
  constructor(app) {
    this.app = app;
    this.history = []; // append-only conversation, replayed unedited
  }

  reset() { this.history = []; }

  /** Handles one utterance. Returns { text, actions } where actions were already executed. */
  async handle(utterance, settings, onStatus) {
    const cmd = parseCommand(utterance, this.app);
    if (cmd && !/\?$/.test(utterance.trim())) {
      const said = cmd.map((a) => this.app.execute(a)).filter(Boolean).join(' ');
      return { text: said || 'Done.', local: true };
    }
    if (!aiConfigured(settings)) return { text: this.localAnswer(utterance), local: true };

    onStatus?.('Thinking…');
    const client = await getClient(settings);
    const datasets = this.app.datasets;
    const focus = this.app.focused?.();
    const open = this.app.views.map((v) => `${v.dataset.id}:${v.kind}`).join(', ') || 'none';
    const messages = [
      ...this.history,
      { role: 'user', content: utterance },
      { role: 'system', content: `Focused dataset: ${focus ? focus.dataset.id : 'none'}. Open views: ${open}.` },
    ];
    const system = [{ type: 'text', text: SYSTEM + datasetContext(datasets), cache_control: { type: 'ephemeral' } }];
    const tools = TOOLS(datasets);
    const actionsSaid = [];

    for (let turn = 0; turn < 4; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system,
        tools,
        messages,
        output_config: { effort: 'low' }, // spoken, interactive replies: favour latency
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });

      if (response.stop_reason === 'refusal') return { text: 'I can’t help with that request.', local: false };
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !toolUses.length) {
        const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
        this.keep(messages);
        return { text: text || actionsSaid.join(' ') || 'Done.', local: false };
      }

      const results = toolUses.map((tu) => {
        let out;
        try { out = this.runTool(tu.name, tu.input); actionsSaid.push(out); }
        catch (e) { return { type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e.message}`, is_error: true }; }
        return { type: 'tool_result', tool_use_id: tu.id, content: out || 'ok' };
      });
      messages.push({ role: 'user', content: results }); // all results in one message
    }
    this.history = []; // tool loop didn't settle: start the next question fresh
    return { text: actionsSaid.join(' ') || 'Done.', local: false };
  }

  /**
   * History stays append-only (tool turns and system notes included): the model checks that
   * replayed history is unedited, so we never trim or rewrite it. Long conversations restart.
   */
  keep(messages) {
    this.history = messages.length > 40 ? [] : messages;
  }

  runTool(name, input) {
    const a = this.app;
    switch (name) {
      case 'open_view': return a.execute({ type: 'open', datasetId: input.dataset_id, view: input.view });
      case 'close_view': return a.execute(input.dataset_id === 'all' ? { type: 'closeAll' } : { type: 'close', datasetId: input.dataset_id });
      case 'explode_view': return a.execute({ type: 'explode', target: input.target, exploded: input.exploded });
      case 'set_colormap': return a.execute({ type: 'colormap', datasetId: input.dataset_id, colormap: input.colormap });
      case 'arrange_views': return a.execute({ type: 'arrange' });
      case 'focus_view': return a.execute({ type: 'focus', datasetId: input.dataset_id });
      case 'exit_focus': return a.execute({ type: 'unfocus' });
      case 'set_spec_limit': return a.execute({ type: 'setSpec', datasetId: input.dataset_id, which: input.limit, value: input.value });
      default: throw new Error('unknown tool ' + name);
    }
  }

  /** Offline answer from the summaries when no AI connection is configured. */
  localAnswer(utterance) {
    const d = matchDataset(utterance, this.app.datasets) || this.app.focused?.()?.dataset;
    if (!d) return 'Say a dataset name, for example "analyze the wafer map", or connect the AI analyst in AI settings for open questions.';
    const s = summarize(d);
    return `${s.headline} ${s.lines.slice(0, 2).join(' ')} For open-ended questions, connect the AI analyst in AI settings.`;
  }
}
