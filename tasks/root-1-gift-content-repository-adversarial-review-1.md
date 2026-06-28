# Root 1 — Gift Content Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/gift-content-repository.js`
- `src/routes/gifts.js`
- `test/gift-content-repository.test.js`

Root boundary:
- In scope: read-only `tracks`, `track_versions`, and `poems` lookups used by `validateGiftContent()`.
- Out of scope: gift wallet transactions, reservations, share-token creation, dispatch/outbox writes, cancel/retry flows, and moving `validateGiftContent()` business rules out of the route.

Reviewer mode: worker-implemented slice with main-thread review and validation. The worker agent was closed after completion.

## Attack Vectors

1. P0 check — gift creation accepts another user's content.
   - Result: NOT FOUND. Ownership checks remain in `validateGiftContent()`.

2. P0 check — deleted tracks or poems become giftable.
   - Result: NOT FOUND. Deleted checks remain route-local and the repository preserves the `deleted_at` fields.

3. P0 check — song readiness semantics change.
   - Result: NOT FOUND. The route still requires either `preview_url` or `full_url`; repository returns the same media fields.

4. P0 check — poem readiness semantics change.
   - Result: NOT FOUND. `parsePoemVerses()` remains in `gifts.js`, and empty/non-array verses still produce `POEM_NOT_READY`.

5. P1 check — default version resolution changes.
   - Result: NOT FOUND. `Number(versionNum || track.latest_version || 1)` remains in `validateGiftContent()`.

6. P1 check — missing-row behavior changes from adapter `.get()` semantics.
   - Result: NOT FOUND. Repository methods return `undefined` for missing rows.
   - Coverage: repository test asserts missing track/version/poem rows.

7. P1 check — route snapshot fields change.
   - Result: NOT FOUND. Snapshot shaping remains route-local; repository tests pin the source field names.

8. P1 check — slice expands into wallet/share/dispatch persistence.
   - Result: NOT FOUND. Those paths were not edited.

9. P2 check — route still contains business logic.
   - Result: ACCEPTED. This is intentional for the first gift-content slice; moving the rule itself should wait until gift transaction/share-token boundaries are better isolated.

## Findings

No P0 findings.

No P1 findings.

Deferred P2:
- `validateGiftContent()` still lives in `routes/gifts.js`; extract the use case only after the larger gift transaction boundaries are repository-backed and covered.

## Validation

- `node --check src/routes/gifts.js`
- `node --check src/database/gift-content-repository.js`
- `node --check test/gift-content-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/gift-content-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/gifts.test.js`

Focused result: 44 tests passed, 1 skipped, 0 failed.
