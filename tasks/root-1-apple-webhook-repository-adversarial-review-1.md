# Root 1 Apple Webhook Repository - Adversarial Review 1

Date: 2026-06-28

## Scope

- Added `apple-webhook-repository.js` for Apple webhook notification claims,
  status updates, DLQ upserts, notification stats, subscription lookup by
  original transaction id, and Apple-webhook-specific subscription state writes.
- Replaced direct persistence access in `apple-webhook-handler.js`.

## Boundary

This slice intentionally does not change JWS decoding, Apple notification type
dispatch, subscription-manager calls, receipt semantics, DLQ policy, or route
response shapes. The repository owns persistence only.

## Adversarial Findings

- **P0:** None.
- **P1:** None.
- **P2 VERIFIED:** Atomic idempotency still uses `INSERT ... ON CONFLICT DO
  NOTHING` and returns whether this delivery won the claim.
- **P2 VERIFIED:** DLQ upsert still increments attempt count and preserves the
  first raw payload while updating the latest error fields.
- **P2 VERIFIED:** Billing retry, pending-product, and auto-renew state writes
  remain scoped by subscription id.

## Risks Checked

- **Revenue path:** existing Apple webhook lifecycle tests still pass across
  subscribe, renew, expire, billing retry, refund, revoke, renewal status, and
  stats paths.
- **Policy leakage:** notification decode/switch behavior and subscription
  manager orchestration remain in `apple-webhook-handler.js`.
- **Repository direction:** handler executable SQL is gone; remaining SQL-like
  strings are comments.
- **Agent resource management:** read-only explorer teammates are still running
  for independent sharing/runner mapping; the Apple webhook code slice was
  completed locally without overlapping edits.

## Validation

- `node --check src/database/apple-webhook-repository.js`
- `node --check src/services/apple-webhook-handler.js`
- `node --check test/apple-webhook-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/apple-webhook-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/apple-webhook-handler.test.js`
- `npm run lint`
- Targeted grep confirmed no executable raw persistence SQL remains in
  `apple-webhook-handler.js`.
- `git diff --check -- src/database/apple-webhook-repository.js src/services/apple-webhook-handler.js test/apple-webhook-repository.test.js`
