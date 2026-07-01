# Root 1 Gift Route Identity Read - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `identity-repository.findUserDisplayProfile`.
- Replaced the final direct `users` read in `src/routes/gifts.js` with that
  repository method.
- Added focused coverage in `test/identity-repository.test.js`.

## Boundary

This slice only removes the sender display-name/email SQL from the gift route.
It does not change display-name precedence, delivery message formatting, gift
creation orchestration, auth, or identity lifecycle behavior.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The method returns `display_name` and `email` from `users`
  without filtering `deleted_at`. The route is already authenticated and uses
  the current user id, preserving the old behavior. If this method is reused in
  unauthenticated contexts, callers should choose an active-user variant.

## Risks Checked

- **Display fallback drift:** route still resolves explicit sender name first,
  then user display name, then email local part, then `A friend`.
- **Route cleanup:** `routes/gifts.js` now has no direct `db.prepare` or
  `db.query` calls.
- **Agent resource management:** no new subagents were launched because the
  inherited agent close path stalled; local bounded checks were used instead.

## Validation

- `node --check src/database/identity-repository.js`
- `node --check src/routes/gifts.js`
- `node --check test/identity-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/identity-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gifts.test.js`
- `npm run lint`
- `git diff --check -- src/database/identity-repository.js src/routes/gifts.js test/identity-repository.test.js`
