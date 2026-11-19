# Precommit instructions

Use this checklist before committing, pushing, or saying the project is ready.

## Critical rules

1. Preserve the current git index exactly.
   - Do not run `git reset`, `git restore --staged`, or any command that unstages existing staged files unless codexp explicitly asks.
   - Already staged files may belong to PhpStorm changelists; unstaging can lose that relation.
   - Avoid broad `git add -A`. Stage explicit files or hunks only.

2. Keep commits atomic at chunk/hunk level.
   - One logical concern per commit.
   - If the commit message needs “and”, split the commit.
   - Keep mechanical formatting/renames separate from behavioral changes unless inseparable.
   - Tests should normally be committed with the behavior they verify.

3. Use the project Node version.
   - Required Node: `v26.13.1`.
   - Prefer:

     ```bash
     bash -lc 'source ~/.nvm/nvm.sh && nvm use >/dev/null && <command>'
     ```

## Required checks

Run these from the repository root with Node `v26.13.1`:

```bash
bash -lc 'source ~/.nvm/nvm.sh && nvm use >/dev/null && npm run check:syntax && npm test'
```

Expected result:

- `npm run check:syntax` exits 0.
- `npm test` exits 0.
- All Node tests pass.

## UI change verification

For changes touching `public/`, `views/`, dashboard/card layout, mobile layout, or browser JS:

1. Run the required checks above.
2. Start or reuse the dev server on port 3017.
3. Verify the affected page in a browser.
4. For mobile/layout changes, verify a narrow viewport when practical.
5. Report concrete browser evidence, not just “looks fine”. Examples:
   - computed position/style values
   - element exists in expected container
   - screenshot path
   - no console errors

## Server restart rule

After changes to `src/app.js` globals/filters or route registration, do a full process restart. Do not rely on `node --watch`; it can serve mixed old/new module state.

## Secret/runtime-file safety

Never commit unless explicitly requested:

- `.env` or API keys
- SQLite DB files, WAL/SHM files
- logs
- generated caches
- local-only runtime artifacts

Before committing, inspect:

```bash
git status --short --branch
git diff --cached --name-status
git diff --name-status
```

## Commit reporting

After committing, report compactly:

- commit hash and message
- verification commands and outcomes
- final `git status --short --branch`
- any remaining unstaged/staged files, if present
