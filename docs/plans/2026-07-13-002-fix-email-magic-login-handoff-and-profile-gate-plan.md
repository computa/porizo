---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
type: fix
canonical_contract: docs/identity-contract.md
created: 2026-07-13
supersedes_behavior_in: docs/plans/2026-07-11-002-feat-platform-bound-magic-login-plan.md
---

# Fix email-only sign-in, legacy profile migration, and mobile link handoff

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept current while the work is executed. It follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this change, a person enters an email address, immediately sees a dedicated “Check your email” screen, taps the link on the requesting phone, and is signed into the correct Porizo account. A valid link should open the app directly when Universal Links are healthy. If iOS opens Safari because its association cache is stale or the browser preference was overridden, the browser must securely approve the request and return the person to Porizo instead of showing a dead end.

The mandatory profile sheet will no longer ask email-authenticated users for a phone number or display name. It remains only as a narrow migration path for a signed-in legacy Apple, Google, or phone account that does not yet have a verified non-relay email.

## Progress

- [x] (2026-07-13 09:55Z) Reproduced the three reported states from screenshots and traced their backend and iOS owners.
- [x] (2026-07-13 10:03Z) Verified production DNS, TLS, origin AASA, and Apple CDN AASA for `auth.porizo.co`.
- [x] (2026-07-13 10:07Z) Confirmed Resend click and open tracking are disabled for `porizo.co`; the email URL is not being rewritten.
- [x] (2026-07-13 10:15Z) Identified the stale profile-completion policy, weak sent-state UI, intentional browser dead end, and legacy duplicate-account risk.
- [x] (2026-07-13 11:20Z) U1: Corrected the canonical identity/profile policy and legacy-account resolution.
- [x] (2026-07-13 11:45Z) U2: Added a dedicated, persistent Check Email phase to iOS and Android.
- [x] (2026-07-13 12:10Z) U3: Added secure browser approval and same-device app completion fallback.
- [x] (2026-07-13 12:24Z) U4: Derived the magic-login host into runtime validation and added a fail-closed association preflight.
- [ ] U5: Automated backend, iOS, Android, migration, and security gates pass. Production deployment and physical-device acceptance remain release operations.

## Surprises & Discoveries

- Observation: the first screenshot is not the email-only login screen. It is `ProfileCompletionView`, automatically presented by `RootView` because the server still defines a complete profile as both a verified non-relay email and a verified phone.
  Evidence: `src/services/identity-service.js` `computeProfileCompleteness()` adds both `verified_email` and `verified_phone`; `PorizoApp/PorizoApp/RootView.swift` `syncProfileCompletionContext()` presents the sheet.

- Observation: the green phone check can be misleading. The view treats any stored `phoneNumber` as satisfying a server requirement for a verified phone.
  Evidence: `PorizoApp/PorizoApp/ProfileCompletionView.swift` `hasPhone` only checks for non-nil and `canContinue` accepts `hasPhone` when `verified_phone` is missing.

- Observation: a successful request does not navigate. `AuthView` only changes the existing button to “Resend sign-in link” and renders a small inline status string.
  Evidence: `PorizoApp/PorizoApp/AuthView.swift` `magicButtonTitle` and `magicStatusMessage` handle `.sent` and `.cooldown` without changing the view phase.

- Observation: Safari is showing the backend’s designed fallback, not an exception page. For native links the fallback deliberately says that it cannot sign in.
  Evidence: `src/routes/auth.js` `GET /auth/magic/:platform` returns the exact HTML shown in the third screenshot.

- Observation: build 149 was installed before `auth.porizo.co` and its AASA were operational. iOS can retain a failed Universal Link association until app reinstall or a later refresh. The origin and Apple CDN now both return the correct AASA, so a fresh install is expected to restore direct opening but cannot be the only recovery mechanism.

- Observation: a completed login exchange resolves only a verified email contact. If the address exists on a legacy account only as an unverified contact, the current code creates a new user. That can split songs and entitlements across two `users.id` records.
  Evidence: `src/routes/auth.js` `POST /auth/magic/exchange` calls `findActiveUserByVerifiedContact()` and otherwise calls `createUserWithIdentityInRepository()`.

## Decision Log

- Decision: verified non-relay email is the only mandatory profile/authentication requirement for the email-only release. Phone and display name are optional profile data.
  Rationale: requiring phone after a verified magic-link login contradicts the selected product model and adds friction without strengthening ownership of the email credential.
  Date/Author: 2026-07-13 / Codex

