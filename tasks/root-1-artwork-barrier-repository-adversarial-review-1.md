# Root 1 Artwork Barrier Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

Move artwork/audio barrier readiness and notify SQL out of
`workflows/artwork-barrier.js` into `database/artwork-barrier-repository.js`.
The workflow keeps LISTEN listener lifecycle, polling/backoff, timeouts,
fallback behavior, logging, and public exports used by tests.

## Changed Files

- `src/database/artwork-barrier-repository.js`
  - Added `isArtworkReady()` and `notifyArtworkReady()` plus SQL constants.
  - Centralized artwork-ready boolean normalization.
- `src/workflows/artwork-barrier.js`
  - Delegates readiness checks and PG notify calls to the repository.
- `test/artwork-barrier-repository.test.js`
  - Added repository characterization for readiness normalization, missing rows,
    and notify payloads.

## Attack Vectors Reviewed

1. Existing polling behavior must still return immediately when artwork is ready.
2. Polling sequence must still sleep between false checks.
3. Query failures must still release audio without artwork.
4. PG LISTEN setup must still race-cover missed notifications with an initial
   row check.
5. Deadline recheck must still catch dropped notifications.
6. Deadline recheck query failures must still resolve false rather than hang.
7. Non-Postgres notify remains a no-op.
8. Postgres notify failures remain best-effort and do not throw.
9. Ready normalization must preserve PG booleans, SQLite integers, and string
   shims.
10. Existing `SQL_CHECK_ARTWORK_READY` export remains stable for tests.

## Findings

No P0 or P1 findings.

### P2-1 — Barrier still depends on process-local LISTEN state

VERIFIED. The repository extraction did not change the singleton listener
lifecycle. If the PG listener client errors, the workflow falls back to polling
only after setup/recheck paths notice. This is existing behavior and remains
acceptable for this Root 1 persistence slice.

## Validation

- `node --check src/database/artwork-barrier-repository.js`
- `node --check src/workflows/artwork-barrier.js`
- `node --check test/artwork-barrier-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 --test-reporter=dot test/artwork-barrier-repository.test.js test/workflows/artwork-barrier.test.js test/artwork-job-repository.test.js`

