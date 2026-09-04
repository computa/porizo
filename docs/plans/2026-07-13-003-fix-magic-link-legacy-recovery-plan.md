# fix: Magic-link legacy-account recovery — server auto-merge + iOS recovery-screen stability

**Type:** fix · **Depth:** Standard · **Risk:** High (auth / account-linking)
**Created:** 2026-07-13
**Related:** commit `d3010039` (platform-bound magic login), `tasks/todo.md` active task

---

## Summary

A legitimate owner of an Apple+phone account cannot sign in via magic link when they use the same email that already sits on their account **unverified**. The server throws `LEGACY_ACCOUNT_RECOVERY_REQUIRED` (409); the iOS client reacts by flashing Sign-in-with-Apple and stranding the user on the "Check your email" screen. This plan fixes both halves: the server auto-verifies and adopts the existing account when it is safe to do so, and the iOS recovery screen holds stably (with Apple/phone recovery actions) for the cases that still require explicit recovery.

---

## Problem Frame

**Observed:** Tapping the magic link produces "We could not check the link" then a flash of Sign-in-with-Apple. Login never completes.

**Root cause (verified end-to-end):**

- Prod logs: repeated `POST /auth/magic/exchange` → `Magic login exchange rejected … code="LEGACY_ACCOUNT_RECOVERY_REQUIRED"` for txn `a6005367-3ad2-433b-8045-10e0a4a1ed10`.
- Prod DB: account `user_2bc191587da2551881aab8ba` has `apple` + `phone` auth providers (active) and an email contact `abcobimma@gmail.com` with `verified_at = NULL`.
- Server trace (`src/routes/auth.js` `consumeMagicTransaction`): `findActiveUserByVerifiedContact` misses (email unverified) → `findActiveUserByAnyContact` hits → account has other providers → throws `LEGACY_ACCOUNT_RECOVERY_REQUIRED`.
- iOS trace: `AuthManager.magicFailureState` maps the 409 to `.legacyRecovery` correctly, and `AuthView.legacyRecoveryActions` renders recovery buttons — **but** `loginPresentation` derives from `pendingMagicLoginPresentation`, and concurrent triggers (`onOpenURL` exchange, scene-phase `.active` refresh, the `CheckEmailView.task` poller) can clear/clobber it, unmounting the recovery block → fall-through to the email-entry screen with the standalone Apple button (the "flash").

**Why it matters:** This blocks the exact owner the feature is meant to serve, and the fall-through hides the intended recovery UX. It ships in TestFlight build 150.

---

## Requirements

- **R1** — A magic-link login for an email that exists only as an **unverified contact** on an active account signs the owner into **that same account** (no new account, no 409), because clicking the emailed link proves mailbox control.
- **R2** — A magic-link login for an email that is an **active auth provider (login factor)** on a different account continues to return `LEGACY_ACCOUNT_RECOVERY_REQUIRED` (409) — the genuine takeover-risk case is preserved.
- **R3** — A magic-link login for a brand-new email still creates a new account (unchanged behavior).
- **R4** — When the 409 recovery path is hit, the iOS client shows a **stable** recovery screen with the account's available recovery methods (Apple / phone) and does not flash to the email-entry screen.
- **R5** — No cross-account data leak: the auto-merge path only ever verifies a contact that already belongs to the adopted account.
- **R6** — Ship to TestFlight internal testers for on-device verification.

---

## Key Technical Decisions