- Decision: retain a reduced migration gate only for an already-authenticated legacy account that lacks a verified non-relay email.
  Rationale: removing the gate entirely would strand Apple relay and phone accounts or encourage creation of duplicate accounts. An authenticated add-email transaction can safely bind the verified address to the existing `users.id`.
  Date/Author: 2026-07-13 / Codex

- Decision: do not automatically merge a logged-out magic-link claimant into an account that merely stores the address as an unverified contact.
  Rationale: an unverified address is not proof that the old account owner controlled it. Automatic linking would create an account-takeover path.
  Date/Author: 2026-07-13 / Codex

- Decision: keep direct Universal Links as the fast path and add browser approval as a fallback, rather than weakening same-device binding or relying on reinstall instructions.
  Rationale: mail apps, browser preferences, and stale associated-domain caches can route valid links through Safari. The fallback must complete safely in normal production conditions.
  Date/Author: 2026-07-13 / Codex

- Decision: the browser may prove possession of the emailed link but may not create a native session. The requesting app must still prove possession of its device-only request secret.
  Rationale: this preserves the two independently delivered factors and prevents forwarded links or email scanners from signing in a different device.
  Date/Author: 2026-07-13 / Codex

- Decision: loading the fallback page does not approve the link. Approval requires an explicit user tap on a clearly labelled Continue Sign-in button.
  Rationale: an attacker can request a link for a victim's email while holding the requester secret. If an email-security scanner could execute an automatic approval POST, the attacker could receive the victim's session without the victim acting.
  Date/Author: 2026-07-13 / Codex

## Outcomes & Retrospective

U1-U4 are implemented. Email-only users no longer encounter the phone/profile gate; iOS and Android persist a full Check Email state; direct links exchange in-app; Safari fallback approval still requires the requesting device secret; and unverified legacy contacts cannot silently create duplicate owners. Automated gates pass across the backend, migrations, iOS, and Android. Production migration/deployment, a real Play App Signing fingerprint, and the physical-device matrix remain explicit release gates rather than code-complete claims.

The adversarial implementation review found eight material defects: missing browser status/completion routes, duplicate creation for unverified legacy contacts, authenticated-session replacement, a placeholder Android association fingerprint, a legacy recovery dead end, concurrent request races, retained Android intent secrets, and missing focused tests. The code-owned findings were fixed and covered. The Play signing fingerprint is deliberately fail-closed in the release preflight because it must come from Play Console provisioning.

## Context and Orientation

`users.id` is the permanent ownership key for songs, shares, purchases, entitlements, and sessions. Login methods are credentials attached to that owner; changing the login method must never move or duplicate ownership.

`src/routes/auth.js` owns the HTTP magic-link request, landing page, and exchange routes. `src/services/magic-login-service.js` verifies the request/link secrets and coordinates atomic consumption. `src/database/magic-login-repository.js` stores transaction state. `src/services/identity-service.js` computes profile completeness and links verified contacts.

`PorizoApp/PorizoApp/AuthView.swift` is the logged-out email entry screen. `PorizoApp/PorizoApp/AuthManager.swift` stores the requester secret in device-only Keychain and exchanges links. `PorizoApp/PorizoApp/RootView.swift` routes incoming Universal Links and presents the legacy profile-completion sheet. `PorizoApp/PorizoApp/ProfileCompletionView.swift` currently combines display name, email verification, and phone verification and must be reduced.

The direct native link has two secrets. The email contains `link_secret` in the URL fragment. The requesting app holds `request_secret` in device-only storage. A session is valid only when both factors apply to the same unexpired transaction and platform.

## Plan of Work

### U1. Correct account ownership and the profile migration gate

Change `computeProfileCompleteness()` in `src/services/identity-service.js` so a verified non-relay email is the sole mandatory requirement. Remove `verified_phone` from the completion contract. Keep phone and display name editable in Settings, but never block launch on them.

Reduce `PorizoApp/PorizoApp/ProfileCompletionView.swift` to one responsibility: while the person is already authenticated to a legacy account, collect and verify a non-relay email using `purpose: add_email`. Rename it to `EmailUpgradeView` if doing so does not create broad churn; otherwise retain the filename and replace the UI. Remove the name field, phone field, phone OTP state, false verified badge, and generic Continue button. The success action is the completed magic-link exchange, after which `/auth/me` is refreshed and the sheet dismisses. Add a clear “Not now” action only if the seven-day deferral remains a deliberate product decision.

Before allowing `purpose: login` to create a new user, query active identities and contacts for the normalized email. The rules are:

