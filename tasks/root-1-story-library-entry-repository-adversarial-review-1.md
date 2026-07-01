# Root 1 — Story Library Entry Repository Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/story-repository.js`
- `src/routes/story.js`
- `test/story-repository.test.js`
- `docs/architecture/architecture-map-2026-06.md`
- `docs/architecture/architecture-debt-register-2026-06.md`

Root boundary:
- In scope: route-local `track_library_entries` and `poem_library_entries` upsert/remove helpers used by story-to-track and story-to-poem flows.
- Out of scope: canonical track/poem insert/update SQL, gift-funded reservation validation, wallet accounting, subscription spend, writer/story context behavior, and unrelated `routes/poems.js`/`server.js` library-entry SQL.

Reviewer mode: local adversarial pass. Two inherited agents remained nonresponsive and prior close attempts hung; no new agents were launched in this slice to avoid additional Mac resource pressure.

## Cleanup Performed Before This Slice

Removed diagnostic scratch SQL probes:
- `tasks/_recv_trace.sql`
- `tasks/_recv_trace2.sql`
- `tasks/_viral_diag.sql`
- `tasks/_viral_diag2.sql`

Kept ambiguous generated docs untouched:
- `docs/council/*`
- `docs/generated-documents/governance-index-letterhead.docx`

## Attack Vectors

1. P0 check — created library ownership can be downgraded to received.
   - Result: NOT FOUND. Repository keeps `origin = CASE WHEN origin = 'created' THEN origin ELSE ? END`.
   - Coverage: `test/story-repository.test.js` asserts an existing `created` track entry stays `created` when upserted as `received`.

2. P0 check — gift-funded content is accidentally added to the creator library.
   - Result: NOT FOUND. `routes/story.js` still controls the gift-funded branch and calls remove rather than upsert when a gift reservation is active.

3. P0 check — user-visible story-to-track or story-to-poem response shape changes.
   - Result: NOT FOUND. Response shaping remains in `routes/story.js`; only helper persistence moved.
   - Coverage: `test/story-billing.test.js`, `test/story-delete-poem.test.js`, and `test/story-to-track-contract.test.js`.

4. P0 check — failed subscription spend still leaves free content in the library.
   - Result: NOT FOUND. Subscription spend and generation-failed handling remain in `routes/story.js`; this slice did not move that transaction order.

5. P1 check — removed entries are not restored when upserted again.
   - Result: NOT FOUND. Repository keeps `removed_at = NULL` and resets `added_at` only when the entry had been removed.
   - Coverage: repository test removes and re-upserts a track entry.

6. P1 check — remove operation overwrites an existing removal timestamp.
   - Result: NOT FOUND. Repository keeps `removed_at = COALESCE(removed_at, ?)`.

7. P1 check — route-level SQL-inspecting tests lose coverage because SQL moved.
   - Result: NOT FOUND. The repository still uses the same injected `db.prepare()` boundary, so existing route tests that stub `db.prepare()` still observe the relevant SQL.

8. P1 check — repository expands into gift/wallet/revenue-adjacent semantics.
   - Result: NOT FOUND. Gift reservation checks and subscription spend stay in route/service code.

9. P1 check — this slice accidentally changes `routes/poems.js` or `server.js` duplicate library-entry logic.
   - Result: NOT FOUND. Those files remain out of scope for a later bounded batch.

10. P2 check — `story-repository.js` now mixes session, orchestration, and library-entry persistence.
    - Result: DEFERRED. This is still within the story aggregate and matches the current Root 1 repository pattern. A later Root 6/Root 8 cleanup can split repositories further if story persistence becomes too broad.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: unrelated library-entry persistence still exists in `routes/poems.js` and `server.js`. Move those in separate route-specific batches so story contracts do not expand into unrelated poem/admin/server behavior.

## Validation

- `node --check src/database/story-repository.js`
- `node --check src/routes/story.js`
- `node --check test/story-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/story-repository.test.js test/story-delete-poem.test.js test/story-billing.test.js test/story-to-track-contract.test.js`

Focused result: 22 tests passed, 0 failed across repository, story-to-poem/delete, story billing, and story-to-track contract suites.
