# Root 1 Admin Cost Metrics Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- `src/database/admin-metrics-repository.js`
  - `getCostMetrics`
- `src/services/admin-service.js`
  - `getCostMetrics`
- `test/admin-metrics-repository.test.js`
- `test/admin-cost-metrics-routes.test.js`

## Findings

- P0: none found.
- P1: three found and fixed before handoff.

## P1 Fixed

### PostgreSQL-only JSON casts made local/test SQLite fail

The old service SQL used `actual_cost_json::jsonb->>'total_usd'` and
`::numeric`, which SQLite cannot parse. The repository now reads JSON text and
performs cost extraction in JavaScript, keeping the DB adapter boundary stable.

### Live render final statuses were excluded

The old query filtered only `track_versions.status = 'completed'`, while the
runner commits version readiness as `preview_ready` or `full_ready`. The
repository now includes `completed`, `preview_ready`, and `full_ready`, while
still excluding unrelated `ready` rows.

### Cost source did not match live writes

The live version-creation path writes `cost_estimate_json.usd`; no live update
path was found for `actual_cost_json`. The repository now reads
`actual_cost_json.total_usd` first and falls back to `cost_estimate_json.usd`
so the dashboard reports populated render costs without a schema change.

## Risks Checked

- Route contract still requires an admin session and returns bare JSON.
- `AdminService` owns the `days` to `daysAgo` cutoff calculation and delegates
  persistence to `adminMetricsRepository`.
- Daily costs keep exclusive `created_at > daysAgo` semantics and are sorted by
  date descending.
- Cost-by-type remains all-time and does not apply the route `days` window.
- Rows with missing/non-numeric cost JSON still contribute to `COUNT(*)`-style
  render counts but produce `null` sums/averages when no numeric cost exists.
- Actual cost values take precedence over estimates when both are present.
- Counts and numeric sums/averages are returned as JavaScript numbers when
  non-null.

## Validation

- `node --check src/database/admin-metrics-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-metrics-repository.test.js`
- `node --check test/admin-cost-metrics-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-metrics-repository.test.js test/admin-cost-metrics-routes.test.js test/admin-risk-metrics-routes.test.js test/admin-render-pipeline-metrics-routes.test.js test/admin-enrollment-metrics-routes.test.js test/admin-overview-metrics-routes.test.js`
  - 25 pass / 0 fail

## Notes

Entitlement, reporting, and gift/admin-gift ops remain out of scope for this
slice.
