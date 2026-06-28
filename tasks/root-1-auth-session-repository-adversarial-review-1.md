# Root 1 Auth Session Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-session-repository.js` for user-session creation, active-session
  validation, session ownership reads, active-user checks, session listing, and
  session revocation.
- Moved `auth-service` session management helpers onto that repository.
- Replaced route-local SQL in `routes/auth.js` for access-token session
  validation, refresh deleted-user cleanup, logout/password-reset session
  revocation, and `DELETE /auth/sessions/:id` ownership checks.
- Added `identity-repository.findMostRecentActiveIdentityForUser()` for the
  refresh-path identity-usage lookup.

## Boundary

This slice intentionally does not redesign refresh-token rotation, token-family
reuse detection, access-token expiry, rate limiting, password reset token
semantics, or public auth error envelopes. It only moves session lifecycle and
session guard persistence behind repository boundaries.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The route still treats logout with an invalid bearer token as
  a successful user-facing logout while logging the failure, matching existing
  behavior.
- **P2 VERIFIED:** Session revocation remains broad for logout and password
  reset (`all active sessions for user`) and narrow for `DELETE /auth/sessions`
  (`requested session id after ownership check`).

## Risks Checked

- **Revoked session access:** protected routes still reject access tokens whose
  `sid` is revoked.
- **Sid-less access tokens:** protected routes still reject JWTs without a bound
  session id.
- **Soft-deleted users:** access-token validation still rejects soft-deleted
  users through the active-user repository read.
- **Refresh after logout/session revoke:** refresh-token rotation still fails
  when the backing session is revoked.
- **Deleted-user refresh cleanup:** refresh tokens and token families are still
  invalidated when a refresh token resolves to a missing/deleted user.
- **Route cleanup:** targeted `user_sessions` and active-user SQL patterns are
  gone from `routes/auth.js`.
- **Agent resource management:** no new subagents were launched because two
  inherited agent sessions had already timed out when polled; local bounded
  parallel checks were used instead.

## Validation

- `node --check src/database/auth-session-repository.js`
- `node --check src/services/auth-service.js`
- `node --check src/database/identity-repository.js`
- `node --check src/routes/auth.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
