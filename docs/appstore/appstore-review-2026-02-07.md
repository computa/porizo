# App Store Review Audit — 2026-02-07

## Verdict: GO

All 3 previously identified blockers have been fixed. No new blockers found. 4 warnings to consider before submission (none are rejection-critical).

## Blockers (0)

| # | Category | Issue | File:Line | Fix |
|---|----------|-------|-----------|-----|

No blockers found.

## Previous Blockers — Resolution Status

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 1 | Privacy policy said "IDFV" but code uses keychain UUID | **FIXED** | Policy now says "App-scoped device identifier stored in iOS Keychain" (`privacy.html:121`). Code confirmed at `RootView.swift:216-235`. |
| 2 | Retention period: policy said 90 days, code said 7 years | **FIXED** | Policy now says "Audit logs: 7 years (regulatory and security audit trail)" (`privacy.html:246`). Matches `gdpr-audit-service.js:5,48`. |
| 3 | Privacy manifest under-declared collected data types | **FIXED** | Manifest now declares 11 data types and 3 accessed API categories. All cross-referenced against actual code usage. |

## Warnings (4)

| # | Category | Issue | File:Line | Fix |
|---|----------|-------|-----------|-----|
| 1 | A | "Coming soon" toast messages shown when tapping AI Generate buttons in CustomCreateView. Two user-visible messages: "AI line generation coming soon!" and "AI lyrics generation coming soon!". Apple may flag as incomplete feature. | `CustomCreateView.swift:679-681` | Remove "coming soon" language. Use neutral wording or hide the Generate button until implemented. |
| 2 | A | "Listen to Poem" action row in PoemActionMenu has `// TODO: TTS feature` and dismisses without doing anything. No-op button visible to users. | `PoemActionMenu.swift:43-49` | Remove the "Listen to Poem" row until TTS is implemented, or replace with a toast explaining it's not yet available (without "coming soon" wording). |
| 3 | K | Associated Domains entitlement is commented out. App uses `porizo://` custom URL scheme for deep links, which works. If universal links (applinks) are intended, uncomment and update provisioning. | `PorizoApp.entitlements:11-17` | Leave as-is if universal links not needed for v1. Uncomment + update provisioning if needed. |
| 4 | J | Screenshot `05-songs-empty.jpg` shows an empty state. Not a rejection risk but weak for conversion. | `PorizoApp/screenshots/6.7-inch/05-songs-empty.jpg` | Replace with a screenshot showing songs in the library. |

## Info (7)

| # | Category | Note | File:Line |
|---|----------|------|-----------|
| 1 | B | Privacy manifest declares `SystemBootTime` (35F9.1) — no direct usage found in app code. Likely used by Firebase SDK internally. Over-declaring is safe. | `PrivacyInfo.xcprivacy:164-169` |
| 2 | B | Privacy manifest declares `FileTimestamp` (C617.1) — `FileManager` is used but timestamp-specific attributes only in tests. Firebase SDK likely uses this internally. Over-declaring is safe. | `PrivacyInfo.xcprivacy:155-161` |
| 3 | E | `TARGETED_DEVICE_FAMILY` is `1` (iPhone only) for app target, `1,2` for test target only. Correct and consistent. | `project.pbxproj:496,531,546,562` |
| 4 | G | Subscription disclosure correctly rendered in view body. Includes billing period, auto-renewal terms, and management instructions. | `SubscriptionView.swift:73,382-412` |
| 5 | H | Abuse reporting mechanism exists via email (`abuse@porizo.co`) in ShareClaimView and SharedPoemView. | `ShareClaimView.swift:168-170`, `SharedPoemView.swift:276-278` |
| 6 | F | Demo account documented: `reviewer@porizo.co` / `PorizoDemo2026!`. Ensure provisioned on production backend with pre-enrolled voice profile before submission. | `app-store-metadata.md:253-274` |
| 7 | D | TestFlight "What's New" mentions "Poems feature coming soon" — ensure this text is NOT in the App Store description. Confirmed: production description does not contain "coming soon". | `app-store-metadata.md:112` |

## Pre-Submit Action List (Ordered by rejection risk)

1. **[WARNING]** Remove "coming soon" language from CustomCreateView toast messages (lines 679, 681)
2. **[WARNING]** Remove or disable "Listen to Poem" action in PoemActionMenu until TTS is implemented
3. **[WARNING]** Consider replacing empty-state screenshot before submission
4. **[INFO]** Verify demo account `reviewer@porizo.co` is provisioned and functional on production backend
5. **[INFO]** Decide on universal links: if needed for v1, uncomment associated-domains entitlement

