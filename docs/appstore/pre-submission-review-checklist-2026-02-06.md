# Porizo iOS Pre-Submission App Review Checklist (Artifact-Mapped)

> Superseded by `/Users/ao/Documents/projects/porizo/docs/appstore/pre-submission-review-checklist-2026-02-07.md`.

Generated: 2026-02-07 (local)
Scope: iOS app (`PorizoApp`) + backend/legal artifacts that directly affect App Review outcomes.

## Verification Snapshot

- `npm test` passed (`102 passed`, `49 skipped`, `0 failed`) using script in `/Users/ao/Documents/projects/porizo/package.json:11`.
- `npm run lint` failed with `23` errors, including undefined identifiers in `/Users/ao/Documents/projects/porizo/src/server.js:6347` and `/Users/ao/Documents/projects/porizo/src/server.js:6357`.
- iOS simulator build succeeded (warnings present).
- iOS XCTest run succeeded: `103 tests`, `2 skipped`, `0 failed`.
- Latest local test artifact: `/Users/ao/Library/Developer/Xcode/DerivedData/PorizoApp-crpldbjqjfovdcbxamjreapjjgfq/Logs/Test/Test-PorizoApp-2026.02.07_06-32-42-+0800.xcresult`.

## Decision Gate Summary

- `GO` only after all `BLOCKER` rows are resolved.
- Current status: `NO-GO` (multiple blockers remain).

## Checklist (Mapped 1:1 to Current Artifacts)

### A) App Completeness and Functionality (Guidelines 2.1, 4.2)

1. `BLOCKER` - No placeholder controls in release UI.
Status: `FAIL`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/TrackPlayerFullView.swift:723`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/TrackPlayerFullView.swift:735`
Required action: Implement or remove placeholder `Download` and `AirPlay` actions before submission.

2. `BLOCKER` - No fake success flows for unimplemented features.
Status: `FAIL`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SharedPoemView.swift:327`
Required action: Implement real save behavior or remove the action and any success UI.

3. `BLOCKER` - No internal/debug-only screens visible in production settings.
Status: `FAIL`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:478`
Required action: Remove or gate `Design Screens` behind debug-only compilation/feature flag disabled in Release.

4. App compiles and tests pass on iOS simulator.
Status: `PASS`
Evidence: `/Users/ao/Library/Developer/Xcode/DerivedData/PorizoApp-crpldbjqjfovdcbxamjreapjjgfq/Logs/Test/Test-PorizoApp-2026.02.07_06-32-42-+0800.xcresult`
Required action: Run same test suite on at least one physical iPhone and one iPad class device if iPad stays supported.

5. Backend quality gate (lint) is clean for production-affecting flows.
Status: `FAIL`
Evidence: `/Users/ao/Documents/projects/porizo/src/server.js:6347`, `/Users/ao/Documents/projects/porizo/src/server.js:6357`
Required action: Resolve lint failures before submit; undefined symbols can become runtime review failures.

### B) Metadata Accuracy and Legal Links (Guideline 2.3)

6. `BLOCKER` - In-app Terms and Privacy links resolve to live endpoints.
Status: `FAIL`
Evidence:
- App links: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:456`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:463`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SubscriptionView.swift:732`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SubscriptionView.swift:736`
- Server routes: `/Users/ao/Documents/projects/porizo/src/routes/legal.js:134`, `/Users/ao/Documents/projects/porizo/src/routes/legal.js:141`
Required action: Standardize links to `/legal/terms` and `/legal/privacy` or add redirects for `/terms` and `/privacy`.

7. Auth screen legal links are correctly routed.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/AuthView.swift:223`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/AuthView.swift:227`
Required action: None after Item 6 is fixed globally.

8. Support page includes account deletion instructions and contact channel.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/public/support.html:71`, `/Users/ao/Documents/projects/porizo/public/support.html:79`
Required action: Keep this aligned with in-app path labels.

9. App Store metadata avoids claims that are not fully implemented in current build.
Status: `FAIL`
Evidence:
- Download claim: `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:34`
- Offline/download claims: `/Users/ao/Documents/projects/porizo/docs/appstore/description.md:44`, `/Users/ao/Documents/projects/porizo/docs/appstore/description.md:46`
- Placeholder download UI: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/TrackPlayerFullView.swift:723`
Required action: Remove unsupported claims or implement the features first.

### C) Device Compatibility (Guideline 2.4)

