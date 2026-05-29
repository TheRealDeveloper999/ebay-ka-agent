# eBay KA Agent — Claude instructions

## Stack
Node 21 (v21.6.1) / Express 4 / Nunjucks / SQLite (better-sqlite3) / HTMX 2 / Playwright.
Run scripts with: `~/.nvm/versions/node/v21.6.1/bin/node <script>`
Dev server: `~/.nvm/versions/node/v21.6.1/bin/node src/server.js`

## Hard rules (learned from past failures)

### Node version
`better-sqlite3` is compiled against v21. Never run project scripts with the system Node (v26) — you get `ERR_DLOPEN_FAILED`. Always use `~/.nvm/versions/node/v21.6.1/bin/node`.

### Server restart
After any change to `src/app.js` globals (Nunjucks `addGlobal`, `addFilter`) or route registration, do a **full process restart** — not just `--watch` hot-reload. The `--watch` flag can serve a mix of old and new module state and produce confusing runtime errors (`recentItems.some is not a function`, undefined globals in templates).

### Nunjucks globals / lookup map keys
Keys in a lookup map (like `GPU_SCORES`) must match what comes **out** of the normalization function, not what goes in. Example: `normalizeGpu` strips `'arc'`, so the key must be `'a770'`, not `'arc a770'`. Unreachable keys fail silently.

### PAGE_SIZE
`PAGE_SIZE` must be divisible by the grid column count (currently 5). Otherwise one row is always visually incomplete and looks like a missing item.

### AI extraction — no server-side normalization
Do not add server-side regex post-processing of AI output. The AI (qwen3-235b-a22b-2507 via OpenRouter) is responsible for producing clean structured JSON. Fix quality issues by improving the prompt, not by adding normalization on top.

### OpenRouter model names
Use the exact model string from OpenRouter — no `:free` suffix unless the model page explicitly shows it. Wrong suffix returns HTTP 404 "No endpoints found".

### Queue race conditions
Any `INSERT ... ON CONFLICT DO UPDATE` that resets queue status must include `WHERE extract_queue.status != 'processing'` to avoid clobbering in-flight workers.

### Passing data through on re-queue
When a route re-enqueues an item and re-renders a partial, always pass the **existing** extracted data (specs, etc.) through the response. Never hardcode `null` — that blanks the UI until the next extraction completes.

## AI model
`OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507`
Key rotation: multiple keys in `.env` as `OPENROUTER_API_KEY_1`, `_2`, `_3`. Never log or expose keys.

## Scoring
`src/lib/scorer.js` — GPU scores are PassMark G3D Mark normalized to RTX 4090 = 100.
`normalizeGpu` strips brands (`nvidia geforce amd radeon intel arc`) **and** model prefixes (`rtx gtx rx`), so `GPU_SCORES` keys are bare (`'3070'`, `'6700 xt'`, `'a770'`).
Longest-key-first match resolves suffix variants (`'3060 ti'` over `'3060'`).
