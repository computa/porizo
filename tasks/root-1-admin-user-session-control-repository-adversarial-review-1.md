# Root 1 Admin User Session Control Repository — Adversarial Review 1

Date: 2026-06-27

## Pass Verdict

ZERO P0 / ZERO P1 remaining after local extraction, focused tests, and a
read-only explorer review.

## Scope

- `src/database/admin-user-session-control-repository.js`
- `src/services/admin-service.js`
  - `forceVoiceReverify`
  - `getUserSessions`
  - `revokeUserSession`
  - `revokeAllUserSessions`
- `src/routes/admin.js`
  - `GET /admin/dashboard/users/:userId/sessions`
  - `POST /admin/dashboard/users/:userId/sessions/:sessionId/revoke`
  - `POST /admin/dashboard/users/:userId/sessions/revoke-all`
  - `POST /admin/dashboard/users/:userId/voice/force-reverify`
- `test/admin-user-session-control-repository.test.js`
- `test/admin-user-session-controls-routes.test.js`

## Findings

- P0: none found.
- P1: none remaining.
- P2 fixed: voice reverify previously selected an arbitrary eligible
  voice profile when multiple `active`/`completed` non-deleted rows existed.
  The repository now selects deterministically by `created_at DESC, id DESC`,
  matching the existing latest-profile convention used elsewhere.
- P2 fixed: voice reverify previously selected then unconditionally updated by
  id. The repository update now rechecks `status IN ('completed', 'active')`
  and `deleted_at IS NULL`; the service returns the existing not-found result
  and does not audit if the update no-ops.
- P2 fixed: active-session ordering previously depended on database-specific
  `NULL` ordering for `last_active_at`. The repository now orders non-null
  `last_active_at` first, then `last_active_at DESC`, `created_at DESC`,
  `id DESC`.

## Risks Checked

- `GET /sessions` still requires an authenticated admin session and returns
  `{ sessions }` with active sessions only.
- Session listing keeps the same selected columns and now has explicit
  SQLite/Postgres ordering for null and tied activity timestamps.
- Single-session revocation remains superadmin-only, only changes matching
  active sessions for the target user, and returns the existing
  `SESSION_NOT_FOUND` envelope for missing/already-revoked rows.
- Revoke-all remains superadmin-only, affects only unrevoked sessions for the
  target user, and returns `{ success: true, sessionsRevoked }`.
- Force voice reverify remains superadmin-only, writes
  `pending_reverification`, clears `last_verified_at`, returns
  `{ success: true, voiceProfileId }`, and preserves the existing
  `VOICE_PROFILE_NOT_FOUND` envelope.
- Audit semantics stay in `AdminService`: `audit_logs.user_id` is the admin id,
  target user id stays in metadata, and no audit is written for no-op voice
  reverify updates.

## Residual Risks

- Mutation plus audit is not transactionally atomic for this service slice.
  This is pre-existing across multiple admin mutation paths and should be
  handled as a shared admin-audit transaction boundary, not as a one-off patch
  inside this repository.
- Admin-supplied reasons remain free-form. That is also cross-cutting across
  admin mutation routes and should be normalized once for admin audit inputs.
- This slice does not add the heavier auth-token invalidation integration test
  that proves a revoked `user_sessions` row rejects existing user tokens; that
  belongs to the auth/session root because the enforcement lives outside
  `AdminService`.

## Validation

- `node --check src/database/admin-user-session-control-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-user-session-control-repository.test.js`
- `node --check test/admin-user-session-controls-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-user-session-control-repository.test.js test/admin-user-session-controls-routes.test.js`
  - 11 pass / 0 fail

## Delegation

- Two inherited explorer agents (`Popper`, `Bacon`) did not return after a
  bounded wait and were closed while running to free resources.
- Explorer `Pauli` completed read-only review and was closed. Its concrete
  findings drove the deterministic voice-profile selection, stale-eligibility
  guard, and cross-database null-ordering fix. Wider audit-atomicity and reason
  validation items are recorded above as residual cross-cutting risks.
