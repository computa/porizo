# Root 1 Auth One-Time Token Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-one-time-token-repository.js` for password-reset and
  email-verification token row persistence.
- Replaced direct `auth-service.js` SQL for token create, consume-and-mark-used,
  explicit mark-used, and user-scoped invalidation.

## Boundary

This slice intentionally does not move raw token generation, SHA-256 hashing,
expiry calculation, password reset route response shaping, email verification
contact/profile policy, or refresh-token rotation. The repository owns only
the token-row persistence and the existing atomic consume transaction.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Dynamic table-name construction remains allowlisted through
  token-type constants; caller input is never interpolated as a table name.
- **P2 VERIFIED:** The consume path still wraps token lookup, used/expiry
  checks, and `used_at` update in one transaction to preserve one-time token
  semantics under concurrent use.

## Risks Checked

- **Email verification target drift:** `email_normalized` and future
  `contact_id` fields are preserved in the returned token row.
- **Enumeration behavior:** route-level forgot-password response policy remains
  outside the repository and `auth-api` coverage stayed green.
- **Agent resource management:** no new subagents were launched because
  inherited agent sessions remain stale/unmanaged; bounded local parallel
  commands were used instead.

## Validation

- `node --check src/database/auth-one-time-token-repository.js`
- `node --check src/services/auth-service.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-one-time-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-identity-model.test.js`
- `npm run lint`
- `npm test` (2,907 tests; 2,884 pass / 23 skipped / 0 fail; 449,196.389667 ms)
- `git diff --check -- src/services/auth-service.js src/database/auth-one-time-token-repository.js test/auth-one-time-token-repository.test.js`
