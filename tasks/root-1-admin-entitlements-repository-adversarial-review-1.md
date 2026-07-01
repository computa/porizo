# Root 1 Admin Entitlements Repository — Adversarial Review 1

Date: 2026-06-27

## Pass Verdict

ZERO P0 / ZERO P1 for this bounded slice.

## Scope

- `src/database/admin-entitlements-repository.js`
- `src/services/admin-service.js` `updateUserEntitlements`
- `src/routes/admin.js` `PUT /admin/dashboard/users/:id/entitlements`
- `test/admin-entitlements-routes.test.js`

## Findings

- P0: none found.
- P1: none found after the missing-row `updated_at` fix.

## Correctness Fix Included

Characterization exposed a P1 SQLite/Postgres schema mismatch in the legacy
missing-row branch: `INSERT INTO entitlements (user_id, tier) VALUES (?, ?)`
fails SQLite because `updated_at` is `NOT NULL` without a local default. The new
repository supplies `updated_at` explicitly on insert. Existing-row updates
still update only `tier`, preserving the prior admin override behavior.

## Risks Checked

- The route remains superadmin-only.
- Invalid tiers and empty bodies still return `INVALID_PARAMS`.
- Existing entitlement rows keep non-tier columns and `updated_at` unchanged.
- Missing entitlement rows insert successfully and use schema defaults for
  legacy credit counters.
- Audit metadata remains `{ previous: { tier }, updated: { tier } }`, enriched
  by `_audit` with `actor` and `admin_id`.
- Complimentary-upgrade routes still go through `subscriptionManager`, not the
  new entitlement repository.
- Raw SQL for the admin entitlement tier update path now lives in
  `admin-entitlements-repository.js`.
- Postgres placeholder compatibility remains covered by the shared adapter
  rewrite path.

## Validation

- `node --check src/database/admin-entitlements-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-entitlements-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-entitlements-routes.test.js`
  - 4 pass / 0 fail

## Below-P1 Notes

The route tests intentionally lock in strict behavioral preservation:
existing-row tier updates do not update `updated_at`, and missing-row inserts
inherit legacy credit defaults. This is acceptable for Root 1 repository
extraction, but later billing/entitlement semantics work should revisit whether
admin tier mutation time and effective billing tier should be modeled more
explicitly.

## Delegation

Read-only reviewer `Helmholtz` returned zero P0/P1 and was closed after
completion.
