# Root 1 — Admin Analytics Events Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/events-repository.js`
- `src/services/admin-service.js`
- `test/events-repository.test.js`
- `test/admin-analytics.test.js`

Root boundary:
- In scope: admin analytics event-count, daily-count, cohort-funnel, user-event read, and `analytics.user.read` audit persistence.
- Out of scope: billing/revenue, cost metrics, teaser/share growth metrics, enrollment metrics, render metrics, and admin gift/share route extraction.

Reviewer mode: local adversarial pass, informed by two bounded read-only explorer agents. Both agents were closed after completion.

## Attack Vectors

1. P0 check — `created_at > ?` accidentally changed to `created_at >= ?`, pulling boundary events into admin dashboards.
   - Result: NOT FOUND. New `getAdmin*After` repository helpers retain strict `>`.
   - Coverage: `admin analytics helpers preserve strict after-window and cohort semantics`.

2. P0 check — admin analytics overview accidentally uses the older public `getEventCountsSince()` helper, changing cutoff semantics.
   - Result: NOT FOUND. `AdminService.getAnalyticsOverview()` calls `getAdminEventCountsAfter()`.

3. P0 check — user analytics read stops writing an audit row.
   - Result: NOT FOUND. `getUserAnalytics()` delegates to `insertUserAnalyticsReadAudit()`.
   - Coverage: route test plus direct service-boundary fake-repository test.

4. P0 check — audit action/resource shape changes from `analytics.user.read` / `user_analytics`.
   - Result: NOT FOUND. Repository hard-codes the same action and resource type.
   - Coverage: repository audit row shape test.

5. P0 check — audit metadata drops `admin_id`, `admin_email`, `target_user_id`, or `event_count`.
   - Result: NOT FOUND. Metadata remains assembled in `AdminService`; direct boundary test asserts exact fields.

6. P0 check — cohort conversion query counts end events before the user's start event.
   - Result: NOT FOUND. Repository uses `e.created_at >= s.created_at`.
   - Coverage: repository test seeds an end-before-start row and expects it not to convert.

7. P0 check — null-user events inflate cohort starts/conversions.
   - Result: NOT FOUND. Both start and conversion queries require `s.user_id IS NOT NULL`; start query requires `user_id IS NOT NULL`.

8. P1 check — user analytics returns `SELECT *` and leaks IP/user-agent or future event columns.
   - Result: NOT FOUND. Repository selects the same seven columns as the prior inline query.
   - Coverage: repository test asserts selected key set.

9. P1 check — limit clamping moves into repository or is lost, allowing unbounded user-event reads.
   - Result: NOT FOUND. `AdminService` still clamps with `_clampLimit(limit, 200)` before repository call.
   - Coverage: direct service-boundary test verifies `999 -> 200`.

10. P1 check — analytics response cache moves into persistence and becomes cross-consumer state.
    - Result: NOT FOUND. Cache remains in `AdminService`; repository is stateless.
    - Coverage: route cache test and direct service-boundary cache test.

11. P1 check — cache key or clamped-days behavior changes for `days=0` and `days=500`.
    - Result: NOT FOUND. `_clampDays()` and service cache keys remain unchanged.

12. P1 check — daily endpoint loses empty-array behavior for unknown event names.
    - Result: NOT FOUND. Repository `.all()` returns an empty array; route test remains green.

13. P1 check — repository helper names invite accidental use by public events service.
    - Result: LOW RISK. Helpers are exported but only called by `AdminService`. Existing public service keeps its older helpers. No P0/P1.

14. P1 check — direct repository audit insert bypasses the general `_audit()` actor enrichment and unintentionally changes this endpoint.
    - Result: NOT FOUND. The previous inline implementation also did not include the `_audit()` `actor` field. This preserves existing wire/persistence behavior.

15. P1 check — revenue/cost SQL accidentally bundled into this slice.
    - Result: NOT FOUND. Revenue/cost paths are untouched in this slice.

16. P1 check — repository construction breaks existing `AdminService` tests that inject other repositories.
    - Result: NOT FOUND in focused validation. Constructor accepts `options.eventsRepository`; default repository is lazy over the injected db like existing repository fields.

17. P2 check — `EventsRepository` now contains admin-specific helper names.
    - Result: ACCEPTED. This is preferable to creating a duplicate `AdminAnalyticsRepository` over the same aggregate. If the repository grows further, split read-model repositories by table ownership, not dashboard naming.

## Findings

No P0 findings.

No P1 findings.

Deferred P2:
- `EventsRepository` now has admin-specific read helpers. Keep for now because it centralizes event-table persistence and avoids a duplicate repository. Revisit if billing/cost/admin read models start mixing unrelated aggregates into this file.

## Validation

- `node --check src/database/events-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/events-repository.test.js`
- `node --check test/admin-analytics.test.js`
- `node --test test/events-repository.test.js test/admin-analytics.test.js`

Focused result: 15 tests passed, 0 failed.
