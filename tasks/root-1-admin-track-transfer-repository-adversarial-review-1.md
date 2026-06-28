# Root 1 Admin Track-Transfer Repository — Adversarial Review 1

Date: 2026-06-27
Scope:
- `src/database/admin-track-transfer-repository.js`
- `src/routes/admin.js` track-transfer route:
  - `POST /admin/tracks/:trackId/transfer`
- `test/admin-track-transfer-repository.test.js`
- `test/admin-track-transfer-routes.test.js`

Out of scope:
- Normal user-facing track creation, render, playback, and share-claim flows.
- Admin UI changes.
- Gift/admin gift operations and billing behavior.

## Boundary Decision

`createAdminTrackTransferRepository(db)` owns only the track-transfer
persistence boundary: track and target-user reads, active render-job detection,
transactional track/library/share-token mutation, audit insertion, and
post-transfer verification reads. `routes/admin.js` keeps superadmin
authorization, HTTP validation/response envelopes, UUID/time selection, error
mapping, and the public response shape.

## Attack Vectors Reviewed

1. Missing superadmin role gate after extraction.
2. Soft-deleted target user accepted as a transfer recipient.
3. Active `running` render job missed because only `queued`/`processing` were checked.
4. Active-job guard done only before the transaction, allowing stale success.
5. Source user library entry survives after ownership transfer.
6. Earlier recipient `received` library entry remains active after transfer.
7. Target user library entry not upserted as a `created` origin.
8. Share token creator not moved to the new owner.
9. Share binding reset clears only device id but leaves platform/app/user/bound-at state.
10. Claim attempts not reset, causing inherited receiver friction.
11. Claim PIN accidentally cleared during owner transfer.
12. Audit row attributed to target user instead of the admin actor.
13. Audit metadata drops admin/source/target attribution.
14. Concurrent owner change silently reports success.
15. Post-transfer response reports success without verifying persisted state.
16. Route order allows an admin SPA wildcard to shadow the transfer route.
17. SQLite/Postgres row-count handling masks zero-change updates.
18. Repository widens into unrelated share/gift lifecycle behavior.

## Findings And Fixes

### Fixed — Soft-deleted target users were eligible

The route now treats a target row with `deleted_at` as missing and returns the
existing `USER_NOT_FOUND` envelope before mutation.

### Fixed — Active render-job guard was incomplete

The repository now treats `queued`, `processing`, and `running` jobs as active.
The transfer transaction re-checks that guard before mutating ownership so the
route-level fast-fail is not the only protection.

### Fixed — Audit actor was misattributed

The transfer audit row now uses the admin actor id as `audit_log.user_id`; the
target/source/admin identities are preserved in metadata.

### Fixed — Transfer left stale access and share binding state

The transaction deletes the source owner's created library entry, soft-removes
active received-library entries for the transferred track, upserts the target
owner's created entry, moves share-token creator ownership, and clears
`bound_device_id`, `bound_device_platform`, `bound_app_version`,
`bound_user_id`, `bound_at`, and `claim_attempts` while preserving `claim_pin`.

### Fixed — Success response was not gated on persisted post-state

After the transaction, the route reads repository verification state and returns
`TRANSFER_VERIFICATION_FAILED` instead of success if ownership, library, or
share-token invariants do not match the requested transfer.

## Deferred Risks

No P0/P1 blocker remains in this slice.

P2 deferred:
- The transaction-level active-job guard prevents stale pre-check success, but
  under normal read-committed semantics it is not a global serialization
  primitive against a render job inserted immediately after the transfer
  transaction reads. A stricter cross-writer lock belongs with the render/job
  state-machine root, not this bounded repository extraction.

## Validation

Focused validation:
- `node --check src/database/admin-track-transfer-repository.js`
- `node --check src/routes/admin.js`
- `node --check test/admin-track-transfer-repository.test.js`
- `node --check test/admin-track-transfer-routes.test.js`
- `node --test --test-concurrency=1 test/admin-track-transfer-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-track-transfer-routes.test.js`
- `npm run lint`
- `git diff --check`
- `npm test`

Result:
- Focused track-transfer tests: 8 passed, 0 failed.
- Full suite: 2,646 passed, 23 skipped, 0 failed.
