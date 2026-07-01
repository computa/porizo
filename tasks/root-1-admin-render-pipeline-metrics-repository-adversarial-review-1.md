# Root 1 Admin Render-Pipeline Metrics Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- `src/database/admin-metrics-repository.js`
  - `getRenderSuccessMetrics`
- `src/services/admin-service.js`
  - `getRenderSuccessMetrics`
- `test/admin-metrics-repository.test.js`
- `test/admin-render-pipeline-metrics-routes.test.js`

## Findings

- P0: none found.
- P1: none found after review.

## Risks Checked

- Success semantics are intentionally preserved: success means
  `track_versions.status = 'ready'`, even though other parts of the render
  workflow use more specific statuses such as `preview_ready` or `full_ready`.
- Window semantics are intentionally mixed: preview/full success rates are
  all-time, while failed job errors, completed-job step latency, and daily
  trend rows use the service-provided seven-day cutoff.
- Error recency uses `jobs.updated_at >= weekAgo`; step latency inclusion uses
  `jobs.created_at >= weekAgo`; daily trend uses `track_versions.completed_at
  >= weekAgo`.
- Step latency still uses JavaScript duration calculation, includes only steps
  with more than five samples, and sorts by slowest average latency first.
- Rows with null `completed_at` remain excluded from `dailyTrend`.
- PostgreSQL aggregate typing is normalized for nested counts and trend sums so
  dashboard math receives numbers instead of adapter-specific string counts.

## Validation

- `node --check src/database/admin-metrics-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-metrics-repository.test.js`
- `node --check test/admin-render-pipeline-metrics-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-metrics-repository.test.js test/admin-render-pipeline-metrics-routes.test.js test/admin-enrollment-metrics-routes.test.js test/admin-overview-metrics-routes.test.js`
  - 15 pass / 0 fail

## Notes

Cost metrics, risk metrics, reporting rollups, and gift/admin-gift ops remain
out of scope for this slice.
