# Root 1 Admin Marketing Repository — Adversarial Review 1

Date: 2026-06-27

Scope reviewed:
- `src/database/admin-marketing-repository.js`
- `src/routes/admin.js` admin marketing contact/campaign/push/engagement endpoints
- `test/admin-marketing-repository.test.js`
- `test/admin-marketing-routes.test.js`

Changed behavior surface:
- Public admin route validation and response envelopes should remain unchanged.
- Persistence for `marketing_contacts`, `marketing_campaigns`,
  `marketing_engagements`, and `push_campaigns` moved behind
  `createAdminMarketingRepository(db)`.
- Manual `BEGIN`/`COMMIT` batch paths were replaced with adapter transactions.

Validation run before review:
- `node --check src/database/admin-marketing-repository.js`
- `node --check src/routes/admin.js`
- `node --check test/admin-marketing-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-marketing-repository.test.js test/admin-marketing-routes.test.js test/cold-email-repository.test.js test/services/cold-email-service.test.js test/jobs/cold-email-daily.test.js`

Attack vectors checked:
1. Search wildcard escaping changes result set semantics.
2. Invalid status / boolean filters bypass route validation after repository move.
3. Contact CSV duplicate email row inserts duplicate contacts inside one import.
4. Contact CSV company+website fallback dedupe regresses for `NULL` website.
5. Contact CSV URL sanitation moves below persistence by accident.
6. Contact CSV batch partially commits when one row fails.
7. Campaign create returns stale or missing created row.
8. Campaign update allows unvalidated dynamic column names.
9. Campaign update silently mutates no row after a deleted campaign.
10. Push send records push row but fails to update campaign status.
11. Push send updates campaign status but fails to insert push row.
12. GMass import loses additive OR-merge behavior.
13. GMass import changes bounced/unsubscribed one-way status behavior.
14. GMass import aggregate stats drift from `marketing_engagements`.
15. GMass import partially commits engagement rows on later failure.
16. Engagement list count and page rows use different filters.
17. Contact export changes all-contact vs campaign-filtered behavior.
18. SQLite/Postgres upsert merge function compatibility.
19. Repository introduces service-layer dependency cycles.
20. Existing cold-email campaign behavior is accidentally pulled into this slice.

Findings:

- No P0/P1 findings.

- P2-INFERRED — concurrent CSV dedupe remains best-effort.
  Scenario: two admins upload the same new contact at the same time. The email
  path is ultimately protected by the existing partial unique index, so one
  writer may see a transaction error instead of a graceful `skipped` count.
  The company+website fallback path has no unique index, so two concurrent
  writers can still insert duplicate legacy B2B rows. This existed before the
  repository move. Smallest fix: add a schema-backed fingerprint/advisory-lock
  migration for legacy no-email contacts and catch unique-email conflicts as
  skipped rows. Deferred because this slice is persistence-boundary movement,
  not schema semantics.

Accepted checks:
- Route validation still owns status/boolean/campaign field checks.
- Repository dynamic campaign updates are re-allowlisted with
  `CAMPAIGN_UPDATE_COLUMNS`.
- Batch contact import, push-send persistence, and GMass import now run in
  database adapter transactions.
- GMass import uses `MAX` for SQLite and `GREATEST` for Postgres, avoiding the
  previous SQLite-only merge expression.
- No new dependency from `database/*` to `services/*`.
