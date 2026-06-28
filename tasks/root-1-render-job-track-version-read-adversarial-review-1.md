# Root 1 Render Job Track-Version Read Repository Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/job-durability-repository.js`
- `src/database/track-version-repository.js`
- `src/server.js`
- `test/job-durability-repository.test.js`
- `test/track-version-repository.test.js`
- `test/mvp-flow.test.js`
- `docs/architecture/architecture-map-2026-06.md`
- `docs/architecture/architecture-debt-register-2026-06.md`

Change summary:
- Moved render helper reads for job by-id, active job, latest failed job, batch
  latest failed jobs, track-version by-id, track-version by track/version
  number, per-track version listing, and latest cover version listing into
  repositories.
- Kept render classification, URL construction, retry reset writes, media
  serving, and response shaping in `server.js`.
- Fixed `test/mvp-flow.test.js` to send the real `x-device-token` to
  `/share/:id/key` after claim instead of relying on fallback device headers.

Attack vectors checked:
1. `findById(null)` should not throw or query a bogus job id.
2. Active job lookup should prefer the newest queued/running job.
3. Latest failed job lookup should include `failed`, `dead_letter`, and
   `blocked`.
4. Latest failed job lookup should ignore unrelated workflow types.
5. Batch latest failure lookup should dedupe duplicate track-version ids.
6. Batch latest failure lookup should return the newest failure per version.
7. Batch latest failure projection should include the job id for diagnostics.
8. Track-version by-id lookup should preserve the full row shape expected by
   media/retry code.
9. Track-version by-number lookup should preserve existing route semantics.
10. Per-track version listing should remain ordered by `version_num`.
11. Latest cover lookup should pick the max version per track.
12. Latest cover lookup should dedupe duplicate track ids.
13. `server.js` should keep helper signatures stable for routes.
14. Render retry route behavior should remain stable.
15. Render endpoint behavior should remain stable.
16. Share flow should remain stable.
17. MVP share-key access should use the production device-token contract.
18. Docs should not claim retry reset writes or media-serving persistence moved.

Findings:
- P0: None.
- P1: None.
- P2 VERIFIED: One transaction-scoped gift share helper in `server.js` still
  reads `tracks` and `track_versions` through an injected `query` callback.
  This is intentionally left for a later query-aware gift/share repository
  slice. Smallest fix: extend the relevant repository methods with transaction
  runner support and move that helper without changing gift share semantics.
- P3 VERIFIED: The MVP flow still logs a Whisper quota warning in this
  environment while the preview job completes. This is noisy but not a behavior
  failure. Smallest fix: make the MVP test use a fully local alignment stub or
  quiet expected provider warnings in a later test-hygiene pass.

Validation evidence:
- `node --check src/server.js`
- `node --check src/database/job-durability-repository.js`
- `node --check src/database/track-version-repository.js`
- `NODE_ENV=test node --test test/job-durability-repository.test.js`
  - 8 pass / 0 fail
- `NODE_ENV=test node --test test/track-version-repository.test.js`
  - 3 pass / 0 fail
- `NODE_ENV=test node --test test/render-endpoints.test.js`
  - 17 pass / 0 fail
- `NODE_ENV=test node --test test/dlq-retry-endpoint.test.js`
  - 12 pass / 0 fail
- `NODE_ENV=test node --test test/security-units-6-7-8.test.js`
  - 15 pass / 0 fail
- `NODE_ENV=test node --test test/share-flow.test.js`
  - 48 pass / 0 fail
- `NODE_ENV=test node --test test/mvp-flow.test.js`
  - 2 pass / 0 fail
- `npm run lint`
- `git diff --check -- src/database/job-durability-repository.js src/database/track-version-repository.js src/server.js test/job-durability-repository.test.js test/track-version-repository.test.js test/mvp-flow.test.js`

Disposition:
- This slice has zero P0/P1.
- Continue Root 1 with the remaining transaction-scoped gift/share read before
  moving to higher-risk service extraction.