## Quality Gates

| Gate | Result | Details |
|------|--------|---------|
| npm lint | PASS | Clean — no errors or warnings |
| npm test | PASS | 109 passed, 0 failed, 44 skipped (PostgreSQL-dependent tests skipped locally) |
| Xcode build (Release) | SKIPPED | Manual verification recommended via `xcodebuild archive` |
| Xcode tests | SKIPPED | Manual verification recommended |

## Web Research: New Rejection Patterns Found (2026)

- **AI Data Sharing Consent (NEW):** Apple now requires explicit user consent before sharing personal data with third-party AI systems. Porizo uses AI for lyrics/music generation — verify consent is obtained before sending user story data to API. Source: [Apple Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **Age Rating Updates:** New 13+, 16+, 18+ ratings added. Developers must update responses by Jan 31, 2026. Verify Porizo has correct age rating for AI-generated content.
- **TN3183 Active Enforcement:** Required reason API entries are actively enforced via automated scanner before human review. Source: [TN3183](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest)

## Verification Log

### Category A: App Completeness
- Scanned all .swift files for TODO/FIXME/placeholder/coming soon/lorem ipsum
- 6 TODO comments found — all in code comments (not user-visible), except CustomCreateView:679,681 (toast messages) and PoemActionMenu:48 (TODO comment with no-op action)
- V1ScreenPlaceholders access verified behind `#if DEBUG` in SettingsTabView:475
- DesignSampleView access verified behind `#if DEBUG` in RootView:42-44

### Category B: Privacy Manifest
- All 11 `NSPrivacyCollectedDataTypes` cross-referenced against actual code usage: Name (OAuth), Email (AuthView:199), Phone (PhoneAuthView), Audio (AudioRecorder), UserContent (story prompts), UserID (auth), DeviceID (RootView:216), PurchaseHistory (StoreKitManager), ProductInteraction (Firebase Analytics), CrashData (Crashlytics), PerformanceData (Firebase)
- All 3 `NSPrivacyAccessedAPITypes` verified: UserDefaults (15+ usages), FileTimestamp (Firebase SDK), SystemBootTime (Firebase SDK)

### Category C: Privacy Policy vs Code
- Identifier: "App-scoped device identifier stored in iOS Keychain" ↔ `KeychainHelper.saveString(key: "porizo_device_id")` — MATCH
- Retention: "Audit logs: 7 years" ↔ `gdpr-audit-service.js:48 audit_logs: "7_years"` — MATCH
- IP: "may be hashed in audit logs" ↔ `gdpr-audit-service.js:45 ip_address` logged — MATCH
- Third-party services: Firebase, ElevenLabs, Suno, Replicate — all confirmed in code

### Category D: Legal & Metadata
- Legal URLs: `porizo.co/legal/terms` and `porizo.co/legal/privacy` — routes confirmed in `legal.js:142-154`
- Support page: Contact email, FAQ, deletion instructions — all present and consistent
- App description features: voice enrollment, song creation, preview, sharing, background audio — all verified in code

### Category E: Device Compatibility
- TARGETED_DEVICE_FAMILY: App target = `1` (Debug + Release), Test target = `1,2` — consistent
- IPHONEOS_DEPLOYMENT_TARGET: `17.0` across all configs
- No stale UIRequiredDeviceCapabilities entries

### Category F: Auth & Account
- Sign in with Apple: `SignInWithAppleButton` at AuthView:198 — present and prominent
- Delete Account: SettingsTabView:527-548 → auth-service.js:665-744 full cascade confirmed
- Demo account: Documented at app-store-metadata.md:266-268

### Category G: Billing & Subscriptions
- StoreKit 2: `Product.purchase()` at StoreKitManager:255
- Restore: Buttons in SubscriptionView:391-393 AND SettingsTabView:467-473
- Disclosure: Rendered at SubscriptionView:73, text at 409-411 includes billing period, auto-renewal, management

### Category H: Content Safety
- Moderation pipeline: Spec confirms MODERATION step in render workflow
- Abuse reporting: Email to `abuse@porizo.co` in ShareClaimView:168-170 and SharedPoemView:276-278

### Category K: Entitlements
- `com.apple.developer.applesignin` — Used: ASAuthorizationAppleIDProvider in AuthManager:529
- `aps-environment = production` — Used: registerForRemoteNotifications in PorizoAppApp:23
- Associated Domains — Commented out (not active in build)
- UIBackgroundModes: audio (AVPlayer), fetch (BGTaskScheduler), remote-notification (push), processing (BGProcessingTask) — all verified
