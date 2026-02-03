# Login Persistence Issue — Hypothesis-Driven Plan

## Goal
Identify the root cause of forced re-login on app relaunch by changing **one** suspected cause at a time, testing, and either confirming or ruling it out.

## Baseline Repro (run before each experiment)
- Clean start: force-quit the app from app switcher.
- Launch → verify whether user is logged in.
- Background the app for 2 minutes → foreground → verify.
- Kill the app again → relaunch → verify.
- Record: auth provider used (Apple/Google/Facebook/Phone), build (Debug/Release), base URL.

---

## Hypothesis 1 — Strict `/auth/me` validation on launch logs out on *any* error
**Why likely:** `AuthManager.completeAuthStateLoad()` calls `fetchCurrentUser()` at launch and logs out on any error (network error, 5xx, timeout). This makes sessions fragile to transient conditions.

**Targeted change (experiment):**
- Treat **network/5xx** errors as non-fatal on launch.
- On launch, if tokens exist, set `isAuthenticated = true` immediately, and defer `/auth/me` validation until first authenticated API call or when the network is confirmed reachable.

**Test plan:**
- Simulate offline at launch (disable network or point to unreachable base URL).
- Relaunch the app twice.
- Then bring network back and make an authenticated call.

**Acceptance criteria:**
- App does **not** force logout when offline at launch.
- Once network returns, `/auth/me` succeeds and user remains logged in.
- No infinite auth error loops.

---

## Hypothesis 2 — Base URL mismatch between login sessions
**Why likely:** Debug builds on simulator default to `http://localhost:3000`. If tokens were issued by a different environment (prod/staging), `/auth/me` returns 401, triggering logout.

**Targeted change (experiment):**
- Persist the `apiBaseURL` used at login alongside tokens and validate on launch.
- If mismatch: either keep user logged in but mark session invalid, or show an explicit “environment mismatch” warning without clearing tokens.

**Test plan:**
- Login against prod, relaunch with localhost base URL.
- Then login against localhost, relaunch with prod base URL.

**Acceptance criteria:**
- App surfaces a clear “environment mismatch” state without erasing valid tokens.
- Re-login only occurs when the user explicitly logs out or chooses to switch environments.

---

## Hypothesis 3 — Refresh token invalidation/rotation from backend resets
**Why likely:** Refresh tokens rotate and are revoked on reuse. If the app refreshes, is killed, and the old token is reused on next launch, backend can respond with a definitive 401 and force logout.

**Targeted change (experiment):**
- Add explicit refresh token “grace period” handling on backend (or adjust client to detect rotation edge cases and retry with updated token if available).
- Ensure token refresh is atomic and stored before any app state change.

**Test plan:**
- Login, wait until access token is near expiry, trigger refresh, then force-quit mid-refresh.
- Relaunch and attempt authenticated call.

**Acceptance criteria:**
- User remains logged in even if the app is killed during refresh.
- Backend logs show token rotation without invalidating active session.

---

## Hypothesis 4 — Apple credential revocation check invalidates session on launch
**Why likely:** `AuthManager.loadAuthState()` validates Apple credential state on every launch. If Apple ID state is `.revoked`/`.notFound` (common on simulator), the app logs out immediately.

**Targeted change (experiment):**
- In debug builds, relax Apple credential checks when running on simulator.
- In release builds, gate logout on *confirmed* revocation only, and log any transient errors without logout.

**Test plan:**
- Use Apple sign-in, relaunch app multiple times on simulator and on device.
- Compare behavior between providers (Apple vs Phone/Google).

**Acceptance criteria:**
- Apple login sessions persist across relaunch on real device.
- Simulator does not trigger forced logout due to Apple credential state.

---

## Hypothesis 5 — Keychain persistence issues (tokens missing on launch)
**Why likely:** If Keychain items aren’t persisted (bundle ID changes, keychain access group changes, simulator resets), tokens appear missing and `logout()` triggers.

**Targeted change (experiment):**
- Add launch diagnostics: log whether Keychain entries exist before any network call.
- Verify Keychain service name and access group stability across builds.

**Test plan:**
- Login, relaunch app 3 times without reinstalling.
- Update build number only, relaunch.
- Compare simulator vs physical device behavior.

**Acceptance criteria:**
- Keychain tokens present on relaunch for same bundle ID.
- Tokens persist across build updates (no uninstall).