1. A verified email identity/contact resolves the existing owner.
2. No identity or contact creates a new owner only after successful two-factor exchange.
3. An unverified contact on an existing account must not auto-link and must not silently create a duplicate. Return a typed `LEGACY_ACCOUNT_RECOVERY_REQUIRED` result. The app explains that the email was previously added to an account and offers the legacy recovery route. Keep Apple/Google/phone providers hidden from the primary login screen, but expose the relevant existing provider under a contextual “Recover existing account” action when this typed result occurs.
4. An authenticated `add_email` exchange links the verified email to that authenticated owner and clears the migration gate.

Update `docs/identity-contract.md` first so the policy, legacy conflict, and ownership invariants are canonical. Add backend tests proving phone is optional, magic-email users do not see a profile gate, authenticated legacy migration preserves `users.id`, and logged-out unverified-contact exchange neither creates nor links a user.

### U2. Add a dedicated Check Email phase

Refactor `PorizoApp/PorizoApp/AuthView.swift` into explicit entry and sent phases. After `POST /auth/magic/request` returns 202, replace the form with a dedicated Check Email view containing the destination address, “Open Mail,” “Resend link” with a visible countdown, “Use a different email,” and concise same-device guidance. The legacy add-email migration view must use the same sent-state component without navigating into the logged-out `AuthView`. Say “sign-in link,” not “code,” because no code is sent.

Persist enough non-secret presentation state to restore the Check Email phase after process termination. Keep the requester secret only in the existing ThisDeviceOnly Keychain store. When the app becomes active, refresh transaction status so a browser-approved request can complete without requiring another tap. Provide loading, offline, expired, wrong-device, conflict, and success states with VoiceOver announcements and Dynamic Type-safe layout.

Apply the same state-machine behavior in `/Users/ao/Documents/projects/porizo/.worktrees/refactor-android/PorizoAndroid/Android` without requiring pixel-identical UI. Keep Android changes on the `refactor` branch and do not mix that branch into the iOS/backend commit. Add iOS previews/fixtures and focused state tests for request success, cooldown, change email, app restart, expiry, and completion.

### U3. Replace the browser dead end with secure approval

Add migration `128_magic_login_browser_approval.sql` for approval timestamp/state and any bounded attempt metadata. Extend `src/database/magic-login-repository.js` and `src/services/magic-login-service.js` with atomic operations that never expose stored hashes.

Add three native fallback operations:

- `POST /auth/magic/native/approve`: called only after an explicit user tap on Continue Sign-in on the HTTPS landing page, with `transaction_id`, platform, and `link_secret`. It verifies the link factor, records approval, strips the fragment from browser history, creates no session, and is idempotent. Page load and passive JavaScript execution must not call it.
- `POST /auth/magic/native/status`: called by the requesting app with `transaction_id`, platform, and `request_secret`. It returns only pending, approved, expired, locked, consumed, or conflict; it leaks no account existence before proof.
- `POST /auth/magic/native/complete`: called by the requesting app with the requester factor after browser approval. It atomically consumes the approved transaction and issues the same native result as direct exchange.

Keep the existing direct Universal Link exchange as the preferred one-round path. Update the native landing page to explain why Safari opened and present Continue Sign-in. After explicit approval, show “Email confirmed” and a user-initiated Open Porizo button using `porizo://auth/magic/resume?transaction_id=...`. The custom scheme must carry no link secret, request secret, token, email, or session. Do not depend on an automatic custom-scheme navigation after an asynchronous request because Safari may block it without a user gesture. If the app is absent, show the correct App Store/Play Store action. A plain `GET`, passive scanner execution, wrong platform, forwarded link, or app without the requester secret must never create a session.

Add concurrency, replay, scanner, expiry, wrong-device, wrong-platform, response-loss recovery, and log-redaction tests. Add a CSP that allows only the inline nonce-bearing approval script and same-origin API calls.

### U4. Make associated-domain rollout deterministic

Derive required hosts from `MAGIC_LOGIN_WEB_ORIGIN` and configured public origins in server startup validation instead of relying on a manually synchronized `HOST_ALLOWLIST`. Fail startup with a precise message if production configuration is inconsistent.

Add a release preflight command under `scripts/release/` that verifies:

- `auth.porizo.co` DNS and TLS;
- origin AASA content type, app identifier, and `/auth/magic/ios*` path;
- Apple CDN AASA;
- Android `assetlinks.json` package and Play signing fingerprint;
- native entitlements/manifests include the same host;
- Resend click/open tracking remains disabled for authentication mail.

