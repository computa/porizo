# Root 1 Admin Webhook Health Repository — Adversarial Review 1

Date: 2026-06-27

## Pass Verdict

ZERO P0 / ZERO P1 found by local adversarial review after extraction.

## Scope

- `src/database/admin-billing-repository.js`
  - `getWebhookHealth`
- `src/services/admin-service.js`
  - `getWebhookHealth`
- `src/routes/admin.js`
  - `GET /admin/dashboard/webhooks/health`
- `test/admin-webhook-health-repository.test.js`
- `test/admin-webhook-health-routes.test.js`

## Findings

- P0: none found.
- P1: none found.

## Risks Checked

- Route still requires an authenticated admin session.
- `AdminService` still owns the 24-hour lookback window.
- `lastWebhookReceived` remains the latest webhook audit row across all time.
- `webhooksByType` still counts only recent audit actions matching
  `webhook_%`.
- `failedWebhooks` still counts recent webhook audit rows whose metadata JSON
  contains an `"error"` key.
- Non-webhook audit rows with error metadata are not counted.
- `pendingRetries` remains the explicit `0` placeholder because no retry queue
  table exists.
- Repository normalizes counts to JavaScript numbers.

## Residual Risks

- Failure detection is still string-pattern based on `metadata_json LIKE
  '%"error"%'`; a structured webhook event table would be stronger, but that is
  outside this read-only repository extraction.
- `pendingRetries` cannot be made real until a webhook retry queue exists.

## Validation

- `node --check src/database/admin-billing-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-webhook-health-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-webhook-health-repository.test.js test/admin-webhook-health-routes.test.js`
  - 3 pass / 0 fail

## Delegation

No new agent was launched for this slice because the earlier read-only explorer
hit the Codex usage limit. Local parallel reads and focused validation were
used instead.
