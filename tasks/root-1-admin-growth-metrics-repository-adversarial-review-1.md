# Root 1 Admin Growth Metrics Repository — Adversarial Review 1

Date: 2026-06-27

## Pass Verdict

ZERO P0 / ZERO P1 found by local adversarial review after extraction.

## Scope

- `src/database/admin-metrics-repository.js`
  - `getTeaserMetrics`
  - `getShareMetrics`
- `src/services/admin-service.js`
  - `getTeaserMetrics`
  - `getShareMetrics`
- `src/routes/admin.js`
  - `GET /admin/dashboard/growth/teasers`
  - `GET /admin/dashboard/growth/shares`
- `test/admin-growth-metrics-repository.test.js`
- `test/admin-growth-metrics-routes.test.js`

## Findings

- P0: none found.
- P1: none found.

## Risks Checked

- Both growth metric routes still require an authenticated admin session.
- Route response shapes are preserved.
- `AdminService` still owns route default day windows and percentage string
  formatting.
- Teaser metrics still count `teaser_viewed`, `share_claim`, and `share_stream`
  events inside the requested window.
- Teaser daily trend still groups only `teaser_viewed` by date and sorts
  ascending.
- Share metrics still count created shares by `created_at`, claimed shares by
  `status = 'claimed' AND bound_at > ?`, status breakdown by `created_at`, and
  average access over shares created in-window.
- Repository normalizes aggregate rows to JavaScript numbers so PostgreSQL
  `COUNT`/`AVG` strings do not leak into service rate math.

## Residual Risks

- The claimed-share metric intentionally uses `bound_at` only, so old shares
  claimed inside the window can make `claimRate` exceed the conversion rate for
  shares created in-window. This is existing behavior and is now pinned by
  characterization rather than silently changed.
- No pagination is needed for these aggregate endpoints; larger growth
  attribution queries remain separate Root 1 work.

## Validation

- `node --check src/database/admin-metrics-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-growth-metrics-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-growth-metrics-repository.test.js test/admin-growth-metrics-routes.test.js`
  - 5 pass / 0 fail

## Delegation

No new agent was launched for this slice because the previous read-only
explorer hit the Codex usage limit. Local parallel reads and focused validation
were used instead.
