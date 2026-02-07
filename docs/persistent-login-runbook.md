# Persistent Login Runbook

## Purpose
Use this document if users report "random logout" or "constant logout" after they already signed in.

Goal behavior: user signs in once and stays signed in until explicit logout, app uninstall, or definitive server-side session invalidation.

## Last Confirmed Incident
- Date: 2026-02-07
- Fix commit: `a41c894`
- Scope: iOS auth/session handling (`APIClient`, `AuthManager`, `KeychainHelper`)

## Incident Signature
Backend log pattern:
1. Authenticated request returns `401` (example: `GET /tracks`)
2. Refresh succeeds (`POST /auth/refresh` returns `200`)
3. Immediate retried request returns another `401`
4. Client calls `POST /auth/logout` and clears local session

This looks like "constant logout" to the user.

## Root Causes Confirmed
1. Post-refresh retry `401` was treated as definitive auth failure, triggering local logout.
2. Keychain writes used delete-then-add behavior, which can drop tokens if add fails transiently.
3. `TOKEN_ALREADY_ROTATED` refresh edge case could still collapse into forced expiry/logout in race windows.
4. Cold-boot protected-data unavailability could delay auth state load and appear as an auth loss.

## What Was Changed
1. `PorizoApp/PorizoApp/APIClient.swift`
- Changed 401-after-retry handling from definitive `notAuthenticated` to transient `authRefreshFailed`.
- Added one more guarded retry if token changes again after refresh (concurrent refresh race window).
- Result: transient refresh races no longer force logout.

2. `PorizoApp/PorizoApp/AuthManager.swift`
- `TOKEN_ALREADY_ROTATED` now treated as transient if no valid token is immediately visible.
- Added rollback-safe batch token persistence helper to avoid partial Keychain state.
- Removed aggressive logout paths during refresh edge failures.
- Kept deferred auth-load behavior when protected data is unavailable at launch.

3. `PorizoApp/PorizoApp/Services/Keychain/KeychainHelper.swift`
- Replaced delete-then-add with update-first, add-if-missing.
- Prevents credential loss during intermittent Keychain write failures.

## Validation Performed
These were run after the fix:
- `npm run lint` (pass)
- `npm test` (pass; PostgreSQL-dependent tests skipped when DB unavailable)
- `npm run admin:build` (pass with non-blocking warnings)
- `node test/inline-race-test.js` (pass; expected single winner + `TOKEN_ALREADY_ROTATED`)
- `xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO` (build succeeded)

## Lessons Learned
1. Never auto-logout on a single post-refresh `401`.
- In distributed/concurrent systems, one extra retry window is required.

2. Keychain write strategy matters.
- Delete-first is unsafe for auth credentials.
- Use update-first and rollback on multi-key writes.

3. Refresh rotation races are normal in mobile apps.
- Treat `TOKEN_ALREADY_ROTATED` as a recoverable race signal unless there is clear proof of invalid session.

4. Login persistence is a product requirement, not only a technical preference.
- Error handling should default to preserving session unless failure is definitive.

## Recurrence Playbook
If this issue reappears:
1. Confirm whether logout was explicit.
- Search iOS logs for `[Auth] logout() called - provider:`.
- Capture stack trace from the same session.

2. Check server sequence for same user.
- Look for `401 -> refresh 200 -> 401 -> logout`.

3. Verify environment consistency.
- Confirm all API instances use the same JWT secret/fingerprint.
- Mismatched JWT secrets can create false-invalid token loops.

4. Inspect client-side auth classification.
- Ensure post-refresh retry `401` still maps to transient handling (`authRefreshFailed`), not `notAuthenticated`.

5. Verify Keychain integrity.
- Confirm access token, refresh token, user id, and expiry are all present together.
- If one is missing, investigate partial write regressions.

## Rollback / Safety Note
This fix is intentionally conservative: it reduces false logouts but still allows logout on definitive failures (`token expired/revoked/family compromised` paths).
