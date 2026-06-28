# Root 1 Auth Provider-Linking Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `auth-provider-linking-repository.js` for auth route provider-linking
  maintenance persistence.
- Replaced route-local SQL in `routes/auth.js` for:
  - phone-provider existence checks before pending phone auto-link,
  - deleted-user social-provider lookup,
  - orphan provider revocation,
  - Apple refresh-token `provider_data` updates during social login,
  - Apple refresh-token `provider_data` updates during explicit Apple linking.

## Boundary

This slice intentionally does not move token verification, Apple authorization
code exchange, provider-data merge policy, contact creation, auth-event
emission, identity-service linking, credential storage, reset-password updates,
receiver attribution, or username availability checks. Those remain separate
Root 1 slices.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The pending phone auto-link guard still checks for any
  provider row, not only active rows. This preserves the previous conservative
  behavior and avoids relinking over revoked/deleted history by accident.
- **P2 VERIFIED:** Deleted-user provider cleanup still only revokes provider
  rows owned by soft-deleted users and still logs the revoked provider id.
- **P2 VERIFIED:** Apple refresh-token persistence only writes `provider_data`;
  route code still owns the JSON merge and optional exchange failure policy.

## Risks Checked

- **Fixture guard:** Repository tests seed a provider row before marking the user
  deleted because the schema correctly blocks new auth-provider writes for
  deleted users.
- **Behavioral boundary:** The repository accepts object or string provider data
  but does not interpret Apple fields.
- **Agent resource management:** no new subagents were launched because inherited
  agent sessions timed out and `close_agent` previously stalled; local bounded
  parallel commands were used instead.

## Validation

- `node --check src/database/auth-provider-linking-repository.js`
- `node --check src/routes/auth.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-provider-linking-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-service.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/critical-fixes.test.js`
- `npm run lint`
- `npm test` (2,894 tests / 2,871 pass / 0 fail / 23 skipped; 449,807.0095ms)
