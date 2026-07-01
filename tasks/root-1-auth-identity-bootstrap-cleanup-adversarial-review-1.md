# Root 1 Auth Identity Bootstrap Cleanup - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `identity-repository.deleteUserIdentityBootstrapRows`.
- Replaced three duplicated auth-route compensation delete blocks with that
  repository method.
- Added focused coverage in `test/identity-repository.test.js`.

## Boundary

This slice only moves post-identity-creation compensation cleanup behind the
identity repository. It does not change signup/social/phone registration
success behavior, entitlement creation, password credential insertion,
identity/contact creation, auth envelopes, or account deletion behavior.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The repository method preserves the old cleanup scope:
  contacts, auth providers, and user row. Password credentials are removed by
  the existing `ON DELETE CASCADE` constraint from `user_credentials.user_id`.
  The focused test now pins that cascade behavior.

## Risks Checked

- **Partial cleanup drift:** the method runs inside the DB transaction wrapper
  where available, so supported adapters no longer perform the three-row cleanup
  as an unguarded route-local sequence.
- **Route behavior drift:** email signup, social signup, and phone signup still
  throw the original post-creation error after compensation.
- **Credential orphaning:** focused repository coverage seeds
  `user_credentials` and verifies the user delete clears it through the existing
  cascade.
- **Route cleanup:** the three repeated route-local `DELETE FROM
  user_contacts/user_auth_providers/users` blocks are gone from `routes/auth.js`.
- **Agent resource management:** no new subagents were launched because two
  inherited agent sessions did not report completion within the accounting
  window; local bounded checks were used instead.

## Validation

- `node --check src/database/identity-repository.js`
- `node --check src/routes/auth.js`
- `node --check test/identity-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/identity-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-api.test.js`
- `npm run lint`
- `git diff --check -- src/database/identity-repository.js src/routes/auth.js test/identity-repository.test.js`