- **KTD1 — Auto-merge safety gate keys on auth-provider presence, not contact presence.** The safe-to-merge test is: the email is **not** returned by `findActiveUserByProvider("email", email)` (i.e., it is not a login factor anywhere). An unverified _contact_ collision is safe (someone typed it); an auth-_provider_ collision is not. Rationale: mailbox control (proven by the click) is sufficient to verify a contact the account already holds, but not to absorb an account whose email is itself a credential. This is the account-takeover seam.
- **KTD2 — Reuse `verifyContact`, do not insert a new provider.** The auto-merge path calls the existing `verifyContact(repository, userId, "email", …, "magic_link")` to flip `verified_at`, then issues a session for the adopted account via the existing session/refresh path. It does **not** add an `email` auth provider — the account keeps signing in via Apple/phone; the email becomes a verified contact only.
- **KTD3 — iOS fix is presentation-lifetime, not new UI.** The recovery UI already exists (`AuthView.legacyRecoveryActions`). The fix guarantees `pendingMagicLoginPresentation` survives a `.legacyRecovery` terminal state and is not cleared by racing refresh/exchange paths, so the recovery block stays mounted.
- **KTD4 — Terminal-state guard on concurrent magic triggers.** Once `magicLoginState` is a terminal recovery/error state, the scene-phase refresh and poller must not re-enter exchange or downgrade the state to `.wrongDeviceOrPlatform`/nil.

---

## Implementation Units

### U1. Server: auto-merge-when-safe in `consumeMagicTransaction`

**Goal:** Adopt the existing account (verify contact + issue session) when the email collision is an unverified contact and the email is not an auth provider anywhere; otherwise keep the 409.

**Requirements:** R1, R2, R3, R5

**Dependencies:** none

**Files:**

- `src/routes/auth.js` (`consumeMagicTransaction`, login branch) — _change started_
- `test/magic-login-api.test.js` — API-level coverage
- `test/magic-login-service.test.js` — if service-level seam needs a hook (likely not; logic is in the route consume callback)

**Approach:** In the `if (legacyOwner)` branch, call `findActiveUserByProvider("email", emailNormalized)`. If absent → `verifyContact(txIdentityRepository, legacyOwner.id, "email", emailNormalized, "magic_link")`, set `owner = { id: legacyOwner.id }`, leave `isNewUser = false`, fall through to the existing session-issuance code. If present → throw `LEGACY_ACCOUNT_RECOVERY_REQUIRED` as before. The create-new-user block becomes the `else` of `if (legacyOwner)`.

**Patterns to follow:** existing `linkVerifiedMagicEmail` guard in `src/services/identity-service.js`; existing session issuance already in `consumeMagicTransaction`.

**Test scenarios:**

- Covers R1. Unverified-contact collision (account has apple provider, email contact `verified_at=NULL`) → exchange returns a session for the **same** `user_id`; contact now `verified_at` set; no new user row.
- Covers R2. Email-is-auth-provider collision (email active as `email` provider on a different account) → still `409 LEGACY_ACCOUNT_RECOVERY_REQUIRED` with `masked_email` + `auth_methods` details.
- Covers R3. Brand-new email → new user created, `isNewUser=true` (unchanged).
- Covers R5. Auto-merge only verifies the contact on the adopted account — assert no contact/provider is created on any other account, and the adopted account's provider set is unchanged (no `email` provider added).
- Idempotency: replaying the same transaction (recovery path) returns the same session without re-verifying or duplicating.
- Regression: existing `add_email` purpose path is untouched (still verifies into `accountId`).

**Verification:** `node --test test/magic-login-*.test.js` green; the specific R1 case asserts same-user session issuance.

**Execution note:** Add the R1 and R2 tests first (they encode the security boundary), watch them fail against the pre-change branch, then confirm they pass after.

---

### U2. iOS: keep `.legacyRecovery` presentation stable

**Goal:** Ensure the recovery screen mounts and stays mounted when the server returns the 409, with no flash to email-entry.

**Requirements:** R4

**Dependencies:** U1 not required for compile; independent, but verified together.

**Files:**

- `PorizoApp/PorizoApp/AuthManager.swift` (`handleMagicLoginURL`, `performMagicLoginStatusRefresh`, `clearMagicLoginPresentation`, terminal-state handling)
- `PorizoApp/PorizoApp/AuthView.swift` (`loginPresentation`, `legacyRecoveryActions` mount condition)
- `PorizoApp/PorizoApp/RootView.swift` (`handleIncomingURL` magic branch, scene-phase `.active` refresh)
- `PorizoApp/PorizoAppTests/AuthManagerTests.swift` — state-transition coverage

