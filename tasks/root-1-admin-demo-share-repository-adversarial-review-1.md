# Root 1 Admin Demo-Share Repository — Adversarial Review 1

Date: 2026-06-27
Scope:
- `src/database/admin-demo-share-repository.js`
- `src/routes/admin.js` demo-share routes:
  - `POST /admin/dashboard/demo-shares`
  - `GET /admin/dashboard/demo-shares`
  - `POST /admin/dashboard/demo-share/:id/revoke`
- `test/admin-demo-share-repository.test.js`
- `test/admin-demo-share-routes.test.js`

Out of scope:
- Normal share creation in `src/services/share-service.js`.
- Public demo playback/claim semantics in `src/routes/sharing.js` and
  `src/routes/poems.js`.
- Gift/receiver lifecycle share-token mutation.
- Admin track-transfer persistence.

## Boundary Decision

`createAdminDemoShareRepository(db)` owns only demo-share persistence:
track/poem existence reads, latest track-version read, existing demo-token
lookup, demo-token insert/convert/list/revoke, and track `share_token_id`
linking. `routes/admin.js` keeps HTTP auth, request validation, fixed demo
expiry, UUID/time selection, public URL construction, audit calls, error mapping,
and response shape.

## Attack Vectors Reviewed

1. Missing route auth after extraction.
2. Viewer admin allowed to create/revoke demo shares.
3. Existing gift/manual token mutated into a demo token after migration 080
   removed one-token-per-asset uniqueness.
4. Nondeterministic existing-token lookup with multiple share rows.
5. Song demo conversion failing to clear device/user binding.
6. Poem demo conversion failing to clear user binding/attempt state.
7. Demo revoke accidentally revoking non-demo share rows.
8. Demo listing leaking non-demo share rows.
9. Song demo insert using a non-latest track version.
10. Song demo insert failing to link `tracks.share_token_id`.
11. Missing track/poem error-code drift.
12. Missing rendered-version error-code drift.
13. Audit action/resource/metadata drift.
14. URL construction drift for `/play` vs `/poem`.
15. Existing public demo playback contracts accidentally moved.
16. Transaction scope inflation beyond persistence extraction.
17. Revenue/gift lifecycle behavior changed without owner gate.
18. SQLite/Postgres placeholder compatibility.
19. Route-level tests relying on fixed wall-clock timestamps.
20. Lingering broad SQL in demo-share routes after extraction.

## Findings

### Fixed — Non-demo share-token mutation hazard

Before this slice, demo creation used `SELECT * FROM share_tokens WHERE track_id = ?`
and `SELECT * FROM poem_share_tokens WHERE poem_id = ?`. After migration 080,
multiple tokens per asset are valid, so that lookup could mutate an arbitrary
gift/manual token into a demo token.

Fix:
- Repository lookup now reuses only `share_type = 'demo'` rows, ordered by
  `created_at DESC, id DESC`.
- If an asset has only non-demo tokens, the route creates a new demo token and
  preserves the existing token.
- Tests pin preservation for song and poem non-demo tokens.

### Fixed — Demo-share mutation route too broad

Before this slice, create/revoke required only a valid admin session. Adjacent
share mutation routes require `admin` or `superadmin`.

Fix:
- `POST /admin/dashboard/demo-shares` now uses `requireAdminRole(...,
  ["admin", "superadmin"])`.
- `POST /admin/dashboard/demo-share/:id/revoke` now uses the same role gate.
- Route tests pin viewer 403 behavior.

## Deferred Risks

No P0/P1 blocker remains in this slice.

P2 deferred:
- Demo create/convert plus audit is not wrapped in one transaction. That is
  pre-existing behavior and should be considered when Root 6 splits admin
  services/routes further.
- Song demo creation still selects the latest track version without checking
  render-readiness beyond the existing route's `NO_VERSION` condition. Changing
  readiness policy should be a product/API decision, not hidden in Root 1.
- Poem demo creation still does not check poem content readiness. Same product
  boundary as above.
- Poem conversion clears `bound_user_id` and attempts, matching current code;
  it does not clear `bound_device_id`/`bound_at`. Public guards rely on
  `share_type` and status. This should be reviewed with public poem-share
  semantics before changing.
- Revocation only sets `status = 'revoked'`; it does not clear web/save
  permissions or write `revoked_at`. Public guards already use status.

## Validation

Focused validation:
- `node --check src/database/admin-demo-share-repository.js`
- `node --check src/routes/admin.js`
- `node --check test/admin-demo-share-repository.test.js`
- `node --check test/admin-demo-share-routes.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-demo-share-repository.test.js test/admin-demo-share-routes.test.js`

Result:
- 8 tests passed, 0 failed.
