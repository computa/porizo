# Fix auth refresh loops and enforce login redirect

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows the global ExecPlan standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Users who are not logged in or whose refresh token is missing/invalid should be redirected to the login flow instead of getting stuck on “Couldn’t Load Songs” with endless refresh attempts. After this change, a TestFlight user who opens the app without a valid refresh token will be taken to the auth screen, can log in, and then see their songs.

## Progress

- [x] (2026-01-24 18:05Z) Capture current auth and refresh behavior in the iOS client and server.
- [x] (2026-01-24 18:25Z) Update auth state loading to require refresh token; treat INVALID_REFRESH_TOKEN as definitive.
- [x] (2026-01-24 18:25Z) Ensure RootView redirects to auth when auth becomes false (no changes needed).
- [x] (2026-01-24 18:41Z) Build/run in simulator to verify login redirect and song list load after login.
- [ ] (2026-01-24 18:43Z) Record validation results and note any remaining gaps (partial: login redirect verified; post-login song list not verified without credentials).

## Surprises & Discoveries

- Observation: The client marks `isAuthenticated = true` if it finds access token + user id, even if refresh token is missing.
  Evidence: `PorizoApp/PorizoApp/AuthManager.swift` loadAuthState.

- Observation: The server returns `INVALID_REFRESH_TOKEN` for missing/unknown refresh tokens, but the client treats that as non-definitive.
  Evidence: `src/routes/auth.js` + `AuthManager.refreshTokens()`.

- Observation: XcodeBuildMCP transport closed when attempting to list simulators, so build/run validation is blocked until it is restarted.
  Evidence: `xcodebuildmcp/list_sims` returned “Transport closed”.

## Decision Log

- Decision: Keep changes minimal: require refresh token for authenticated state and treat INVALID_REFRESH_TOKEN as definitive. Do not add environment-scoped keychain prefixes in this pass.
  Rationale: Fixes production user flow without forcing extra migration logic or broader changes.
  Date/Author: 2026-01-24 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

Authentication is managed in `PorizoApp/PorizoApp/AuthManager.swift`. The app state is controlled in `PorizoApp/PorizoApp/RootView.swift`, which routes to onboarding, auth, or main tabs. Tokens are stored in the iOS Keychain using `KeychainHelper` in `PorizoApp/PorizoApp/APIClient.swift`. The backend refresh endpoint expects `refresh_token` in the request body and returns `INVALID_REFRESH_TOKEN` if missing or invalid (`src/routes/auth.js`).

## Plan of Work

First, update `AuthManager.loadAuthState()` to require a refresh token before setting `isAuthenticated`. If refresh token is missing, clear auth state. Second, update `AuthManager.refreshTokens()` to treat the server error `INVALID_REFRESH_TOKEN` as definitive and call `logout()` before throwing. Third, confirm `RootView` routes to `.auth` when `isAuthenticated` becomes false; adjust if needed. Finally, run the app in a simulator via XcodeBuildMCP to validate that users without a refresh token are sent to login, and that login allows song list to load.

## Concrete Steps

Run these from `/Users/ao/Documents/projects/porizo`.

1) Edit `PorizoApp/PorizoApp/AuthManager.swift` to require refresh token in `loadAuthState()` and to treat `INVALID_REFRESH_TOKEN` as definitive in `refreshTokens()`.
2) Confirm `RootView.swift` redirects to `.auth` when `isAuthenticated` becomes false.
3) Build and run the iOS app using XcodeBuildMCP and verify behavior.

## Validation and Acceptance

- When the app launches with no refresh token, it should route to the login screen.
- After successful login, the Songs tab loads without “Couldn’t Load Songs.”
- `POST /auth/refresh` should stop repeating once refresh token is invalid (logout happens).

## Idempotence and Recovery

Edits are safe to reapply. If behavior regresses, revert the auth state checks and refresh handling in `AuthManager.swift`.

## Artifacts and Notes

Validation evidence (simulator):
  - After rebuild, app opens directly to the Sign In screen (no Songs tab shown), confirming login redirect for logged-out users.
  - Post-login song list not verified (no test credentials provided).

## Interfaces and Dependencies

- `AuthManager.loadAuthState()` must only set `isAuthenticated = true` when access token, refresh token, and user id are present.
- `AuthManager.refreshTokens()` must call `logout()` on `INVALID_REFRESH_TOKEN`.
- `RootView` must route to `.auth` whenever `isAuthenticated` becomes false and `skipAuth` is false.