10. `BLOCKER` - Declared device families match screenshot/test coverage.
Status: `FAIL`
Evidence:
- iPad declared: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj/project.pbxproj:496`
- iPad screenshots missing callout: `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:144`
Required action: Either ship iPhone-only (`TARGETED_DEVICE_FAMILY = 1`) or finish iPad QA and upload required iPad screenshots.

11. Device capability keys are current for modern iOS targets.
Status: `FAIL`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:83`
Required action: Remove `armv7` capability; current deployment target is modern iOS.

### D) Authentication and Account Management (Guidelines 4.8, 5.1.1(v))

12. Sign in with Apple is present when third-party sign-in options are available.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/AuthView.swift:61`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/AuthView.swift:83`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/AuthView.swift:89`
Required action: Keep Apple option prominent and always available where Google/Facebook are offered.

13. In-app account deletion entry point exists.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:157`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:167`
Required action: Ensure reviewer test account can trigger deletion end-to-end.

14. Backend account deletion endpoint exists and is authenticated.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/src/routes/auth.js:1310`
Required action: Include reviewer note with deletion steps and expected result.

15. iOS deletion API call path is wired.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/AuthManager.swift:1238`
Required action: Verify error handling UX in airplane mode and 401 scenarios.

### E) Privacy, Data Disclosure, and Manifest (Guideline 5.1.1 + Apple privacy manifest requirements)

16. `BLOCKER` - Privacy manifest covers all collected data categories used by app/SDKs.
Status: `FAIL`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:9`
Required action: Reconcile manifest with actual collection (account/contact/identifiers/usage/diagnostics where applicable).

17. `BLOCKER` - Privacy policy statements match implementation details.
Status: `FAIL`
Evidence:
- Policy says hashed IP only: `/Users/ao/Documents/projects/porizo/public/legal/privacy.html:122`
- Raw IP persisted in auth/session/audit tables: `/Users/ao/Documents/projects/porizo/src/services/auth-service.js:543`, `/Users/ao/Documents/projects/porizo/src/services/auth-service.js:605`
Required action: Either hash/redact IP in code or update policy text to accurately describe storage.

18. Tracking declaration is disabled in privacy manifest.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:5`
Required action: Keep consistent with SDK configuration and App Store privacy questionnaire.

19. Firebase initialization is explicit and must be covered by privacy disclosures.
Status: `NEEDS-VERIFY`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PorizoAppApp.swift:112`
Required action: Confirm Crashlytics/Analytics disclosure alignment in App Store privacy answers and manifest.

### F) Billing and Subscriptions (Guidelines 3.1.1, 3.1.2)

20. In-app subscription purchase uses StoreKit APIs.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/StoreKitManager.swift:251`
Required action: None.

21. Restore purchases entry point exists.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/StoreKitManager.swift:308`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SubscriptionView.swift:727`
Required action: Ensure this path is exercised in TestFlight test plan.

22. Subscription legal copy is clearly visible on paywall (auto-renew, billing cadence, cancel path).
Status: `FAIL`
Evidence: Paywall footer only includes links without explicit disclosure text at `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SubscriptionView.swift:716`
Required action: Add explicit subscription disclosure text in paywall UI.

### G) Content Safety and Moderation (Guidelines 1.1, 1.2)

23. Server-side moderation pipeline exists.
Status: `PASS`
Evidence: `/Users/ao/Documents/projects/porizo/src/services/content-filter.js:325`
Required action: Keep reviewer notes explicit about moderation limits/behavior.

24. User-facing abuse reporting path for shared/user-generated content.
Status: `NEEDS-VERIFY`
Evidence: No clear in-app report-abuse action found in current audited surfaces.
Required action: Add report mechanism or document why 1.2 does not apply for this release scope.

## Pre-Submit Action List (Ordered)

1. Fix legal URL mismatch (Item 6) and retest every in-app legal link.
2. Remove/implement placeholders and debug surfaces (Items 1, 2, 3).
3. Resolve device-family mismatch (Item 10) and update App Store screenshot plan.
4. Reconcile privacy manifest and policy with actual data handling (Items 16, 17, 19).
5. Add explicit subscription legal disclosure copy to paywall (Item 22).
6. Fix lint failures in `src/server.js` and rerun quality gates (Item 5).

## Required Re-Run Before Pressing Submit

1. `npm run lint`
2. `npm test`
3. `xcodebuild -project /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,id=<simulator-id>' test`
4. Manual click-through on legal/support/deletion/subscription flows in a Release-config TestFlight build.
