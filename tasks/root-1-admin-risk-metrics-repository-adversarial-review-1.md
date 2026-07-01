# Root 1 Admin Risk Metrics Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- `src/database/admin-metrics-repository.js`
  - `getRiskMetrics`
- `src/services/admin-service.js`
  - `getRiskMetrics`
- `test/admin-metrics-repository.test.js`
- `test/admin-risk-metrics-routes.test.js`

## Findings

- P0: none found.
- P1: none found after review.

## Risks Checked

- Route contract still requires an admin session and returns the service
  payload as bare JSON.
- `AdminService` owns `now` and seven-day cutoff construction; the repository
  owns SQL reads only.
- Risk distribution still filters `users.deleted_at IS NULL`.
- Active lock count intentionally preserves current behavior: it counts any
  row with `locked_until > now`, including soft-deleted locked users.
- Lock boundary remains exclusive: a row locked exactly at `now` is not active.
- Recent escalation rows still come from `audit_logs.resource_id`, not
  `audit_logs.user_id`.
- Escalation window remains inclusive: `created_at >= weekAgo`.
- Escalation list excludes old rows and wrong actions, orders newest first, and
  preserves the current `LIMIT 20`.
- Malformed `metadata_json` remains parsed in `AdminService` into
  `{ to: "unknown", reason: "[metadata parse error]" }`; empty metadata maps to
  unknown/empty reason.
- PostgreSQL aggregate typing is normalized for distribution counts and
  `lockedAccounts`.
- The query projects `COALESCE(risk_level, 'low')`; both SQLite and Postgres
  core migrations define `users.risk_level TEXT NOT NULL DEFAULT 'low'`, so the
  raw `GROUP BY risk_level` cannot split null and low buckets under the current
  schema.

## Validation

- `node --check src/database/admin-metrics-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-metrics-repository.test.js`
- `node --check test/admin-risk-metrics-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-metrics-repository.test.js test/admin-risk-metrics-routes.test.js test/admin-render-pipeline-metrics-routes.test.js test/admin-enrollment-metrics-routes.test.js test/admin-overview-metrics-routes.test.js`
  - 20 pass / 0 fail

## Notes

Entitlement, cost, reporting, and gift/admin-gift ops remain out of scope for
this slice.
