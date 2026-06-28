# Root 1 Auth Rate Limit Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-rate-limit-repository.js` for auth-keyed rate-limit DB writes,
  sliding-window reads, stale auth-limit cleanup, and the in-memory fast-path
  cache.
- Replaced route-local `rate_limits` SQL in `routes/auth.js` with repository
  calls.
- Preserved route-owned auth policy: endpoint-specific keys, limits, windows,
  `Retry-After`/error response shape, and fail-closed selection for signup and
  login.
- Preserved the test helper contract for `clearRateLimits(db)` by clearing the
  active route repository cache plus the provided DB.

## Boundary

This slice intentionally does not unify the remaining non-auth rate limiters in
`server.js` or enrollment flows, change public auth error envelopes, alter
signup/login fail-closed policy, or redesign the sliding-window algorithm. It
only moves auth route rate-limit persistence and cache ownership behind a
repository boundary.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The repository still increments the in-memory fast-path
  before the DB authority check, preserving the pre-existing behavior where an
  over-limit DB rollback does not also roll back the in-memory counter.
- **P2 VERIFIED:** `clearRateLimits(db)` clears both the active in-memory cache
  and auth-prefixed DB rows, preserving the test/reset contract.

## Risks Checked

- **Credential endpoint outage behavior:** signup/login still fail closed on DB
  rate-limit errors through `{ failClosed: true }`.
- **Non-credential endpoint outage behavior:** all other auth route callers
  still fail open after the in-memory fast path passes.
- **Sliding-window compatibility:** DB insert/update, current-window read,
  previous-window read, weighted count calculation, and DB rollback on denial
  are unchanged except for repository ownership.
- **Route cleanup:** direct `rate_limits` SQL and the route-owned
  `isRateLimited`/`rateLimits` cache are gone from `routes/auth.js`.
- **Agent resource management:** no new subagents were launched because two
  inherited agent sessions timed out and `close_agent` previously stalled; local
  bounded parallel commands were used instead.

## Validation

- `node --check src/database/auth-rate-limit-repository.js`
- `node --check src/routes/auth.js`
- `git diff --check -- src/routes/auth.js src/database/auth-rate-limit-repository.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-login-enumeration.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/rate-limit.test.js`
