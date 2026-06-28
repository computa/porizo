# Root 1 — Artwork Access Repository Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/artwork-access-repository.js`
- `src/routes/artwork.js`
- `test/artwork-access-repository.test.js`
- `test/routes/artwork-access-route.test.js`
- `test/routes/artwork-hmac.test.js`

Root boundary:
- In scope: `/tracks/:trackId/artwork.jpg` share-token lookup and track-owner lookup persistence.
- Out of scope: HMAC signing algorithm, signed URL TTL policy, share-token revocation semantics, owner auth policy, storage key generation, S3 hydration, artwork generation jobs, and cache-control policy.

Reviewer mode: local adversarial pass after implementation. No new subagents launched because one prior explorer agent remained nonresponsive to bounded wait/close cleanup.

## Attack Vectors

1. P0 check — revoked or expired share tokens become authorized.
   - Result: NOT FOUND. The route still owns `status !== "revoked"` and `expires_at` checks in both HMAC+share-token and share-token-only paths. The repository only returns the same three columns the route previously selected.

2. P0 check — bare HMAC capability URLs stop working for existing unfurls.
   - Result: NOT FOUND. The bare-HMAC branch still sets `authorized = true` when the signature verifies and no `share_token` is present.
   - Coverage: existing `test/routes/artwork-hmac.test.js` still passes; route test uses a valid bare HMAC and reaches the post-auth owner lookup.

3. P0 check — owner bearer auth starts authorizing non-owners.
   - Result: NOT FOUND. The route still compares `owner.user_id === userId`; only the owner row lookup moved.
   - Coverage: route test proves owner auth calls the injected repository boundary and returns the stored owner artwork file.

4. P0 check — storage-key resolution leaks or trusts user input.
   - Result: NOT FOUND. The route still resolves `userId` from the track-owner row after authorization and still constructs the storage key via `trackArtworkKey({ userId, trackId })`. The path traversal guard remains unchanged.

5. P0 check — missing tracks become unauthorized instead of 404 after a valid HMAC.
   - Result: NOT FOUND. The post-auth storage-owner lookup still returns `TRACK_NOT_FOUND` when no owner row exists.
   - Coverage: route test pins valid-HMAC/missing-owner behavior as a 404 `{ error: "TRACK_NOT_FOUND" }`.

6. P1 check — repository row shape changes route assumptions.
   - Result: NOT FOUND. Repository tests assert exact row shapes: `{ track_id, status, expires_at }` for shares and `{ user_id }` for owners.

7. P1 check — route now couples to artwork job persistence.
   - Result: NOT FOUND. A dedicated `artwork-access-repository.js` was introduced instead of reusing `artwork-job-repository.js`, keeping request authorization/storage reads separate from background job persistence.

8. P1 check — share-token lookup failures become fatal.
   - Result: NOT FOUND. Existing try/catch blocks remain around both share-token paths. Lookup errors still log warnings and fall through to later auth/401 behavior.

9. P1 check — S3 hydration or cache behavior changed.
   - Result: NOT FOUND. No hydration or cache-header logic moved.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: `routes/artwork.js` still owns nontrivial auth branching and file-serving behavior. This slice only removed persistence from the route; a later route-service split could isolate the authorization decision from HTTP/file delivery after more route-level coverage exists.

## Validation

- `node --check src/database/artwork-access-repository.js`
- `node --check src/routes/artwork.js`
- `node --check test/artwork-access-repository.test.js`
- `node --check test/routes/artwork-access-route.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/artwork-access-repository.test.js test/routes/artwork-access-route.test.js test/routes/artwork-hmac.test.js`

Focused result: 20 pass / 0 fail.