Document that a release device installed before the domain became valid must be deleted and reinstalled for deterministic Universal Link testing. Include Apple’s Universal Links Diagnostics and the Notes long-press “Open in Porizo” test in `docs/pre-testflight-distribution-checklist.md`.

### U5. Validate end to end before rollout

Deploy migration and backend behind `MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED=false`. Run backend tests and migrations on SQLite and PostgreSQL. Build and test iOS and Android. Enable the browser fallback only after origin/CDN association preflight passes.

On a physical iPhone using a fresh TestFlight install, validate: new email registration; existing verified email login; authenticated legacy Apple/phone account email upgrade; direct app opening; Safari fallback approval; app background and terminated completion; resend; expiry; forwarded link; wrong device; logout and one-year absolute session; and preservation of the original `users.id`, songs, and entitlements. Repeat the equivalent Android App Link cases on a physical Android device.

## Concrete Steps

Run all commands from `/Users/ao/Documents/projects/porizo`.

1. Update the contract and implement U1 with focused tests first:

       NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/auth-identity-model.test.js test/magic-login-api.test.js
       cd PorizoApp && xcodebuild test -project PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro'

2. Implement U2 and run signed iOS auth tests. In the Android worktree, run:

       cd /Users/ao/Documents/projects/porizo/.worktrees/refactor-android/PorizoAndroid/Android
       gradle :feature:auth:testDebugUnitTest :app:assembleDebug

3. Implement migration 128 and U3, then run both database lanes:

       NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/magic-login-api.test.js test/magic-login-service.test.js test/database/migration-runner.test.js
       npm run test:pg -- test/magic-login-api.test.js test/identity-repository.test.js

4. Run the full repository gate because `AGENTS.md` makes discovered failures in scope:

       npm run lint
       npm test

5. Run the associated-domain preflight, archive the iOS app on the stable Xcode lane, and execute the physical-device matrix before enabling the fallback in production.

Expected focused evidence includes no new user row for an unverified-contact conflict, one session under concurrent completion, no phone requirement in `/auth/me`, restoration of the Check Email phase after restart, and successful direct and Safari-fallback completion on the requesting device.

## Validation and Acceptance

- A freshly installed iOS build opens a valid `https://auth.porizo.co/auth/magic/ios?...` link in Porizo and signs in.
- If the same link opens Safari, Safari approves the email factor and returns the user to Porizo; the requesting app completes without exposing credentials in the custom-scheme URL.
- A successful request always transitions to a full Check Email phase. The user can open Mail, resend after cooldown, or change the email.
- A magic-email-authenticated user enters the main app without the old Complete Profile sheet.
- A legacy authenticated account can add a verified email without changing `users.id`, content ownership, or entitlements.
- A logged-out email that exists only as an unverified legacy contact cannot create a duplicate account and cannot take over the legacy account.
- Phone number and display name remain editable but are never authentication gates.
- Forwarded, expired, scanned, replayed, wrong-platform, and wrong-device links create no session.
- Full lint and test suites pass, and iOS/Android release builds complete.

## Idempotence and Recovery

Migration 128 must use guarded schema changes and be safe to run once per environment through the normal migration runner. Approval and completion operations must be idempotent for network retries. Existing direct exchanges remain supported during rollout.

If browser approval causes unexpected production behavior, disable `MAGIC_LOGIN_BROWSER_APPROVAL_ENABLED` without disabling direct Universal Links. If the profile policy migration exposes legacy conflicts, retain the old credentials and account owner unchanged; never auto-merge, delete, or move entitlements as a rollback mechanism.

## Interfaces and Dependencies

The backend must expose typed native transaction states and errors. Suggested response shape for status is `{ status, expires_at }`; it must not include user ID or account-existence details before both factors are proven. Completion returns the existing native token envelope.

The iOS auth state machine must have explicit entry, sent, opening, exchanging, success, expired, conflict/recovery, wrong-device, offline, and server-error states. The selected sent payload must own its email and transaction ID so presentation cannot race separate Boolean state.

Use existing `MagicLoginSecretStore`, `magicLoginService`, identity repositories, session issuance, and email templates. Do not introduce a second account model, an auth token in URL query/fragment, or a browser-created native session.

## Plan Review Notes

Adversarial review rejected four tempting shortcuts: simply deleting the profile sheet would strand legacy accounts; auto-merging an unverified email would enable account takeover; fixing only AASA/reinstall instructions would leave valid users stuck whenever Safari handles the link; and auto-approving the Safari page would allow an email scanner to act as the victim's email factor. The sequenced plan resolves ownership first, then UX, then resilient handoff, so UI work cannot conceal an identity split.
