codexp, I inspected the project, ran syntax/audit/smoke checks, and reviewed the main architecture.

This version keeps only currently relevant / not-yet-fixed improvement points. Items already implemented in the current commits were removed from the recommendation list.

Checks run / current validation status:
- JS syntax check with Node v21.6.1: OK
- npm test: OK placeholder only (`No tests yet`)
- npm audit --omit=dev: 0 vulnerabilities after node-cron upgrade
- Inline source-form script parse check: OK
- Fresh temp-DB smoke initially exposed a schema drift bug: `extract_queue.worker_id` / `claimed_at` were used by the worker but missing from `schema.sql`. This was fixed by adding those columns to the fresh schema.
- Current DB quick stats from local DB:
  - sources: 2
  - live items: 134
  - snapshots: 178
  - changes: 179
  - queue entries: 149
  - failed queue: 0
- Codebase size excluding node_modules/data:
  - JS: 23 files / ~2000 lines
  - Nunjucks: 19 files / ~921 lines
  - CSS: ~480 lines
  - SQL: 98 lines

Top remaining improvements, prioritized:

1. Fix source/listing identity model

Current schema has:

src/db/schema.sql:43
UNIQUE(provider, external_id)

src/scraper/index.js:47-58 inserts/upserts by provider+external_id but does not update source_id.

Problem:
If the same Kleinanzeigen listing appears in two sources, there is only one item row. It stays attached to the first source_id. The second source scrape can create snapshots/changes with source_id = second source, but the item itself still joins to the first source in dashboards/details. Removal logic also queries by item.source_id, so source-specific availability/counting can drift.

Better:
Use one of these models:

Option A, simple:
- UNIQUE(source_id, provider, external_id)
- Same listing can exist once per source.

Option B, cleaner:
- items: unique provider/external_id listing entity
- source_items: source_id, item_id, first_seen_at, last_seen_at, removed_at, is_hidden
- Source-specific lifecycle lives in source_items.

Given this is a monitor, I’d probably choose B if you expect overlapping sources.

2. Add real tests before the project grows further

`package.json` now has scripts, but `npm test` is still a placeholder.

High-value low-effort test targets:
- src/lib/scorer.js
  - normalizeGpu
  - scoreGpu longest match
  - specLine JSON parsing
- src/scraper/listingPage.js price parsing/filtering
- src/scraper/differ.js
- src/routes/sources.js validation
- src/lib/extract-queue.js state transitions
- fresh DB migration/schema smoke boot

Recommended stack:
- node:test built-in + assert
- supertest for Express route smoke tests
- one temp SQLite DB per test using DB_PATH=/tmp/...

3. Use an API response schema / validate AI output

src/lib/extractor.js:144-151 currently extracts first JSON-ish object with regex and JSON.parse.

Problems:
- No schema validation.
- Greedy brace regex can misparse if the model returns extra brace-containing text.
- Bad fields can flow into scoring/UI silently.

Better:
- If OpenRouter model supports it, send response_format: { type: "json_object" } or JSON schema.
- Validate fields after parse with a small local validator.
- Keep the “no server-side normalization” rule, but validation/rejection is not normalization. Bad output should become MODEL_ERROR and retry/fail cleanly.

4. Align OpenRouter defaults/docs

CLAUDE.md says:
OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507
multiple keys as OPENROUTER_API_KEY_1, _2, _3

Code/.env.example says:
src/lib/extractor.js:42
OPENROUTER_API_KEYS or OPENROUTER_API_KEY

src/lib/extractor.js:159
default nvidia/nemotron-nano-9b-v2:free

.env.example:9-12 same.

This mismatch will confuse future you/agents.

Fix:
- Pick one convention.
- I’d update code to support both:
  - OPENROUTER_API_KEYS comma-separated
  - OPENROUTER_API_KEY
  - OPENROUTER_API_KEY_1..N
- Change default/example model to qwen/qwen3-235b-a22b-2507 if that’s the intended production model.

5. Add useful DB indexes before dashboard/queue grow

Current queries likely fine for 134 live items, but these will matter later:

src/routes/dashboard.js:
- WHERE removed_at IS NULL AND is_hidden = 0 ORDER BY score DESC, first_seen_at DESC
- date(first_seen_at) = date('now')
- changes date(detected_at)

src/lib/extract-queue.js:
- WHERE status='pending' AND next_attempt_at <= datetime('now') ORDER BY created_at

Recommended indexes:
- items(removed_at, is_hidden, score DESC, first_seen_at DESC)
- extract_queue(status, next_attempt_at, created_at)
- changes(detected_at, change_type)
- maybe items(source_id, removed_at, last_seen_at) for removal scan

6. Add README / operational docs

There is no README.

Minimum useful README:
- Node version requirement
- npm install
- Playwright browser install if needed
- .env setup
- run dev/server/scrape
- DB path and backup note
- known bot-block/CAPTCHA behavior
- queue behavior and OpenRouter key rotation

7. Avoid vendored/minified htmx in grep/static checks or document it

public/js/htmx.min.js is committed. That’s acceptable for a small local app, but it pollutes searches and syntax/static scans.

Options:
- Keep it, but exclude in check scripts.
- Or install htmx.org via npm and copy in build/postinstall.
- Or use CDN if offline/local isn’t required.

Suggested next implementation order:

1. Add real tests around scorer, source validation, queue, and fresh DB smoke boot.
2. Align OpenRouter config/defaults and add output validation.
3. Decide item/source identity model before adding more data/features. This is the big architectural one.
4. Add DB indexes after checking query plans on the real DB size.
5. Add README / operational docs.
