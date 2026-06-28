# Root 1 Admin Overview Metrics Repository — Adversarial Review 1

Reviewed the Root 1 admin overview metrics persistence slice:

- `src/database/admin-metrics-repository.js`
- `src/services/admin-service.js`
  - `getOverviewMetrics`
- `src/routes/admin.js`
  - `GET /admin/dashboard/metrics/overview`
- `test/admin-metrics-repository.test.js`
- `test/admin-overview-metrics-routes.test.js`
- Regression guard: `test/admin-job-ops-repository.test.js`

## Result

No P0 findings.

One P1 was found and fixed before handoff.

## P1 Fixed

### Grouped counts were not normalized for Postgres

The first extraction normalized scalar counts but returned grouped
`COUNT(*)` rows as the adapter supplied them. PostgreSQL aggregate counts can
arrive as strings, which would violate the admin UI contract and break numeric
operations such as `runningJobs + queuedJobs` and tier percentage reduction.

Fix:

- Normalize every `tierDist[].count` and `jobStats[].count` to `Number`.
- Add test assertions that grouped count values are numbers.

## Verified Contracts

- Route requires an admin session.
- Success response keeps the existing bare JSON shape:
  `totalUsers`, `newUsersToday`, `newUsersWeek`, `tierDist`, `jobStats`,
  `rendersToday`.
- `AdminService` owns rolling time-window construction and delegates persistence
  through `adminMetricsRepository`.
- User windows preserve strict `created_at > dayAgo/weekAgo` semantics.
- `tierDist` groups only `entitlements` rows; users without entitlements remain
  excluded from that distribution.
- `jobStats` groups all jobs by status.
- `rendersToday` counts `track_versions` where `render_type = 'preview'` and
  `created_at > dayAgo`, regardless of version status.
- Cost metrics, enrollment metrics, render-pipeline metrics, risk metrics,
  billing/revenue, and gift ops are out of scope.

## Validation

- `node --check src/database/admin-metrics-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-metrics-repository.test.js`
- `node --check test/admin-overview-metrics-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-metrics-repository.test.js test/admin-overview-metrics-routes.test.js test/admin-job-ops-repository.test.js`
  - 15 pass / 0 fail
- `npm run lint`
- `git diff --check`
