# Root 1 Daily Aggregates Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- `src/database/daily-aggregates-repository.js`
- `src/jobs/compute-daily-aggregates.js`
- `test/daily-aggregates.test.js`
- `test/admin-kpi-routes.test.js`

## Findings

- P0: none found.
- P1: none found after review.

## Risks Checked

- `compute-daily-aggregates.js` no longer owns raw SQL; it owns date-window
  calculation, freshness policy, id generation, and trend percentage math.
- Repository owns daily metric input reads, daily aggregate upsert, freshness
  lookup, dashboard list reads, and KPI trend sum reads.
- Daily windows remain inclusive: `created_at >= dayStart` and
  `created_at <= dayEnd`.
- WAU and MAU windows still use seven-day and thirty-day rolling cutoffs
  derived from the target date.
- Event metric names remain `render_start`, `render_ready`, `share_create`,
  `share_claim`, `teaser_viewed`, `story_start`, and `story_confirm`.
- Subscription/revenue source tables remain unchanged: `subscriptions` and
  `credit_transactions` with `purchase`/`subscription` transaction types.
- Existing daily aggregate rows keep their existing `id` when recomputed.
- KPI list route still computes missing/stale recent rows on demand and returns
  bare `{ aggregates }`.
- KPI trend route still uses one-week/two-week date boundaries and percentage
  change strings.
- Aggregate and trend sum rows are normalized to JavaScript numbers to avoid
  leaking Postgres aggregate strings/nulls into admin dashboards.

## Validation

- `node --check src/database/daily-aggregates-repository.js`
- `node --check src/jobs/compute-daily-aggregates.js`
- `node --check test/daily-aggregates.test.js`
- `node --check test/admin-kpi-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/daily-aggregates.test.js test/admin-kpi-routes.test.js`
  - 5 pass / 0 fail

## Notes

Entitlement aggregates/writes and gift/admin-gift ops remain out of scope for
this slice. One delegated KPI explorer stalled during cleanup; local process
cleanup killed unrelated stale XcodeBuildMCP processes, and no new agent was
launched before accounting for it.
