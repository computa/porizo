# Root 1 Plan Config Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

Move subscription plan, plan-product mapping, and trial-config SQL out of
`services/plan-config.js` into `database/plan-config-repository.js`.
`plan-config.js` keeps cache ownership, public plan-shape mapping, ID
generation, allowance lookup policy, and fail-closed trial behavior.

## Changed Files

- `src/database/plan-config-repository.js`
  - Added plan list/create/update, trial config read/insert/update, and
    plan-product mapping read/write methods.
- `src/services/plan-config.js`
  - Injects the repository and delegates all SQL.
- `test/plan-config-repository.test.js`
  - Added direct repository characterization for plan list/update, trial config,
    product mappings, and plan creation.

## Attack Vectors Reviewed

1. Active plans must still exclude inactive rows by default.
2. Include-inactive query must still return inactive rows.
3. Plan ordering must remain `sort_order ASC, id ASC`.
4. Feature arrays must still serialize to `features_json`.
5. Unknown plan update fields must not persist.
6. Empty/unknown update payload must still throw `No valid fields to update`.
7. Trial config missing-row behavior must remain service-owned and fail closed.
8. Trial insert path must still create `id = 1`.
9. Trial update path must preserve boolean integer storage.
10. Existing product mapping should update instead of duplicating.
11. Product mappings should join only active plans for lookup.
12. Product removal must key by platform and product ID.
13. Plan creation must persist defaulted poems/previews/pricing fields.
14. Cache invalidation must still happen after service mutations.
15. No SQL should remain in `services/plan-config.js`.

## Findings

No P0 or P1 findings.

### P2-1 — Multi-step service mutations are still not transactional

VERIFIED. `updateTrialConfig()` reads current cached/default state, checks row
existence, then inserts or updates. `addProductMapping()` checks existence then
updates or inserts. This preserves existing behavior, but concurrent admin
writes can still race. A later config-admin hardening pass should consolidate
those into repository upserts or transactions.

### P3-1 — Service tests still mutate DB directly for cache assertions

VERIFIED. Existing `test/plan-config.test.js` intentionally bypasses the
service to assert cache behavior. That is still useful, but direct DB mutation
in the service test means this area has both repository-level and integration
coverage rather than a fully mockable service-only test suite.

## Validation

- `node --check src/database/plan-config-repository.js`
- `node --check src/services/plan-config.js`
- `node --check test/plan-config-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 --test-reporter=dot test/plan-config-repository.test.js test/plan-config.test.js`

