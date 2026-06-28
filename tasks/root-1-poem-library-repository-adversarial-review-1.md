# Root 1 — Poem Library Repository Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/poem-library-repository.js`
- `src/routes/poems.js`
- `src/server.js`
- `test/poem-library-repository.test.js`
- `test/poems.test.js`

Root boundary:
- In scope: `/poems` library listing, `DELETE /poems/:id` library removal, active poem-library existence checks used by poem claim idempotency, and server-injected `getPoemForLibrary`/`upsertPoemLibraryEntry` helper persistence.
- Out of scope: poem create/update/generate persistence, poem share-token validation, gift-order snapshot reads, audio generation, subscription/credit behavior, track-library helper extraction, and unrelated story route behavior.

Reviewer mode: local adversarial pass. No new subagents were launched because inherited agent sessions remained nonresponsive and prior close attempts hung.

## Attack Vectors

1. P0 check — `/poems` starts returning poems outside the caller's active library.
   - Result: NOT FOUND. Repository keeps the join on `ple.user_id = ?` and `ple.removed_at IS NULL`.
   - Coverage: `test/poems.test.js` still verifies another user's poems are not listed.

2. P0 check — deleted canonical poems appear in the library list.
   - Result: NOT FOUND. Repository keeps `p.deleted_at IS NULL`.
   - Coverage: repository test seeds a deleted poem and asserts it is absent.

3. P0 check — gift-token creator-side rows appear in `/poems`.
   - Result: NOT FOUND. Repository keeps `NOT (COALESCE(p.funding_source, 'standard') = 'gift_token' AND ple.origin = 'created')`.
   - Coverage: repository test seeds this case and asserts it is absent.

4. P0 check — deleting a poem globally deletes canonical content instead of removing the caller's library membership.
   - Result: NOT FOUND. Route still calls a membership update; repository updates only `poem_library_entries.removed_at`.
   - Coverage: `test/poems.test.js` still asserts direct access returns 404 through library filtering after delete.

5. P0 check — poem claim idempotency fails open and allows duplicate active library entries.
   - Result: NOT FOUND. Existing active-entry check is preserved behind `getActivePoemLibraryEntry()`.

6. P1 check — removed library entries are treated as active during claim.
   - Result: NOT FOUND. Repository filters `removed_at IS NULL`.
   - Coverage: repository test asserts removed entries return `undefined`.

7. P1 check — list ordering changes.
   - Result: NOT FOUND. Repository keeps `ORDER BY ple.added_at DESC`.
   - Coverage: repository test asserts order.

8. P1 check — `can_edit`, `can_share`, `can_delete`, and library metadata shape changes.
   - Result: NOT FOUND. Repository keeps the same selected aliases and CASE expressions.
   - Coverage: repository test asserts these fields for owned and received rows.

9. P1 check — second delete overwrites original `removed_at`.
   - Result: NOT FOUND. Repository keeps `WHERE removed_at IS NULL`; second call does not mutate.
   - Coverage: repository test removes twice and asserts the first timestamp remains.

10. P1 check — moving server-injected `getPoemForLibrary`/`upsertPoemLibraryEntry` changes route contracts.
    - Result: NOT FOUND. `server.js` keeps the same helper names and `routes/poems.js` injection contract; only helper bodies delegate to the repository.
    - Coverage: `test/poems.test.js` exercises list/detail/update/delete/generate/audio routes through `buildServer()`.

11. P1 check — poem share claim upsert loses created-origin protection.
    - Result: NOT FOUND. Repository keeps `origin = CASE WHEN origin = 'created' THEN origin ELSE ? END`.
    - Coverage: repository test asserts re-upsert after removal restores membership without downgrading `created` ownership.

12. P2 check — track-library helper SQL remains in `server.js`.
    - Result: DEFERRED. Track-library helpers are a related but separate route surface and should move in the matching track-library batch.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: `server.js` still owns track-library helper SQL. It should move later with the matching track-library route coverage, not inside this poem-only slice.

## Validation

- `node --check src/database/poem-library-repository.js`
- `node --check src/routes/poems.js`
- `node --check src/server.js`
- `node --check test/poem-library-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/poem-library-repository.test.js test/poems.test.js`

Focused result: 24 tests passed, 0 failed across the poem-library repository and poems route suites.
