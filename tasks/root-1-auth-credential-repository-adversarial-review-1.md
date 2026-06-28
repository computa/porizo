# Root 1 Auth Credential Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-credential-repository.js` for password credential persistence.
- Replaced route-local SQL in `routes/auth.js` for:
  - email signup password credential insert,
  - email login password hash lookup,
  - password reset credential update.

## Boundary

This slice intentionally does not move bcrypt hashing/verification, account
lockout policy, rate limits, reset-token verification, token/session revocation,
email dispatch, auth-event logging, duplicate-email handling, or HTTP response
shape. Those stay in the route/service layer.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Login still performs the same constant-time password
  verification fallback because the route still chooses the dummy hash when the
  user or credential row is absent.
- **P2 VERIFIED:** Signup compensation semantics are unchanged: credential
  insert and entitlement creation still live in the same post-identity try/catch
  that deletes identity bootstrap rows on failure.
- **P2 VERIFIED:** Password reset still changes only `password_hash` and
  `password_changed_at`; reset-token use, token-family compromise, session
  revocation, and security email dispatch remain route/service responsibilities.

## Risks Checked

- **Security boundary:** The repository never receives plaintext passwords and
  does not know about bcrypt.
- **Enumeration boundary:** The route keeps the dummy-hash path and generic
  `INVALID_CREDENTIALS` response policy.
- **Agent resource management:** no new subagents were launched because inherited
  agent sessions timed out and `close_agent` previously stalled; local bounded
  parallel commands were used instead.

## Validation

- `node --check src/database/auth-credential-repository.js`
- `node --check src/routes/auth.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-credential-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/critical-fixes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-login-enumeration.test.js`
- `npm run lint`
