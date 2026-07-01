# Root 1 Auth Cross-Identifier Lookup Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added identity repository read helpers for verified-contact lookup,
  provider-user lookup, provider listing, and user email/phone mirrors.
- Replaced duplicate-account lookup SQL in `routes/auth.js` email signup and
  phone registration cross-identifier checks.
- Added focused coverage in `test/identity-repository.test.js`.

## Boundary

This slice does not change duplicate-account response envelopes, identifier
masking, email/phone normalization, provider-linking behavior, or the broader
profile/contact update paths. It only moves the cross-identifier read queries
behind `identity-repository.js`.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Social-provider duplicate lookup preserves the previous route
  behavior of not filtering by provider status. Phone lookup still requires
  `status = 'active'`. This asymmetry is intentional preservation, not a new
  policy decision.

## Risks Checked

- **Verified-email duplicate guard:** verified contacts for active users still
  match; unverified contacts and soft-deleted users do not.
- **Phone duplicate guard:** active phone providers still match through the
  provider table.
- **Social duplicate compatibility:** provider lookup without a status filter
  still returns a revoked provider row, matching the previous route query.
- **Privacy masking inputs:** auth-method list and `users.email/phone_number`
  mirror reads still return the data used by the route helper's existing masking
  logic.
- **Route cleanup:** the target duplicate-account SQL patterns are gone from
  `routes/auth.js`.
- **Agent resource management:** no new subagents were launched because two
  inherited agent sessions did not report completion within the accounting
  window; local bounded checks were used instead.

## Validation

- `node --check src/database/identity-repository.js`
- `node --check src/routes/auth.js`
- `node --check test/identity-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/identity-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-identity-model.test.js test/auth-api.test.js`
- `npm run lint`
- `git diff --check -- src/database/identity-repository.js src/routes/auth.js test/identity-repository.test.js`
