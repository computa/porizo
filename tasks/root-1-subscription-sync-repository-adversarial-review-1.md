# Root 1 Subscription Sync Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

Move scheduled subscription-sync selection SQL out of
`jobs/subscription-sync.js` into `database/subscription-sync-repository.js`.
The job keeps validator calls, renewal/expiration decisions, cursor loop
ownership, logging, and result counters.

## Changed Files

- `src/database/subscription-sync-repository.js`
  - Added renewal-candidate and expired-grace-period selectors.
- `src/jobs/subscription-sync.js`
  - Injects/delegates to the repository.
- `test/subscription-sync-repository.test.js`
  - Added direct repository characterization for cursor pagination and
    grace-period expiry selection.

## Attack Vectors Reviewed

1. Renewal selector must keep cursor-based pagination by `s.id`.
2. Active subscriptions with past `expires_at` must still be selected.
3. Grace-period subscriptions with past entitlement renewal dates must still be
   selected.
4. Cancelled subscriptions must not be selected.
5. Manual/non-renewing subscriptions must not be selected.
6. Future expiry and future renewal subscriptions must not be selected.
7. Entitlement `subscription_renews_at` must still be returned for the job.
8. Grace-period expiry selector must only return `status = 'grace_period'`.
9. Active subscriptions with stale grace fields must not be expired.
10. Existing DB-mock job tests must still pass through the default repository.

## Findings

No P0 or P1 findings.

### P2-1 — Candidate selection and mutation remain separate

VERIFIED. The job selects candidates, then external validator calls and
subscription-manager mutations happen later. This is intentional for a
best-effort repair job, but concurrent webhook updates can make a selected row
stale before mutation. Existing subscription-manager methods still own the
state transition safety checks.

## Validation

- `node --check src/database/subscription-sync-repository.js`
- `node --check src/jobs/subscription-sync.js`
- `node --check test/subscription-sync-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 --test-reporter=dot test/subscription-sync-repository.test.js test/subscription-sync-job.test.js`

