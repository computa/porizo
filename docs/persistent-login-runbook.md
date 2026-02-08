# Persistent Login Runbook

## Purpose
Use this document if users report "random logout" or "constant logout" after they already signed in.

Goal behavior: user signs in once and stays signed in until explicit logout, app uninstall, or definitive server-side session invalidation.

## Last Confirmed Incident
- Date: 2026-02-08
- Scope: iOS auth/session handling (`APIClient`, `AuthManager`, `RootView`, `KeychainHelper`)

## Incident Signature
Backend log pattern:
1. Authenticated request returns `401` (example: `GET /tracks`)
2. Refresh succeeds (`POST /auth/refresh` returns `200`)
3. Immediate retried request returns another `401`
4. Client calls `POST /auth/logout` and clears local session

This looks like "constant logout" to the user.

## Root Causes Confirmed
1. Post-refresh retry `401` classification drifted too far toward "transient", which could suppress auth-failure handling and leave users effectively logged out without a clear re-login prompt.
2. Refresh could run while protected data/keychain was unavailable, rotating server tokens even when the client could not safely persist replacements.
3. `TOKEN_ALREADY_ROTATED` without any valid local access token is unrecoverable client-side and must be treated as definitive re-auth.
4. Cold-boot protected-data unavailability can delay auth state load and appear as an auth loss if not deferred correctly.

## What Was Changed
1. `PorizoApp/PorizoApp/APIClient.swift`
- Restored definitive handling for `401` after retry (`notifyAuthFailure` + `notAuthenticated`) so users are explicitly sent to auth when session recovery fails.
- Added `AuthError.keychainSaveFailed` to definitive-failure classification.
- Result: failed session recovery no longer gets silently suppressed.

2. `PorizoApp/PorizoApp/AuthManager.swift`
- Added early guard to skip refresh when `UIApplication.shared.isProtectedDataAvailable == false`.
- On refresh success, failure to persist rotated tokens now escalates to definitive not-authenticated behavior.
- `TOKEN_ALREADY_ROTATED` now requires re-auth if no valid local access token exists.
- Foreground refresh now logs out only on definitive failures; transient failures remain non-fatal.

3. `PorizoApp/PorizoApp/Services/Keychain/KeychainHelper.swift`
- Replaced delete-then-add with update-first, add-if-missing.
- Prevents credential loss during intermittent Keychain write failures.

4. `PorizoApp/PorizoApp/RootView.swift`
- For users who already completed onboarding, unauthenticated state now routes directly to `.auth` (not `.landing`).
- Result: re-login prompt is explicit and immediate when a session is lost.

## Validation Performed
These were run after the fix:
- `npm run lint` (pass)
- `npm test` (pass; PostgreSQL-dependent tests skipped when DB unavailable)
- `npm run admin:build` (pass with non-blocking warnings)
- `node test/inline-race-test.js` (pass; expected single winner + `TOKEN_ALREADY_ROTATED`)
- `xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -sdk iphonesimulator -configuration Debug -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO` (build succeeded)

## Lessons Learned
1. Never suppress definitive auth failure handling.
- Users must see an immediate re-login path when refresh+retry cannot recover.

2. Keychain write strategy matters.
- Delete-first is unsafe for auth credentials.
- Use update-first and rollback on multi-key writes.

3. Do not rotate refresh tokens when keychain persistence is unavailable.
- A successful server rotation without local persistence can orphan the session.

4. `TOKEN_ALREADY_ROTATED` requires context.
- If a valid local access token exists, continue.
- If no valid token exists, force re-auth (cannot recover client-side).

5. Login persistence is a product requirement, not only a technical preference.
- Error handling should preserve sessions on transient failures and fail loudly on definitive failures.

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
- Ensure post-refresh retry `401` triggers auth failure handler (user sees auth prompt).

5. Verify Keychain integrity.
- Confirm access token, refresh token, user id, and expiry are all present together.
- If one is missing, investigate partial write regressions.

## Rollback / Safety Note
This fix is intentionally conservative: it reduces false logouts but still allows logout on definitive failures (`token expired/revoked/family compromised` paths).
