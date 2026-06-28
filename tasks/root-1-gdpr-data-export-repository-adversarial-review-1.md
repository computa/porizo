# Root 1 GDPR Data Export Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `gdpr-data-export-repository.js` for active-user lookup and allowlisted
  GDPR data-export section reads.
- Replaced direct `auth-service.js` SQL for `exportUserData()` with repository
  calls.

## Boundary

This slice intentionally does not move export envelope construction, redaction
policy, timestamp generation, section naming, or route/audit behavior. The
repository owns persistence reads only; `auth-service.js` remains the owner of
what data is safe to return to the user.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The active-user check still excludes soft-deleted users
  before export data is read.
- **P2 VERIFIED:** Export section failures still degrade to a per-section
  `{ error: "unavailable: ..." }` entry instead of aborting the entire export.
- **P2 VERIFIED:** Redaction remains service-owned and runs after repository
  rows are returned, so credentials/provider internals are not exposed by the
  new repository boundary.

## Risks Checked

- **Privacy boundary:** repository methods are user-id scoped and do not accept
  arbitrary SQL or section names from callers.
- **Behavior drift:** `auth-service.exportUserData()` still returns the same
  `{ export_format, generated_at, user_id, data }` shape and preserves the
  existing redaction list.
- **DB portability:** queries remain simple adapter-compatible `?`
  placeholders; missing table/column behavior is intentionally isolated per
  section.
- **Agent resource management:** no new subagents were launched because
  inherited agent sessions remain stale/unmanaged; bounded local parallel
  commands were used instead.

## Validation

- `node --check src/database/gdpr-data-export-repository.js`
- `node --check src/services/auth-service.js`
- `node --check test/gdpr-data-export-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/gdpr-data-export-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `npm run lint`
- Targeted grep confirmed `auth-service.js` now exposes only repository
  transaction calls for persistence access.
- `git diff --check -- src/services/auth-service.js src/database/gdpr-data-export-repository.js test/gdpr-data-export-repository.test.js`
