# App Store Review Audit — 2026-02-14

## Verdict: NO-GO

Two blockers must be fixed before submission: (1) "coming soon" UI text visible to users in Release builds violates Guideline 2.1, and (2) the subscription auto-renewal disclosure is missing the required subscription name, price, and duration per Apple Guideline 3.1.2(a).

---

## Blockers (2)

| # | Category | Issue | File:Line | Fix |
|---|----------|-------|-----------|-----|
| 1 | A (2.1 App Completeness) | "Coming soon" toast shown to users in Release builds. When a user taps the "Generate" button for lyrics/lines in CustomCreateView, a ToastService message says "AI line generation coming soon!" or "AI lyrics generation coming soon!". This is NOT behind `#if DEBUG`. Apple flags "coming soon" UI elements under Guideline 2.1. | `PorizoApp/Flows/CustomCreateView.swift:692-694` | Either (a) hide the Generate button entirely if the feature is not implemented, or (b) remove the "coming soon" language and replace with neutral messaging. |
| 2 | G (3.1.2 Subscriptions) | Subscription auto-renewal disclosure text is missing the required subscription name, price, and duration. Apple requires the disclosure to include "the subscription name, duration, price, and that payment will be charged to the user's App Store account." Current text only says billing period and auto-renewal policy. | `PorizoApp/SubscriptionView.swift:412-414` | Update `subscriptionDisclosureText` to dynamically include the selected plan name, price, and billing period. Example: "Plus Monthly: $9.99/month. Subscription auto-renews unless canceled at least 24 hours before the end of the current period. Payment will be charged to your Apple ID account. Manage or cancel in Settings > Apple ID > Subscriptions." |

## Warnings (8)

| # | Category | Issue | File:Line | Fix |
|---|----------|-------|-----------|-----|
| 1 | A (2.1) | TODO comment "// TODO: Show settings" renders a gear button that does nothing when tapped. Non-functional UI elements risk rejection. | `PorizoApp/Flows/CustomCreateView.swift:213` | Either implement the settings action or remove the gear button. |
| 2 | B (TN3181) | Privacy manifest declares `CrashData` and `PerformanceData` as `NSPrivacyCollectedDataTypeLinked = true`, but Crashlytics has analytics disabled and no user ID is set on Crashlytics. | `PorizoApp/PrivacyInfo.xcprivacy:122-123` | Change `NSPrivacyCollectedDataTypeLinked` to `false` for both since no user ID is set on Crashlytics. |
| 3 | B (TN3181) | Privacy manifest declares `ProductInteraction` as `NSPrivacyCollectedDataTypeLinked = true`, but with analytics disabled, product interaction data is not being collected in a linked manner. | `PorizoApp/PrivacyInfo.xcprivacy:110-111` | Change `NSPrivacyCollectedDataTypeLinked` to `false` or remove this entry entirely. |
| 4 | D (Metadata) | TestFlight notes mention "Poems feature coming soon" which signals incomplete functionality if visible during review. | `docs/appstore/description.md:111` | Remove "coming soon" from version notes — poems feature appears implemented. |
| 5 | F (5.1.1 Account) | Demo account credentials reference `reviewer@porizo.co` but actual password is not documented. | `docs/appstore/description.md:268-269` | Create the actual demo account on backend and document real password in App Store Connect review notes. |
| 6 | G (3.1.2) | No subscription management deep link. Disclosure text says "Manage or cancel in your App Store subscription settings" but provides no tappable link. | `PorizoApp/SubscriptionView.swift:414` | Add a "Manage Subscription" button that opens `itms-apps://apps.apple.com/account/subscriptions`. |
| 7 | J (Screenshots) | Only 5 screenshots in 6.7" directory, some showing empty states. No 6.5" screenshots found. | `PorizoApp/screenshots/6.7-inch/` | Capture screenshots with populated data for both 6.7" and 6.5" device sizes. |
| 8 | K (Entitlements) | Push token not being sent to server (TODO at PorizoAppApp.swift:40). Push notifications may silently fail. | `PorizoApp/PorizoAppApp.swift:40` | Complete push token server registration. |

## Info (7)

| # | Category | Note | File:Line |
|---|----------|------|-----------|
| 1 | A | Three TODO comments in non-debug Swift code. None render user-visible text but indicate incomplete features. | Multiple files |
| 2 | B | Privacy manifest declares `SystemBootTime` API (reason `35F9.1`). Used by Firebase SDK internally. Over-declaring is safe. | `PrivacyInfo.xcprivacy:164-168` |
| 3 | C | Privacy policy correctly states "App-scoped device identifier stored in iOS Keychain" — verified matches `KeychainHelper` code using UUID, not IDFV. | `privacy.html:122` |
| 4 | C | Privacy policy retention periods verified: raw recordings "7 days" matches `retentionDays: 7` in server.js; audit logs "7 years" matches gdpr-audit-service.js. | `privacy.html:92-93` |
| 5 | E | Deployment target iOS 17.0 and TARGETED_DEVICE_FAMILY "1,2" (universal) are consistent across all build configurations. | `project.pbxproj` |
| 6 | F | Sign in with Apple is primary auth option. Google/Facebook conditional. Delete Account has two-step confirmation with full cascade deletion on backend (voice profiles, tracks, billing, share tokens, auth data). Verified complete. | `AuthView.swift:62` |
| 7 | K | `associated-domains` entitlement is commented out. Fine since universal links are not yet active. | `PorizoApp.entitlements:11-17` |

---

## Quality Gates

| Gate | Result | Details |
|------|--------|---------|
| npm lint | PASS | 0 errors |
| npm test | PASS | 120 passed, 0 failed, 49 skipped (PostgreSQL) |
| Xcode build (sim) | PASS | Built successfully earlier this session |
| Xcode tests | NOT RUN | |

---

## Pre-Submit Action List (Ordered by rejection risk)

1. **[BLOCKER]** Remove or reword "coming soon" toast in CustomCreateView.swift:692-694
2. **[BLOCKER]** Update subscription disclosure in SubscriptionView.swift:412-414 with plan name, price, duration, and Apple ID charge language
3. **[WARNING]** Add subscription management deep link (`itms-apps://apps.apple.com/account/subscriptions`)
4. **[WARNING]** Remove non-functional gear button in CustomCreateView.swift:213
5. **[WARNING]** Fix privacy manifest: set `CrashData`, `PerformanceData`, `ProductInteraction` linked to `false`
6. **[WARNING]** Complete push token server registration (PorizoAppApp.swift:40)
7. **[WARNING]** Create and document demo account (`reviewer@porizo.co`)
8. **[WARNING]** Capture screenshots with populated content for 6.7" and 6.5" devices
9. **[INFO]** Remove "Poems feature coming soon" from TestFlight notes

---

## Verification Log

All blockers and warnings verified by reading source files with 20+ lines of surrounding context.
Debug-only guards (`#if DEBUG`, `#if targetEnvironment(simulator)`) checked and confirmed NOT present on flagged items.

### Sources
- [App Store Rejection Reasons - Adapty](https://adapty.io/blog/app-store-rejection/)
- [Apple Privacy Manifest Documentation](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [TN3183 - Required Reason API Entries](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest)
- [App Review Guidelines - Apple](https://developer.apple.com/app-store/review/guidelines/)
- [Apple Guidelines Feb 2026 Update](https://developer.apple.com/news/?id=ey6d8onl)
- [App Store Requirements 2026 - Natively](https://natively.dev/articles/app-store-requirements)
