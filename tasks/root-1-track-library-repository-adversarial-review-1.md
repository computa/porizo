# Root 1 — Track Library Repository Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/track-library-repository.js`
- `src/routes/tracks.js`
- `src/server.js`
- `test/track-library-repository.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

Root boundary:
- In scope: `/tracks` library listing, `DELETE /tracks/:id` library removal,
  server-injected `getTrackForLibrary`, and server-injected
  `upsertTrackLibraryEntry`.
- Out of scope: track create/update persistence, version allocation, render
  job transactions, entitlement spend, share-token creation/revocation,
  artwork access, gift reservation mutations, and story route library-entry
  creation.

Reviewer mode: local adversarial pass. No new subagents were launched because
inherited agent sessions remained nonresponsive and prior close attempts hung;
this slice used bounded local parallel reads/checks instead.

## Attack Vectors

1. P0 check — `/tracks` starts returning tracks outside the caller's active
   library.
   - Result: NOT FOUND. Repository keeps the join on `tle.user_id = ?` and
     `tle.removed_at IS NULL`.
   - Coverage: repository test seeds owned, received, and removed rows and
     asserts only active caller-library rows appear.

2. P0 check — soft-deleted canonical tracks appear in the library.
   - Result: NOT FOUND. Repository keeps `t.deleted_at IS NULL`.
   - Coverage: repository test seeds a deleted track and asserts it is absent.

3. P0 check — gift-token creator-side rows appear in `/tracks`.
   - Result: NOT FOUND. Repository keeps
     `NOT (COALESCE(t.funding_source, 'standard') = 'gift_token' AND tle.origin = 'created')`.
   - Coverage: repository test seeds this case and asserts it is absent.

4. P0 check — deleting a track globally deletes canonical content instead of
   removing the caller's library membership.
   - Result: NOT FOUND. Route still calls a membership update; repository
     updates only `track_library_entries.removed_at`.
   - Coverage: repository test covers idempotent membership removal; focused
     route/flow suites passed after extraction.

5. P0 check — share claim no longer restores receiver library access.
   - Result: NOT FOUND. `server.js` keeps the injected
     `upsertTrackLibraryEntry` helper and delegates to the repository with the
     same arguments.
   - Coverage: `test/share-flow.test.js` passed, including song claim flows.

6. P1 check — created ownership can be downgraded to received on re-upsert.
   - Result: NOT FOUND. Repository keeps
     `origin = CASE WHEN origin = 'created' THEN origin ELSE ? END`.
   - Coverage: repository test restores a removed created row through a
     received upsert and asserts origin remains `created`.

7. P1 check — removed rows keep their old `added_at` when restored.
   - Result: NOT FOUND. Repository keeps
     `added_at = CASE WHEN removed_at IS NOT NULL THEN ? ELSE added_at END`.
   - Coverage: repository test asserts restored row gets the supplied
     `addedAt`.

8. P1 check — second delete overwrites original `removed_at`.
   - Result: NOT FOUND. Repository keeps `WHERE removed_at IS NULL`.
   - Coverage: repository test removes twice and asserts the first timestamp
     remains.

9. P1 check — list ordering changes.
   - Result: NOT FOUND. Repository keeps `ORDER BY tle.added_at DESC`.
   - Coverage: repository test asserts order.

10. P1 check — `can_edit`, `can_share`, `can_delete`, and library metadata
    shape changes.
    - Result: NOT FOUND. Repository keeps the selected aliases and CASE
      expressions.
    - Coverage: repository test asserts owned and received row flags.

11. P1 check — track detail loses active-share metadata.
    - Result: NOT FOUND. Repository keeps the left join to active
      `share_tokens` and selected `share_claim_pin`, `share_expires_at`, and
      `share_status` fields.
    - Coverage: repository test asserts active-share metadata on detail read.

12. P2 check — track route still owns other large SQL clusters.
    - Result: VERIFIED. Render transactions, create/update persistence, job
      state, entitlement spend, and version behavior remain route-owned or
      separately repository-backed.
    - Disposition: Deferred. These are larger track/render slices and need
      their own characterization gates.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: track render/job/entitlement SQL remains outside this
track-library slice. It should move only under a separate render/job root with
coverage for active job handling, entitlement spend, stale terminal jobs, and
gift-funded render behavior.

## Validation

- `node --check src/database/track-library-repository.js`
- `node --check src/routes/tracks.js`
- `node --check src/server.js`
- `node --check test/track-library-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/track-library-repository.test.js test/share-flow.test.js test/mvp-flow.test.js test/story-to-track-contract.test.js`

Focused result: 58 tests passed, 0 failed across the track-library repository,
share flow, MVP flow, and story-to-track contract suites.
