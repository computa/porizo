# Root 1 Gift Share Token Side Effects - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `share-token-repository.revokeGiftShare`.
- Added `share-token-repository.updateGiftShareSchedule`.
- Replaced direct `share_tokens` and `poem_share_tokens` updates in
  `src/routes/gifts.js` cancel and reschedule flows.
- Expanded `test/share-token-repository.test.js` for gift share binding,
  revocation, and schedule mutation.

## Boundary

This slice does not move share-token creation from `server.js` or gift
creation orchestration from `routes/gifts.js`. It only removes cancel/reschedule
share side-effect persistence from the route after gift order/outbox persistence
was already repository-backed.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** The new methods route by `contentType`, defaulting non-poem
  values to song shares. This preserves the old route behavior, but future
  callers should validate allowed gift content types before invoking the
  repository.

## Risks Checked

- **Song revoke drift:** song gift revoke still sets `status = revoked`,
  `web_stream_allowed = 0`, `expires_at`, and clears `dispatched_at`.
- **Poem revoke drift:** poem gift revoke still sets `status = revoked`,
  `expires_at`, and clears `dispatched_at`.
- **Schedule drift:** reschedule still updates `dispatch_at`, `expires_at`, and
  clears `dispatched_at`.
- **Binding guard:** both mutations still require matching `id`,
  `gift_order_id`, and `delivery_source = gift`.
- **Route cleanup:** `routes/gifts.js` has no remaining raw `gift_orders`,
  `gift_delivery_outbox`, `share_tokens`, or `poem_share_tokens` SQL.
- **Agent resource management:** no new subagents were launched because the
  inherited agent close path stalled; local bounded checks were used instead.

## Validation

- `node --check src/database/share-token-repository.js`
- `node --check src/routes/gifts.js`
- `node --check test/share-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/share-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gifts.test.js`
- `npm run lint`
- `git diff --check -- src/database/share-token-repository.js src/routes/gifts.js test/share-token-repository.test.js`
