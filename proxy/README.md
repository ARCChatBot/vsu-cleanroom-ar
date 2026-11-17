# MI-CHIPS AI proxy

A tiny Cloudflare Worker that lets everyone use the web app's AI analyst **without entering their own API key**. Your Anthropic key is stored as a Worker secret on Cloudflare and never reaches the browser.

## What it allows

- Only requests from the sites in `ALLOWED_ORIGINS`. By default that's the GitHub Pages site and the local dev server.
- Only `POST /v1/messages`, without streaming.
- Only the model the app uses (`claude-opus-5-5`), with `max_tokens` capped at 16,000.

Anyone who opens the site can still spend your API credit through the analyst. Set a **monthly spend limit** in the Anthropic Console for the key you use here, and consider a dedicated key or workspace for the class.

## Deploy (about 5 minutes)

You need a free Cloudflare account and Node.js.

1. Log in to Cloudflare:

   ```bash
   npx wrangler login
   ```

2. From this folder, store your Anthropic API key as a secret (you'll be prompted to paste it):

   ```bash
   cd proxy
   ```

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

3. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Wrangler prints a URL such as `https://michips-ai-proxy.<your-subdomain>.workers.dev`.

4. In the web app, open **AI settings**, paste that URL into **proxy URL**, leave the API key empty, tick **Remember on this device**, and click **Save**.

If you host the app somewhere else, add that origin to `ALLOWED_ORIGINS` in `wrangler.toml` and run `npx wrangler deploy` again.

## Check it

```bash
curl -i -X OPTIONS https://michips-ai-proxy.<your-subdomain>.workers.dev/v1/messages -H "Origin: https://arcchatbot.github.io" -H "Access-Control-Request-Method: POST"
```

A `204` response with `Access-Control-Allow-Origin` means CORS is set up correctly. Then ask the analyst a question in the app.
