# Root 1 Admin Auth Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `admin-auth-repository.js` for admin user lookup/mutation, admin
  session insert/validate/delete/cleanup, and admin password-reset token
  lifecycle persistence.
- Replaced direct SQL in `admin-auth-service.js` with repository calls.

## Boundary

This slice intentionally does not move bcrypt hashing, raw token generation,
SHA-256 token hashing, seeded-default-admin production blocking, lockout policy,
session-duration policy, logging, or public response shapes. The repository owns
persistence only.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Generic login-failure behavior remains in the service and is
  still covered for unknown email, wrong password, lockout, and seeded-default
  production blocking.
- **P2 VERIFIED:** Admin sessions still validate by token hash and expiration
  against the joined admin row.
- **P2 VERIFIED:** Password reset token lifecycle still stores only token
  hashes and preserves used-token invalidation.

## Risks Checked

- **Security boundary:** repository receives token hashes, never raw session or
  reset tokens.
- **Policy leakage:** lockout thresholds, bcrypt cost, default seeded admin
  rules, session duration, and public error wording remain service-owned.
- **Behavior drift:** existing admin login hardening and seeded-default tests
  remain green.
- **Agent resource management:** no new subagents were launched because
  inherited agent sessions remain stale/unmanaged; bounded local parallel
  commands were used instead.

## Validation

- `node --check src/database/admin-auth-repository.js`
- `node --check src/services/admin-auth-service.js`
- `node --check test/admin-auth-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-auth-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-login-hardening.test.js test/admin-auth-default-seed.test.js`
- `npm run lint`
- Targeted grep confirmed no raw persistence SQL remains in
  `admin-auth-service.js`.
- `git diff --check -- src/services/admin-auth-service.js src/database/admin-auth-repository.js test/admin-auth-repository.test.js`
