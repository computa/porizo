# Root 1 Gift Order Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `src/database/gift-order-repository.js`.
- Delegated from `src/routes/gifts.js`:
  - `/gifts` list reads with optional status filtering
  - gift cancel compare-and-set status transition
  - gift retry compare-and-set status transition
  - gift reschedule field update
  - non-transactional gift reloads after immediate dispatch/finalized responses
- Extended `src/database/gift-dispatch-repository.js` with route-owned outbox
  helpers for sent-row detection, cancellation, retry reset, and reschedule
  delete/recreate flows.
- Added `test/gift-order-repository.test.js` and expanded
  `test/gift-dispatch-repository.test.js`.

## Boundary

This slice does not move gift creation, reservation finalize transaction
semantics, share-token schedule/revoke updates, wallet refund decisions,
permission checks, audit/events, or provider dispatch. Transaction-coupled
gift-order SQL remains in `routes/gifts.js` for finalize idempotency and
integrity checks until the create/finalize repository slice can support
injected query semantics.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** `gift-order-repository.js` currently uses direct
  `db.prepare` calls only. That is correct for the moved non-transactional call
  sites, but it is not ready to absorb transaction-coupled create/finalize
  reads. Smallest future fix: add optional `query` support before moving the
  remaining `queryGet(... gift_orders ...)` paths.
- **P2 VERIFIED:** Cancel/reschedule still update share-token tables in the
  route. This keeps side-effect ordering unchanged but means gift route is not
  yet thin. Smallest future fix: extract a gift share scheduling/revocation
  repository or service after Root 1 has isolated the persistence contracts.

## Risks Checked

- **List authorization drift:** repository list reads require caller-provided
  `userId`; route still performs auth before calling.
- **Status race drift:** cancel and retry keep the original compare-and-set
  status guards and return `changes` for the existing `GIFT_STATUS_CHANGED`
  behavior.
- **Partial dispatch guard:** sent-outbox detection moved to
  `gift-dispatch-repository.js` and is still checked before edit/cancel/retry.
- **Outbox blast radius:** cancel/retry/delete helpers filter by
  `gift_order_id` and by the same allowed statuses as the previous route SQL.
- **Immediate dispatch reload:** moved to the repository without changing when
  dispatch is invoked or how responses are rendered.
- **Agent resource management:** no new subagents were launched because the
  inherited agent close path stalled; local bounded checks were used instead.

## Validation

- `node --check src/database/gift-order-repository.js`
- `node --check src/database/gift-dispatch-repository.js`
- `node --check src/routes/gifts.js`
- `node --check test/gift-order-repository.test.js`
- `node --check test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-order-repository.test.js test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gifts.test.js`
- `npm run lint`
- `git diff --check -- src/database/gift-order-repository.js src/database/gift-dispatch-repository.js src/routes/gifts.js test/gift-order-repository.test.js test/gift-dispatch-repository.test.js`
