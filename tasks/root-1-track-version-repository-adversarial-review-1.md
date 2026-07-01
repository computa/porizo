# Root 1 Track-Version Allocation Repository — Adversarial Review 1

Date: 2026-06-27
Scope under review:
- `src/database/track-version-repository.js`
- `src/routes/tracks.js`
- `src/server.js`
- `test/track-version-repository.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

## Root Scope

Move `POST /tracks/:id/versions` persistence for track lookup, duplicate
params-hash lookup, and atomic version allocation into
`database/track-version-repository.js`.

The route keeps:
- HTTP auth and ownership checks.
- Request parsing and render-type defaulting.
- Params-hash calculation.
- Cost-estimate construction.
- Public response shape.

Out of scope:
- Preview/full render transaction extraction.
- Entitlement spend semantics.
- Job creation/retry/cancel persistence.
- Gift-funded render behavior.

## Attack Vectors Reviewed

1. Unauthorized users must still receive the existing 404 for missing/foreign
   tracks.
2. Deleted tracks must still be hidden.
3. Duplicate params hash + render type must still return 409 with the existing
   version id and version number.
4. Different params hashes must still allocate separate version numbers.
5. Concurrent version creates must remain gap-free and unique.
6. `tracks.latest_version` update and `track_versions` insert must commit or
   roll back together.
7. PostgreSQL transaction scope must use the transaction callback query, not
   parent `db.prepare`.
8. Insert failure after increment must not leave `tracks.latest_version`
   advanced.
9. `storage_ref` must still include the allocated version number.
10. `lyrics_status`, `lyrics_updated_at`, and `stream_base_url` must still be
    populated as before.
11. Cost estimate JSON must stay route-owned and unchanged.
12. Response JSON must keep `track_version_id`, `version_num`, `params_hash`,
    `cost_estimate`, and `status`.
13. The old `server.js` `incrementTrackVersion()` helper must not remain as a
    dead or misleading alternate path.
14. Render preview/full transactions must not be casually mixed into this
    slice because they include entitlement spend and job state.
15. Repository implementation must avoid dialect-specific `RETURNING` clauses
    to preserve SQLite/Postgres adapter compatibility.

## Findings

No P0/P1 findings.

### P2 — Render job transaction remains route-owned

Severity: P2
Status: VERIFIED
Scenario: `render_preview`, `render_full`, and cancel still contain route-level
transaction logic over `track_versions`, `tracks`, `jobs`, and song entitlement
spend.
Smallest fix sketch: Extract render-job transaction repository/use-case only
after writing characterization tests for entitlement spend, active-job
fallback, stale terminal jobs, and gift-funded render behavior.
Disposition: Deferred. This belongs to a separate track/render root slice.

### P3 — Repository is narrowly named around track versions

Severity: P3
Status: VERIFIED
Scenario: Future track aggregates may need a broader `TrackRepository`, but
this slice only owns version allocation.
Smallest fix sketch: Either compose this under a future `track-repository.js`
or keep the narrower repository if render/job persistence remains separate.
Disposition: Accepted. Narrow naming prevents accidental scope creep.

## Verification

Passed:
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/track-version-repository.test.js test/render-endpoints.test.js test/critical-fixes.test.js`
- `node --check src/database/track-version-repository.js`
- `node --check src/routes/tracks.js`
- `node --check src/server.js`
- `npm run lint`
- `git diff --check`

Root termination for this slice: zero P0/P1.
