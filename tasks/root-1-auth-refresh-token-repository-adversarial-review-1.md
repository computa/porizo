# Root 1 Auth Refresh Token Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-refresh-token-repository.js` for refresh-token families,
  refresh-token rows, session-bound verification reads, token revocation,
  family compromise/revocation, grace-unrevoke audit persistence, and
  transaction-scoped rotation queries.
- Replaced direct `auth-service.js` SQL for refresh-token create, verify,
  revoke, user-wide revoke, family compromise, and rotate paths.

## Boundary

This slice intentionally does not move raw token generation, SHA-256 hashing,
expiry calculation, JWT minting, reuse/grace policy, logging, or route-facing
refresh error semantics. The repository owns persistence and transaction
scoping only.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Rotation still reads the old token inside a transaction,
  revokes it with `revoked_at IS NULL` optimistic locking, and inserts the
  replacement in the same transaction.
- **P2 VERIFIED:** Grace-window behavior is preserved: reuse with an active
  replacement returns the existing re-auth conflict, while reuse without a
  replacement persists a high-severity `refresh_token_grace_unrevoke` audit row
  before clearing the stale revocation.
- **P2 VERIFIED:** Session binding and revoked-session checks still happen
  before a refresh token can mint replacement credentials.

## Risks Checked

- **Revenue/auth path blast radius:** `/auth/refresh`, `/auth/logout`,
  session revocation, password-reset revocation, and identity-model smoke
  coverage remained green.
- **Policy leakage into repository:** token generation, hashing, expiration,
  compromise/grace decisions, and error-code mapping remain in `auth-service.js`.
- **Transaction shape:** the repository uses `createPreparedDbFromQuery()` so
  transaction-scoped queries use the transaction connection instead of the
  parent database handle.
- **Agent resource management:** no new subagents were launched because
  inherited agent sessions remain stale/unmanaged; bounded local parallel
  commands were used instead.

## Validation

- `node --check src/database/auth-refresh-token-repository.js`
- `node --check src/services/auth-service.js`
- `node --check test/auth-refresh-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-refresh-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-identity-model.test.js test/critical-fixes.test.js`
- `npm run lint`
- `npm test` (2,912 tests; 2,889 pass / 23 skipped / 0 fail; 448,532.530625 ms)
- Targeted grep confirmed refresh-token table SQL lives in
  `database/auth-refresh-token-repository.js`, with only comments and unrelated
  GDPR/account-deletion direct SQL still present in `auth-service.js`.
- `git diff --check -- src/services/auth-service.js src/database/auth-refresh-token-repository.js test/auth-refresh-token-repository.test.js`
