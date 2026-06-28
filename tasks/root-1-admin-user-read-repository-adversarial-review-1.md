# Root 1 Admin User-Read Repository — Adversarial Review 1

Reviewed the Root 1 admin user-read persistence slice:

- `src/database/admin-user-read-repository.js`
- `src/services/admin-service.js`
  - `searchUsers`
  - `getUserStats`
  - `getUserDetail`
- `test/admin-user-read-repository.test.js`
- `test/admin-user-read-routes.test.js`
- Existing attribution guard: `test/admin-attribution.test.js`

## Result

No P0 findings.

One P1 was found and fixed before the search/detail handoff. The later stats
sub-slice returned zero P0/P1 findings.

## P1 Fixed

### Duplicate live voice profiles duplicated search rows

The first extraction preserved the old direct join:

```sql
LEFT JOIN voice_profiles vp ON vp.user_id = u.id AND vp.deleted_at IS NULL
```

That meant a user with two non-deleted voice profiles could appear twice in
`/admin/dashboard/users`, while the count query still returned
`COUNT(DISTINCT u.id) = 1`. Detail reads also selected one live voice profile
without an explicit ordering.

Fix:

- Search now joins to one deterministic live voice profile per user.
- Detail voice-profile reads use the same latest-profile ordering.
- Regression coverage seeds two live profiles for one user and asserts one
  search row, `total = 1`, and latest-profile status/detail selection.

## Verified Contracts

- User search filters: email, user id, risk level, tier, track id, share id,
  recipient name.
- LIKE escaping for `%`, `_`, and `\`.
- `tier=free` includes users without an `entitlements` row.
- Pagination bounds stay in `AdminService`; SQL receives bounded values.
- Search metrics: tier, gift songs used, track count, voice status, last active.
- User detail fan-out: user, voice profile, entitlements, latest subscription,
  latest tracks, latest shares, latest matched download attribution, latest
  resolved Apple Ads attribution.
- User stats: total users, paid users from stored `pro`/`plus`, trial users,
  free users from stored `free` or missing entitlement row, and one-decimal
  string `conversionRate`.
- User stats keeps current stored-tier-only semantics: `admin_upgrade_tier` and
  legacy `premium` do not affect this endpoint in Root 1.
- User stats route requires an admin session and keeps the bare JSON success
  response shape consumed by the admin UI.
- Canonical attribution merge precedence remains owned by `AttributionService`.
- Missing user detail keeps the route-level `404 { error: "NOT_FOUND" }`
  envelope.
- SQLite/Postgres placeholder compatibility remains inside the DB adapter; the
  new SQL adds no positional placeholders in nested subqueries.

## Stats Adversarial Pass

Reviewer: Pascal.

Result: zero P0/P1 findings.

Reviewed risks:

- Auth bypass through route movement.
- Response-shape drift, especially `conversionRate` becoming numeric.
- Empty-result `SUM()` null handling.
- Stored-tier semantics for `free`, missing entitlement, `trial`, `pro`, `plus`,
  `admin_upgrade_tier`, and legacy `premium`.
- Count inflation from non-unique joins.
- Deleted-user policy drift.
- SQLite/Postgres placeholder compatibility.
- Accidental scope creep into search/detail behavior.

## Validation

- `node --check src/database/admin-user-read-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-user-read-repository.test.js`
- `node --check test/admin-user-read-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-user-read-repository.test.js test/admin-user-read-routes.test.js test/admin-attribution.test.js`
  - 28 pass / 0 fail
- `npm run lint`
- `git diff --check`
