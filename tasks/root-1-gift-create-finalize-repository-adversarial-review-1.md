# Root 1 Gift Create Finalize Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Made `src/database/gift-order-repository.js` support caller-provided
  transaction queries.
- Delegated from `src/routes/gifts.js`:
  - gift-order idempotency lookup by sender/idempotency key
  - scheduled gift-order insert
  - finalized-reservation gift reload inside a transaction
  - finalize integrity gift-order reads
- Added `gift-dispatch-repository.listFinalizeIntegrityRows`.
- Added `share-token-repository.getGiftShareBinding` with injected-query
  support for finalize integrity checks.
- Expanded focused repository tests for transaction visibility.

## Boundary

This slice does not move gift creation orchestration out of the route. The route
still owns feature flags, content validation, wallet debit/refund decisions,
share-token creation, outbox creation, integrity interpretation, audit/events,
dispatch invocation, and response shaping. Share-token schedule/revoke updates
for cancel/reschedule remain direct route SQL and are the next obvious small
Root 1 share side-effect slice.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** `createGiftOrderFromPayload` still orchestrates several
  side effects inside one closure. Persistence is now behind repositories, but
  the route remains behavior-heavy. Smallest future fix: extract a
  `gift-create-service` only after the remaining share-token schedule/revoke
  persistence is isolated.
- **P2 VERIFIED:** `share-token-repository.getGiftShareBinding` covers the
  finalize integrity read only. Cancel/reschedule share updates still need
  repository methods before `routes/gifts.js` can be considered thin.

## Risks Checked

- **Rollback semantics:** new repository methods use `createPreparedDbFromQuery`
  so transaction-scoped calls still execute inside the caller transaction.
- **Idempotency drift:** idempotency lookup still filters by
  `sender_user_id + idempotency_key` and returns the first matching row.
- **Insert shape drift:** `insertScheduled` preserves the existing column list,
  default statuses, dispatch attempt count, token/refund fields, snapshot JSON,
  and next-retry initialization.
- **Integrity drift:** gift, outbox, and share binding reads now delegate to
  repositories but preserve the same predicates and selected columns.
- **Remaining raw SQL:** route-level raw gift SQL is now limited to share-token
  schedule/revoke side effects in cancel/reschedule paths.
- **Agent resource management:** no new subagents were launched because the
  inherited agent close path stalled; local bounded checks were used instead.

## Validation

- `node --check src/database/gift-order-repository.js`
- `node --check src/database/gift-dispatch-repository.js`
- `node --check src/database/share-token-repository.js`
- `node --check src/routes/gifts.js`
- `node --check test/gift-order-repository.test.js`
- `node --check test/gift-dispatch-repository.test.js`
- `node --check test/share-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-order-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gift-dispatch-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/share-token-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/gifts.test.js`
- `npm run lint`
- `git diff --check -- src/database/gift-order-repository.js src/database/gift-dispatch-repository.js src/database/share-token-repository.js src/routes/gifts.js test/gift-order-repository.test.js test/gift-dispatch-repository.test.js test/share-token-repository.test.js`
