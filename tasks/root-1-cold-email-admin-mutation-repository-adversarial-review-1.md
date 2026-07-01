# Root 1 Cold-Email Admin Mutation Repository — Adversarial Review 1

Date: 2026-06-27
Scope: `src/database/cold-email-repository.js`, `src/services/cold-email-service.js`,
`src/routes/admin.js`, `test/cold-email-repository.test.js`,
`test/services/cold-email-service.test.js`, `test/admin-marketing-routes.test.js`

## Slice Reviewed

Moved the admin cold-email campaign PATCH persistence from `routes/admin.js` into
`cold-email-repository.js` behind `cold-email-service.updateCampaignFields()`.
The route still owns admin authorization, payload validation, cross-field
window checks, stale-form response shape, and audit metadata assembly.

## Attack Vectors Checked

1. Route-level SQL construction reappears through dynamic `updates.join`.
2. Repository dynamic field names become SQL-injection primitives.
3. Unsupported fields are silently ignored and create a false success.
4. `updated_at` optimistic concurrency is lost or weakened.
5. Legacy callers without `If-Match` can overwrite concurrent writes.
6. Stale `If-Match` returns a different public error envelope.
7. Valid `earliest_run_date_utc: null` is lost through falsy handling.
8. Changed-field audit metadata omits nullable fields.
9. Audit writes happen before persistence and log changes that did not commit.
10. Route validation moves into repository and weakens API-specific messages.
11. Repository method can update scheduling fields not permitted by the UI.
12. `fire_until_utc_hour <= fire_after_utc_hour` validation is bypassed.
13. Pending-count behavior on reloaded campaign changes.
14. Service wrapper cannot be repository-injected in tests.
15. PostgreSQL/SQLite placeholder portability regresses.
16. Manual trigger behavior is accidentally changed.
17. Existing cold-email batch send behavior changes around filtered invalid emails.

## Findings

No P0/P1 findings.

## Evidence

- Route no longer owns the cold-email PATCH `UPDATE`; the remaining
  `UPDATE cold_email_campaigns` statements are inside the repository.
- `updateCampaignFields()` has its own whitelist in addition to route
  validation and rejects unsupported field names before building SQL.
- Optimistic concurrency remains `WHERE id = ? AND COALESCE(updated_at, '') = ?`.
- Route tests pin 200 patch success, audit `before/after` metadata, nullable
  date mutation, and 409 stale-update no-mutation behavior.
- Repository tests pin whitelisted update semantics, stale expected timestamp
  behavior, and unsupported-field rejection.
- Service test pins injected repository delegation.

## Deferred / Non-Blocking

- P2: Cold-email route still owns a large validation block. That is acceptable
  for Root 1 because this slice is only persistence extraction. Route slimming
  belongs in Root 6/admin split after repository coverage is broader.
- P2: `cold-email-repository.js` centralizes both scheduler and admin mutation
  persistence. Keep it for now because both touch `cold_email_campaigns`; split
  only if admin campaign editing grows materially beyond the scheduler schema.

## Validation

- `node --check src/database/cold-email-repository.js`
- `node --check src/services/cold-email-service.js`
- `node --check src/routes/admin.js`
- `node --check test/cold-email-repository.test.js`
- `node --check test/admin-marketing-routes.test.js`
- `node --check test/services/cold-email-service.test.js`
- `node --test test/cold-email-repository.test.js test/services/cold-email-service.test.js test/admin-marketing-routes.test.js`
  - 45 pass / 0 fail
