# Root 1 — Admin Audit Log Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/events-repository.js`
- `src/services/admin-service.js`
- `test/events-repository.test.js`
- `test/admin-analytics.test.js`

Root boundary:
- In scope: generic `audit_logs` insert persistence used by `AdminService._audit()`.
- Out of scope: admin audit read/search metrics, route authorization, billing/revenue audit rows, and splitting `admin-service.js` by concern.

Reviewer mode: local adversarial pass. Two bounded explorer agents completed separate next-slice discovery and were closed before this implementation; they did not edit code.

## Attack Vectors

1. P0 check — admin audit logging silently stops writing rows.
   - Result: NOT FOUND. `AdminService._audit()` now delegates to `eventsRepository.insertAuditLog()`.
   - Coverage: service-boundary test captures the delegated payload.

2. P0 check — the service still writes directly through `this.db.prepare()`.
   - Result: NOT FOUND. The new boundary test constructs `AdminService` with a DB stub that throws on `prepare()`.
   - Coverage: `delegates admin audit writes to EventsRepository`.

3. P0 check — audit actor attribution changes.
   - Result: NOT FOUND. `_audit()` still enriches metadata with `actor: "admin"` and `admin_id`.
   - Coverage: service-boundary test asserts exact metadata JSON after delegation.

4. P0 check — audit ID generation moves into the repository and loses the secure random `audit_` format.
   - Result: NOT FOUND. `AdminService` still owns `generateAuditId()`.
   - Coverage: service-boundary test asserts `audit_[a-f0-9]{24}`.

5. P0 check — action/resource values are normalized or renamed by the repository.
   - Result: NOT FOUND. Repository accepts explicit action/resource fields and inserts them unchanged.
   - Coverage: generic repository test asserts `admin_lock_user` / `user` / `user_locked`.

6. P0 check — timestamp ownership moves into SQL `CURRENT_TIMESTAMP`, changing ISO timestamp shape.
   - Result: NOT FOUND. `AdminService` still supplies `new Date().toISOString()`, and repository persists caller-supplied `createdAt`.
   - Coverage: service-boundary and repository tests assert supplied timestamp shape/value.

7. P1 check — existing `analytics.user.read` audit behavior regresses while generalizing the insert.
   - Result: NOT FOUND. `insertUserAnalyticsReadAudit()` now delegates to `insertAuditLog()` with the same action, resource type, target user, metadata, and timestamp.
   - Coverage: existing repository analytics audit row test remains green.

8. P1 check — generic audit insertion is placed in a new one-method repository, increasing fragmentation.
   - Result: NOT FOUND. The method lives in `events-repository.js`, which already owned event/audit telemetry persistence for the admin analytics slice.

9. P1 check — repository starts assembling domain metadata, blurring service/repository responsibility.
   - Result: NOT FOUND. Repository only inserts provided fields; metadata enrichment remains service-owned.

10. P1 check — this slice expands into admin route or authorization behavior.
    - Result: NOT FOUND. No route code or auth checks were touched.

11. P2 check — `events-repository.js` now owns both `events` and `audit_logs`.
    - Result: ACCEPTED. The repository already owned an `audit_logs` insert for analytics reads; this change removes duplication rather than introducing a new aggregate mix. Revisit if audit-log reads/searches grow enough to justify a dedicated audit repository.

## Findings

No P0 findings.

No P1 findings.

Deferred P2:
- `events-repository.js` is now the telemetry/audit persistence boundary rather than events-only. Keep the name for this incremental Root 1 pass to avoid churn; reconsider during the admin-service split if audit reads/writes become large enough for a dedicated repository.

## Validation

- `node --check src/database/events-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/events-repository.test.js`
- `node --check test/admin-analytics.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/events-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-analytics.test.js`

Focused result: 17 tests passed, 0 failed.
