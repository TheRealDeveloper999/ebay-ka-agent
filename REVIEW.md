codexp, I inspected the project, ran syntax/audit/smoke checks, and reviewed the main architecture.

This version keeps only currently relevant / not-yet-fixed improvement points. Items already implemented in the current commits were removed from the recommendation list.

Checks run at the time of the review:
- JS syntax check passed
- `npm test` passed (`126` tests)
- npm audit --omit=dev: 0 vulnerabilities after node-cron upgrade
- Inline source-form script parse check: OK
- Fresh temp-DB smoke initially exposed a schema drift bug: `extract_queue.worker_id` / `claimed_at` were used by the worker but missing from `schema.sql`. This was fixed by adding those columns to the fresh schema and is now covered by `test/db-queue.test.js`.
- Current DB quick stats from local DB at review time:
  - sources: 2
  - live items: 134
  - snapshots: 178
  - changes: 179
  - queue entries: 149
  - failed queue: 0
- Codebase size excluding node_modules/data at review time:
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

2. Keep tests targeted as new behavior is added

The project now has a useful `node:test` suite (`126` tests at the time of this review), covering:
- `src/lib/scorer.js`
  - `normalizeGpu`
  - `scoreGpu` longest match
  - `scoreItem`
  - `specLine` JSON parsing/formatting
- `src/scraper/listingPage.js` price parsing/filtering
- `src/scraper/differ.js`
- `src/routes/sources.js` validation
- `src/lib/extract-queue.js` state transitions and race-condition safety
- fresh DB schema smoke checks
- item image/card rendering helpers
- scheduler interval anchoring

Remaining test priority:
- Add source/listing identity tests before changing that model.
- Add route/integration smoke around dashboard/details if templates become more complex.
- Keep using one temp SQLite DB per DB test via `DB_PATH=/tmp/...`.

3. Keep AI extraction contract strict

Implemented now:
- `src/lib/extractor.js` uses its default model when `OPENROUTER_MODEL` is unset.
- `.env` supports comma-separated `OPENROUTER_API_KEYS`, single `OPENROUTER_API_KEY`, and numbered `OPENROUTER_API_KEY_1..N` conventions.
- OpenRouter requests JSON-only output.
- Model output is locally validated and malformed/ambiguous/missing/extra/invalid fields become model errors instead of silently flowing into scoring/UI.

Keep the existing rule: validation is OK, server-side normalization is not. If extraction quality is bad, improve the prompt/contract rather than regex-fixing model output after the fact.

4. Add useful DB indexes before dashboard/queue grow

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

5. Add README / operational docs

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

6. Avoid vendored/minified htmx in grep/static checks or document it

public/js/htmx.min.js is committed. That’s acceptable for a small local app, but it pollutes searches and syntax/static scans.

Options:
- Keep it, but exclude in check scripts.
- Or install htmx.org via npm and copy in build/postinstall.
- Or use CDN if offline/local isn’t required.

Suggested next implementation order:

1. Add source/listing identity regression tests, then implement the chosen identity model (`source_items` if overlapping sources matter).
2. Add DB indexes after checking query plans on the real DB size.
3. Add README / operational docs.
4. Decide whether to keep vendored `public/js/htmx.min.js`, exclude it from checks, or replace it with npm/CDN handling.