**Approach:** Guarantee that reaching `.legacyRecovery` does **not** clear `pendingMagicLoginPresentation`, and that `loginPresentation` continues to return it while the state is a recovery state (so the `if let presentation` block in `AuthView` keeps rendering `CheckEmailView` + `legacyRecoveryActions`). Add a terminal-state guard so the scene-phase `.active` refresh (`RootView` ~line 918) and the `CheckEmailView.task` poller do not re-run exchange or downgrade a recovery state. Confirm `handleIncomingURL`'s `else if appState != .auth` branch does not stomp the recovery presentation when already in `.auth`.

**Patterns to follow:** existing `isTerminal` switch in `CheckEmailView`; existing `.legacyRecovery` mapping in `AuthManager.magicFailureState`.

**Test scenarios:**

- Covers R4. Given exchange throws `serverError(code:"LEGACY_ACCOUNT_RECOVERY_REQUIRED", details:)`, `magicLoginState` becomes `.legacyRecovery(maskedEmail:, authMethods:["apple","phone"])` and `pendingMagicLoginPresentation` remains non-nil.
- A subsequent scene-phase `.active` refresh while state is `.legacyRecovery` does not change the state or clear the presentation.
- The `CheckEmailView.task` poll loop treats `.legacyRecovery` as terminal and stops (no further exchange calls).
- `authMethods` containing `apple` yields the Apple recovery button; containing `phone` yields the phone button (render-condition unit check where feasible).

**Verification:** Simulator run — request magic link for an email that maps to an Apple+phone account (or a fixture), open the link, confirm the recovery screen with Apple/phone buttons holds and does not flash; tapping Apple runs SIWA → same account → signed in.

**Execution note:** Test-first on the `AuthManager` state transition (deterministic); the presentation-lifetime guard is verified on-simulator.

---

### U3. Ship: deploy backend, build & upload iOS to TestFlight

**Goal:** Get the fix in front of internal testers.

**Requirements:** R6

**Dependencies:** U1, U2

**Files:** none (release ops); version bump in `PorizoApp/PorizoApp.xcodeproj/project.pbxproj` (`CURRENT_PROJECT_VERSION`).

**Approach:**

1. Backend: push `main` → Railway auto-deploy → verify the R1/R2 behavior against prod (curl the exchange with a known-safe vs known-provider email fixture, or re-test on device).
2. iOS: bump `CURRENT_PROJECT_VERSION` (build 151), archive, export with the ASC API-key auth flags, upload to TestFlight, release to internal testers.

**Test scenarios:** `Test expectation: none — release/ops unit; behavior covered by U1/U2.`

**Verification:** Prod exchange returns a session (not 409) for the safe case; TestFlight build 151 available to internal testers; user completes login on device.

---

## Scope Boundaries

**In scope:** server auto-merge safety logic + iOS recovery-screen stability for the **login** magic-link flow; ship to TestFlight.

### Deferred to Follow-Up Work

- Magic-login rate-limiter **fail-open** hardening (`consumeAuthRateLimit` default `failClosed:false`) — review finding #1, separate change.
- Android client parity for the recovery UX (`refactor` branch) — per standing directive, not merged now.

**Out of scope:** web magic-login flow changes beyond shared-path effects; `add_email` purpose behavior; any change to SIWA itself.

---

## Risks & Dependencies

- **Security (primary):** relaxing the legacy guard is account-linking surface. Mitigated by KTD1 (provider-presence gate) + R5 test (no cross-account writes) + a security review pass before ship.
- **Concurrency (iOS):** the presentation race involves three async triggers; the fix must not deadlock or leave the poller spinning. Verified on-simulator + `AuthManagerTests`.
- **Deploy coupling:** backend must be live in prod before the TestFlight build is exercised (the earlier root cause was exactly a client-ahead-of-backend gap — see `tasks/lessons.md` 2026-07-13).

---

## Sources & Research

- Prod logs (Railway) + prod DB (`schema_migrations`, `user_auth_providers`, `user_contacts`) — root cause verified this session.
- `src/routes/auth.js`, `src/services/identity-service.js`, `src/database/identity-repository.js`.
- `PorizoApp/PorizoApp/{AuthManager,AuthView,CheckEmailView,RootView,APIClient}.swift`.
