# Root 1 — Admin Gift Bundles Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/admin-billing-repository.js`
- `src/routes/admin.js`
- `test/admin-billing-repository.test.js`
- `test/admin-gift-bundles-routes.test.js`

Root boundary:
- In scope: admin gift-bundle list/get/update/refetch persistence for `/admin/billing/gift-bundles`.
- Out of scope: StoreKit/App Store Connect product reconciliation, public app-config gift-bundle reads, Apple/Google receipt handling, gift-wallet ledger behavior, and pricing strategy.

Reviewer mode: local adversarial pass. No new subagents launched because prior agent cleanup remained nonresponsive to bounded interrupt/wait.

## Attack Vectors

1. P0 check — non-superadmins can mutate gift bundles.
   - Result: NOT FOUND. `PUT /admin/billing/gift-bundles/:id` still calls `requireAdminRole(..., ["superadmin"])`.
   - Coverage: route test creates a plain admin and verifies 403.

2. P0 check — route starts accepting unsafe update columns.
   - Result: NOT FOUND. Route filtering still keeps the original five allowed fields. The repository also has its own allowed-column set as defense-in-depth.

3. P0 check — invalid `token_count` or `sort_order` bypasses validation.
   - Result: NOT FOUND. Validation remains route-owned before the repository update call.
   - Coverage: route test pins `INVALID_TOKEN_COUNT`.

4. P0 check — missing bundle creates or updates a row.
   - Result: NOT FOUND. Route still reads the previous bundle first and returns `BUNDLE_NOT_FOUND` before mutation.
   - Coverage: route test pins 404 envelope.

5. P1 check — list ordering changes and admin UI gets unstable rows.
   - Result: NOT FOUND. Repository preserves `ORDER BY sort_order ASC`.
   - Coverage: repository and route tests assert row id order.

6. P1 check — audit payload loses previous/updated values.
   - Result: NOT FOUND. Route still owns previous-value projection and `filteredUpdates` payload.
   - Coverage: route test asserts `admin_update_gift_bundle` audit metadata.

7. P1 check — `updated_by` attribution is lost.
   - Result: NOT FOUND. Repository binds `updated_by = admin.adminId`, preserving the old route behavior.
   - Coverage: repository test asserts `updated_by`.

8. P1 check — public app-config gift bundle behavior changes.
   - Result: NOT FOUND. Public app-config still uses `app-config-repository.js`; this slice only changes admin billing routes.

9. P1 check — receipt/product catalog dashboard queries regress.
   - Result: NOT FOUND. Existing `AdminBillingRepository` tests for product catalog, receipt sales, subscribers, health, and user snapshot still pass.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: Admin billing route code still owns validation and audit construction inline. A later Root 6 admin split should move gift-bundle orchestration into an admin billing service after the remaining admin route persistence is behind repositories.

## Validation

- `node --check src/database/admin-billing-repository.js`
- `node --check src/routes/admin.js`
- `node --check test/admin-billing-repository.test.js`
- `node --check test/admin-gift-bundles-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-billing-repository.test.js test/admin-gift-bundles-routes.test.js`

Focused result: 10 pass / 0 fail.
