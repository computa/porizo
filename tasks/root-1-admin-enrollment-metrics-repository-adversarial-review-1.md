# Root 1 Admin Enrollment Metrics Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- `src/database/admin-metrics-repository.js`
  - `getEnrollmentMetrics`
- `src/services/admin-service.js`
  - `getEnrollmentMetrics`
- `test/admin-metrics-repository.test.js`
- `test/admin-enrollment-metrics-routes.test.js`

## Findings

- P0: none found.
- P1: none found after review.

## Risks Checked

- PostgreSQL aggregate typing: repository normalizes `COUNT`, `SUM`, and `AVG`
  outputs before response assembly so nested metric rows do not leak string
  counts from the Postgres adapter.
- Windowing semantics: totals, abandonment, and quality metrics remain all-time;
  only `last7Days` is bounded by the service-provided `weekAgo`.
- Trend boundary: `last7Days` preserves current inclusive
  `started_at >= weekAgo` behavior.
- Quality buckets: exact boundaries remain `<50`, `<70`, `<85`, and `85+`.
- Deleted-profile behavior: current metrics still include non-null quality
  scores regardless of profile status/deletion. That is characterized rather
  than silently changed in this refactor.
- Route contract: `/admin/dashboard/metrics/enrollment` still enforces admin
  session auth and returns the service payload unchanged.

## Validation

- `node --check src/database/admin-metrics-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-metrics-repository.test.js`
- `node --check test/admin-enrollment-metrics-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-metrics-repository.test.js test/admin-enrollment-metrics-routes.test.js test/admin-overview-metrics-routes.test.js`
  - 10 pass / 0 fail

## Notes

Cost metrics, render pipeline metrics, risk metrics, and gift/admin-gift ops
remain out of scope for this slice.
