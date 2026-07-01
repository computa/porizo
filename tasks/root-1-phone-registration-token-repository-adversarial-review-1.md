# Root 1 Phone Registration Token Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `src/database/phone-registration-token-repository.js`.
- Moved `phone_registration_tokens` create/consume/cleanup/recent-proof SQL out
  of `src/routes/auth.js`.
- Added focused coverage in
  `test/phone-registration-token-repository.test.js`.

## Boundary

This slice does not change phone OTP verification, HMAC derivation, token
generation, token TTL, IP-binding policy, auth envelopes, identity linking, or
phone registration success/failure semantics. It only moves persistence for the
phone-registration-token mini-aggregate behind a repository.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The route still owns HMAC/hash construction and passes hashes
  into the repository. That keeps the slice small and behavior-preserving, but
  a later auth-service split should decide whether crypto + persistence should
  live together behind a narrower service boundary.

## Risks Checked

- **Single-use token invariant:** repository coverage verifies the first consume
  succeeds and replay returns zero changes.
- **Legacy token compatibility:** null-IP tokens remain consumable from a
  current IP, preserving the old migration fallback.
- **IP-bound hijack guard:** mismatched IP-bound tokens remain unconsumable.
- **Auto-link proof lookup:** recent-verification lookup returns the newest
  matching same-IP or legacy token and ignores newer wrong-IP tokens.
- **Cleanup behavior:** expired cleanup deletes only rows older than
  `CURRENT_TIMESTAMP`; test-only `deleteAll` still clears every token.
- **Route cleanup:** `routes/auth.js` no longer contains direct
  `phone_registration_tokens` SQL; the remaining mention is a comment.
- **Agent resource management:** no new subagents were launched because two
  inherited agent sessions did not report completion within the accounting
  window; local bounded checks were used instead.

## Validation

- `node --check src/database/phone-registration-token-repository.js`
- `node --check src/routes/auth.js`
- `node --check test/phone-registration-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/phone-registration-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-identity-model.test.js test/auth-api.test.js`
- `npm run lint`
- `git diff --check -- src/database/phone-registration-token-repository.js src/routes/auth.js test/phone-registration-token-repository.test.js`
