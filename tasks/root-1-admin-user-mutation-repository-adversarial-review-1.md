# Root 1 Admin User Mutation Repository — Adversarial Review 1

Date: 2026-06-27

## Pass Verdict

ZERO P0 / ZERO P1 found by local adversarial review after extraction.

## Scope

- `src/database/admin-user-mutation-repository.js`
- `src/services/admin-service.js`
  - `updateUserRisk`
  - `lockUser`
  - `deleteUser`
  - `bulkUserAction`
  - `updateUserProfile`
- `src/routes/admin.js`
  - `PUT /admin/dashboard/users/:id/risk`
  - `POST /admin/dashboard/users/:id/lock`
  - `DELETE /admin/dashboard/users/:id`
  - `POST /admin/dashboard/users/bulk-action`
  - `PUT /admin/dashboard/users/:id/profile`
- `test/admin-user-mutations-routes.test.js`

## Findings

- P0: none found.
- P1: none found.

## Risks Checked

- Risk update remains available to any authenticated admin session, with route
  validation for `low`, `medium`, and `high`.
- Lock, delete, bulk action, and profile update remain superadmin-only.
- Lock/unlock still calculate the one-year lock timestamp in `AdminService`,
  store it on `users.locked_until`, and audit `admin_lock_user` /
  `admin_unlock_user`.
- Delete still reads the user snapshot before deleting, audits
  `admin_delete_user` before the delete, and returns the same deleted payload.
- Missing delete target still returns the route-level `USER_NOT_FOUND` envelope.
- Profile update still ignores unknown fields, rejects bodies with no allowed
  fields, updates only allowed columns, and returns the `updated` object.
- Dynamic profile update column safety remains enforced inside the repository.
- Attribution override audit still records the
  `attribution-source-precedence-v1` contract with previous/next snapshots and
  changed fields.
- Bulk action stays orchestration in `AdminService`; this slice only changes the
  persistence methods it calls.

## Validation

- `node --check src/database/admin-user-mutation-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-user-mutations-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-user-mutations-routes.test.js`
  - 4 pass / 0 fail

## Delegation

Explorer `Euler` and reviewer `Meitner` were launched read-only but did not
return after bounded waits. Both were closed while running to free local
resources. This review record therefore uses the local adversarial pass and
focused validation as the slice verdict.
