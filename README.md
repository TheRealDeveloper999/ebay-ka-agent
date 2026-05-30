# eBay KA Agent

Local eBay Kleinanzeigen monitor for saved search/source URLs. It scrapes listings, tracks snapshots and changes, extracts PC specs via OpenRouter, scores listings, and exposes a small HTMX/Nunjucks dashboard.

## Stack

- Node.js `21.6.1`
- Express 4
- Nunjucks
- SQLite via `better-sqlite3`
- Playwright
- HTMX 2

`better-sqlite3` is compiled against Node 21 in this checkout. Use the project wrapper for direct node commands:

```sh
./bin/node <script>
```

Do not run project scripts with a different system Node if native modules were installed under Node 21.

## Setup

```sh
npm install
cp .env.example .env
npx playwright install chromium
```

Then edit `.env`.

Minimum useful local config:

```env
PORT=3000
DB_PATH=./data/ka-agent.db
PLAYWRIGHT_HEADLESS=true
MAX_PAGES_PER_SOURCE=3
MIN_SCRAPE_INTERVAL_MINUTES=5
OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507
```

OpenRouter keys are optional for scraping/listing tracking, but required for AI spec extraction and scoring. Supported key styles:

```env
# Pick one style and use it consistently.
OPENROUTER_API_KEYS=key1,key2,key3
OPENROUTER_API_KEY=single-key
OPENROUTER_API_KEY_1=key1
OPENROUTER_API_KEY_2=key2
OPENROUTER_API_KEY_3=key3
```

Keys rotate automatically when a key hits a daily limit. Never commit real keys.

## Run

Start the web app, scheduler, and extraction queue:

```sh
./bin/node src/server.js
```

Open:

```text
http://localhost:3000
```

Useful pages:

- `/` — dashboard with live items and recent changes
- `/sources` — add/edit/toggle/scrape sources
- `/changes` — recent changes feed
- `/queue` — AI extraction queue and key status

## Scraping

Sources are Kleinanzeigen search/category URLs managed from `/sources`.

Each source supports:

- name
- URL
- active flag
- scrape interval in minutes
- optional keyword filter
- optional min/max price filters

Manual scrape for a source from the CLI:

```sh
./bin/node src/scraper/cli.js <sourceId>
```

The server also schedules active sources automatically. Scrape intervals are anchored to `last_scraped_at` and respect `MIN_SCRAPE_INTERVAL_MINUTES`.

### Bot-blocking / CAPTCHA notes

Kleinanzeigen may throttle, block, or present CAPTCHA/interstitial pages. Keep `MAX_PAGES_PER_SOURCE` conservative, avoid very low scrape intervals, and expect occasional scrape failures. Use the source status/errors in the UI to diagnose.

## AI extraction and scoring

When a listing has a description and no extracted specs yet, it is queued for OpenRouter extraction.

Extraction contract:

- default model: `qwen/qwen3-235b-a22b-2507`
- JSON-only output is requested
- output is locally validated
- malformed/ambiguous/invalid output becomes a model error and is retried/failed cleanly
- do not add server-side regex normalization for model output; improve the prompt/contract instead

Scoring is implemented in `src/lib/scorer.js`. GPU scores are normalized to RTX 4090 = `100`, with RAM/CPU bonuses on top.

## Database

Default DB path:

```text
./data/ka-agent.db
```

SQLite runs with WAL mode and foreign keys enabled. The app runs schema setup on boot via `src/db/migrate.js` / `src/db/schema.sql`.

For local backups, stop the server or use SQLite's backup tooling, then copy:

```sh
cp data/ka-agent.db data/ka-agent.backup.$(date +%Y%m%d-%H%M%S).db
```

The current schema stores `items` as unique by `(provider, external_id)`. If overlapping sources matter, the next architectural improvement should be a `source_items` lifecycle table before adding more source-specific dashboard behavior.

## Development

Syntax check:

```sh
./bin/node --check public/js/app.js
find src -name '*.js' -print0 | xargs -0 -n1 ./bin/node --check
```

Tests:

```sh
./bin/node --test test/*.test.js
```

Equivalent npm scripts exist, but make sure the shell is using Node `21.6.1` before running them:

```sh
npm run check:syntax
npm test
npm run audit
```

Development server:

```sh
NODE_ENV=development ./bin/node src/server.js
```

There is also an npm `dev` script using `node --watch`, but after changes to `src/app.js` globals/filters or route registration, do a full process restart. Watch mode can serve mixed old/new module state.

## Project layout

```text
src/app.js                 Express app, routes, Nunjucks globals
src/server.js              server boot, scheduler, extraction queue
src/db/schema.sql          SQLite schema
src/scraper/               Playwright scraping and diffing
src/lib/extract-queue.js   AI extraction queue
src/lib/extractor.js       OpenRouter integration and validation
src/lib/scorer.js          spec formatting and item score
src/routes/                dashboard, source, item, queue routes
views/                     Nunjucks pages and partials
public/                    CSS, app JS, vendored htmx
```

## Checks before commit

Follow `precommit.md` for the full checklist. Short version:

1. Preserve any existing git index/changelists.
2. Make atomic commits.
3. Use Node `21.6.1` / `./bin/node`.
4. Run syntax checks and tests.
5. Browser-verify UI changes.