---

## Hypothesis 6 — 401s from non-auth endpoints trigger logout via refresh flow
**Why likely:** Some endpoints might return 401 if backend expects bearer token but client falls back to `x-user-id` or uses stale token. 401 triggers refresh and then logout on retry failure.

**Targeted change (experiment):**
- Confirm which endpoints are called at launch and their auth requirements.
- For non-auth endpoints, ensure they accept device token or gracefully handle unauthenticated access during boot.

**Test plan:**
- Capture launch network trace (Charles/Proxyman) and identify first 401.
- Verify server logs for the specific endpoint.

**Acceptance criteria:**
- No 401 responses during launch for the authenticated user.
- Auth failure handler not invoked on first app load.

---

## Hypothesis 7 — Device clock skew makes tokens appear expired
**Why likely:** Token expiry logic uses device time. A clock offset can make tokens appear expired, forcing refresh and logout.

**Targeted change (experiment):**
- Add a sanity check: if device time is behind server time by a threshold, warn but don’t logout automatically.

**Test plan:**
- Set simulator/device clock ±2 hours.
- Relaunch and observe refresh behavior.

**Acceptance criteria:**
- Session persists despite moderate clock skew.
- App warns only when skew is severe, without forcing logout.

---

## Experiment Order (recommended)
1) Hypothesis 1 — simplest and most likely (launch-time `/auth/me` failure).
2) Hypothesis 2 — environment mismatch.
3) Hypothesis 3 — refresh token rotation edge cases.
4) Hypothesis 5 — Keychain persistence.
5) Hypothesis 6 — endpoint-specific 401s.
6) Hypothesis 4 — Apple credential check (if Apple sign-in used).
7) Hypothesis 7 — device clock skew.

---

## Progress (2026-01-31)

**Status summary:**
- **H1 (launch `/auth/me` failure)**: Mitigated by optimistic auth + background validation. **Not sufficient**; mid-session logouts still occur.
- **H2 (base URL mismatch)**: **Not pursued**; logs show consistent `api.porizo.co`.
- **H3 (refresh rotation race)**: **Partially addressed** with refresh dedupe + stale-token retry; **still failing** with 401s after successful refresh.
- **H3 (refresh rotation race) — Option 1 (in progress)**: Coordinate refresh+retry at APIClient level so all concurrent 401s share the same refresh **and** the same retry token (bypass proactive refresh during retry).
- **H4 (Apple credential)**: **Not the cause** of mid-session 401s.
- **H5 (Keychain persistence)**: **Unlikely** (issue occurs mid-session, not only on launch).
- **H6 (endpoint-specific 401s)**: **Active**. Added server logging for JWT verify errors to classify 401s.
- **H7 (clock skew)**: **Unconfirmed**; depends on verify error classification.

**Evidence:**
- 401s on authenticated endpoints (e.g., `/story/*/continue`, `/billing/entitlements`, `/voice/profile`) **after** `/auth/refresh` succeeds.
- Client retries with refreshed token but still receives 401s → triggers logout.

**Conclusion:** This now points beyond client races to **server-side token verification inconsistency** (JWT secret mismatch across instances or clock skew).

---

## Next Experiment (proposed)

### Hypothesis 6A — JWT verification inconsistency across instances
**Why likely:** 401s immediately after successful refresh are classic symptoms of mismatched `JWT_SECRET` or issuer/clock skew between instances.

**Targeted change (experiment):**
- Log `err.name` + `err.message` from `jwt.verify` in `requireUserId` (no tokens).
- Correlate with instance/host to detect split-brain secrets.
- If `invalid signature`, validate that all running instances share the same `JWT_SECRET` and issuer.
- If `TokenExpiredError`, check time sync (NTP) and clock skew.

**Test plan:**
- Trigger the mid-session flow that currently logs out.
- Capture server log line with verify error classification and instance host.

**Acceptance criteria:**
- Error type is classified (invalid signature vs expired vs malformed).
- If invalid signature: after enforcing consistent secrets/issuer, 401s stop.
- If expired: after correcting clock skew, 401s stop.

## Definition of “Fixed”
- User remains logged in across **3 cold launches**, **2 background/foreground cycles**, and **one offline launch** without being forced to re-authenticate.
- No `logout()` call triggered by transient network errors.
- `/auth/me` succeeds once connectivity is restored.
