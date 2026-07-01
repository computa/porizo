# Root 1 Gift Dispatch Repository - Adversarial Review 2

Date: 2026-06-28

## Scope

- Expanded `src/database/gift-dispatch-repository.js` beyond scheduler polling
  into server-owned dispatch persistence.
- Delegated from `src/server.js`:
  - gift delivery outbox creation and existence checks
  - dispatch-attempt ledger inserts
  - delivery sent/failed state transitions
  - provider-message receipt lookup and receipt state update
  - per-gift stale `sending` row recovery
- Extended `test/gift-dispatch-repository.test.js` for transaction-scoped
  outbox creation, send/fail transitions, receipt updates, and one-gift
  recovery isolation.

## Boundary

This slice deliberately does not move `dispatchGiftById` orchestration, due-row
locking, provider sends, gift-order final aggregate updates, wallet refund
decisions, gift share dispatch sync/revocation, incidents, audit entries,
events, gift create/cancel/reschedule route SQL, or admin gift operations.
Those remain larger gift-domain roots and need their own characterization tests.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** `recordDispatchAttempt`, `markDeliverySent`,
  `markDeliveryFailed`, `findDeliveryByProviderMessageId`,
  `updateDeliveryReceipt`, and `recoverSendingRowsForGift` do not yet accept an
  injected transaction query. Current server call sites are outside an explicit
  transaction, so behavior is preserved, but a future atomic dispatch aggregate
  extraction must add transaction injection instead of nesting raw DB writes.
  Smallest fix when that root starts: add optional `query` parameters and cover
  rollback behavior in repository tests.
- **P2 VERIFIED:** Raw gift-delivery SQL remains in `src/server.js` for due-row
  selection/locking and aggregate finalization, and in `src/routes/gifts.js` for
  create/cancel/reschedule flows. This is intentionally out of scope, but Root 1
  is not terminated until those seams are extracted or explicitly deferred.

## Risks Checked

- **Duplicate outbox creation:** `hasOutboxRows` and `createOutboxRows` both
  support caller-provided transaction queries; the repository test verifies
  visibility inside the same transaction.
- **Channel mapping drift:** SMS still maps to Twilio and `recipientPhone`;
  email still maps to Resend and `recipientEmail`.
- **Retry counter drift:** sent rows still increment `attempt_count` by one;
  failed rows still receive caller-computed `attemptCount`.
- **Receipt monotonicity:** receipt state precedence remains in `server.js`
  through `chooseReceiptState`; the repository only performs the selected
  persistence update.
- **Stale recovery blast radius:** per-gift recovery updates only rows matching
  that `gift_order_id` and `status = 'sending'`.
- **Agent resource management:** no new subagents were launched. Two inherited
  agents timed out during health checks, and a close attempt stalled, so local
  bounded checks were used to avoid increasing Mac resource pressure.

## Validation

- `node --check src/database/gift-dispatch-repository.js`
- `node --check src/server.js`
- `node --check test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gifts.test.js`
- `git diff --check -- src/database/gift-dispatch-repository.js src/server.js test/gift-dispatch-repository.test.js`
