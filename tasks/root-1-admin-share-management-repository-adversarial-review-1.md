# Root 1 Admin Share-Management Repository — Adversarial Review 1

Date: 2026-06-27
Scope:
- `src/database/admin-share-management-repository.js`
- `src/services/admin-service.js` share-management methods:
  - `listShares`
  - `rebindShare`
  - `listPoemShares`
  - `resetPoemShareAttempts`
  - `revokePoemShare`
- Admin routes:
  - `GET /admin/dashboard/shares`
  - `POST /admin/dashboard/share/:id/rebind`
  - `GET /admin/dashboard/poem-shares`
  - `POST /admin/dashboard/poem-share/:id/reset-attempts`
  - `POST /admin/dashboard/poem-share/:id/revoke`
- `test/admin-share-management-repository.test.js`
- `test/admin-share-routes.test.js`

Out of scope:
- Growth/share metrics.
- Admin user search/detail share reads.
- Demo-share persistence.
- Track-transfer persistence.
- Gift funding or gift lifecycle behavior.

## Boundary Decision

`createAdminShareManagementRepository(db)` owns only operational share-token and
poem-share-token persistence for the scoped admin share-management routes.
`AdminService` keeps pagination bounds, service-level result interpretation,
audit emission, and route-facing response behavior.

## Attack Vectors Reviewed

1. Song-share list drops `stream_key`.
2. Song-share filters drift for `status`, `trackId`, or owner `userId`.
3. Song-share order changes from `created_at DESC`.
4. Song-share pagination bounds move out of `AdminService`.
5. Song-share rebind changes platform/user/bound-at fields instead of only `bound_device_id`.
6. Song-share missing-resource envelope changes from route `400 REBIND_ERROR`.
7. Song-share rebind audit action/resource/metadata drifts.
8. Viewer admin gains mutation access.
9. Poem-share list drops `claim_pin`, `claim_policy`, `allow_save`, attempts, or access fields.
10. Poem-share filters drift for `status`, `poemId`, or `creator_id`.
11. Poem reset changes anything beyond `claim_attempts`.
12. Poem reset missing-resource envelope changes from route `400 RESET_ERROR`.
13. Poem revoke missing/already-revoked envelope changes from route `400 REVOKE_ERROR`.
14. Already-revoked poem share writes a duplicate audit.
15. Repository overlaps demo-share or track-transfer persistence.
16. SQLite/Postgres adapter compatibility regresses.
17. Inner join semantics accidentally change to left joins and expose orphan rows.
18. Growth/share analytics is silently pulled into this operational slice.

## Findings

No P0 findings.

No P1 findings.

### Deferred P2 — Concurrent poem revoke can double-audit

Severity: P2
Status: INFERRED

Scenario: two admins revoke the same active poem share at the same time. Both
can read `status = 'active'` before either update commits. Because the update is
unconditional (`WHERE id = ?`), both can write `revoked` and both can audit
`poem_share_revoked`.

Disposition: Deferred. This is pre-existing behavior and changing it would be a
mutation-semantics hardening, not required for this movement-only repository
slice. The smallest later fix is a conditional update
`WHERE id = ? AND status != 'revoked'` and service audit only when one row
changed.

### Deferred P3 — Inner joins hide orphan share rows

Severity: P3
Status: VERIFIED

Scenario: an orphan `share_tokens` or `poem_share_tokens` row with a missing
parent track/poem is hidden from the admin list because the existing query uses
inner joins. This matches pre-extraction behavior.

Disposition: Deferred. A cleanup/diagnostics admin view may prefer `LEFT JOIN`,
but this slice preserves the existing dashboard contract.

## Validation

Focused validation:
- `node --check src/database/admin-share-management-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-share-management-repository.test.js`
- `node --check test/admin-share-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-share-management-repository.test.js test/admin-share-routes.test.js`
- `npm run lint`
- `git diff --check`

Result:
- Focused admin share-management tests: 10 passed, 0 failed.
- Adversarial reviewer: zero P0/P1.
