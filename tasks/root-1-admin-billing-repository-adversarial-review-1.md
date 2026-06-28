# Root 1 Admin Billing Repository Extraction — Adversarial Review 1

Date: 2026-06-27
Scope: `src/database/admin-billing-repository.js`, `src/services/admin-service.js`,
`test/admin-billing-repository.test.js`, `test/admin-billing-sales.test.js`.

## Root Scope

Move admin billing dashboard read persistence out of `AdminService` into a
repository while preserving all existing response semantics for:

- `/admin/dashboard/billing/sales`
- `/admin/dashboard/billing/revenue`
- `/admin/dashboard/billing/subscriptions`
- `/admin/dashboard/billing/transactions`
- `/admin/billing/users/:targetUserId`

Out of scope: public receipt validation/mutation, subscription-manager lifecycle
writes, cost metrics, and `daily_aggregates`.

## Attack Vectors Reviewed

1. Trial receipts accidentally counted as paid sales.
2. Zero-amount receipts accidentally counted as paid sales.
3. Unknown-amount receipts dropped instead of counted as sales.
4. Mixed-currency scalar revenue summed instead of returning `null`.
5. Product-catalog fallback price drift for receipts without price payloads.
6. Current-subscriber count capped by the 100-row preview list.
7. Expired `active` subscriptions counted as current.
8. `grace_period`/`billing_retry` subscriptions excluded despite future grace.
9. Receipt pagination changed by filtering before scanning raw rows.
10. Strict `purchase_date > since` changed to inclusive semantics.
11. `user_contacts.is_primary` boolean portability regressed.
12. Gift token count lost by breaking the gift-wallet receipt join.
13. Service still directly touches DB for the moved read boundary.
14. Revenue metrics churn denominator changed.
15. Subscription health week-window comparisons changed.
16. Route response shape changed under existing admin dashboard tests.
17. Repository widened into public billing mutation paths.
18. Repository mixed with cost metrics / `daily_aggregates`.
19. Admin user-billing snapshot changed latest-subscription ordering.
20. Admin user-billing snapshot leaked extra receipt columns.

## Findings

No P0 findings.

No P1 findings.

### P2-1 — AdminService Still Owns Billing Normalization

Severity: P2
Status: VERIFIED

Scenario: SQL moved to the repository, but `AdminService` still owns receipt
money extraction, sale classification, current-subscriber normalization,
scan-after-filter pagination, and response composition. That is acceptable for
Root 1 repository extraction, but Root 6 still needs an admin billing service
split so the god service shrinks by responsibility, not only by query count.

Smallest fix sketch: after Root 1 reaches termination, move the billing
normalization/response methods into an `admin-billing-service` facade that
depends on `admin-billing-repository`.

Disposition: Deferred to Root 6. Not a correctness blocker for this root.

## Termination Check

- P0/P1 count: 0.
- Characterization coverage exists for public response shape and repository
  query behavior.
- Focused validation passed:
  - `node --test --test-concurrency=1 test/admin-billing-repository.test.js test/admin-billing-sales.test.js`
  - `node --test --test-concurrency=1 test/admin-billing-repository.test.js test/admin-billing-sales.test.js test/billing-api.test.js`
  - `npm run lint`

Root 1 admin billing dashboard read extraction terminates for this slice.
