# Root 1 Track-Version Transaction Read Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/track-version-repository.js`
- `src/server.js`
- `test/track-version-repository.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`

Change summary:
- Added transaction-query adapter support to track and track-version read
  methods in `track-version-repository.js`.
- Moved the transaction-scoped `tracks` and `track_versions` reads in
  `ensureTrackGiftShareToken` out of `server.js`.

Attack vectors checked:
1. Repository reads should work with the normal DB adapter.
2. Repository reads should work inside `db.transaction(async (query) => ...)`.
3. Gift share creation should preserve transaction boundaries.
4. Gift share creation should still reject missing/deleted/foreign tracks.
5. Gift share creation should still reject missing versions.
6. Gift share creation should still reject not-ready versions.
7. The server should no longer contain direct job/track-version SQL reads.
8. Gift route behavior should remain stable.
9. Share route behavior should remain stable.
10. The docs should not claim share-token writes moved in this slice.

Findings:
- P0: None.
- P1: None.
- P2: None.
- P3 VERIFIED: `ensureTrackGiftShareToken` remains in `server.js` as
  orchestration even though its reads are repository-backed. Smallest fix:
  move gift share creation orchestration into a service during the later gift
  subsystem/service-boundary root.

Validation evidence:
- `node --check src/server.js`
- `node --check src/database/track-version-repository.js`
- `NODE_ENV=test node --test test/track-version-repository.test.js`
  - 4 pass / 0 fail
- `NODE_ENV=test node --test test/gifts.test.js`
  - 40 pass / 1 skipped / 0 fail
- `NODE_ENV=test node --test test/share-flow.test.js`
  - 48 pass / 0 fail
- `npm run lint`
- `git diff --check -- src/database/track-version-repository.js src/server.js test/track-version-repository.test.js`
- `rg -n "SELECT \\* FROM jobs WHERE id|SELECT \\* FROM track_versions WHERE id|FROM jobs|FROM track_versions|db\\.query\\(" src/server.js`
  - no matches

Disposition:
- This closure slice has zero P0/P1.
- The remaining gift work is orchestration/service extraction, not raw
  job/track-version read persistence.
