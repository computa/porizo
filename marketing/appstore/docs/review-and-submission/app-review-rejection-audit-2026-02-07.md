# App Review Rejection Audit (Web-Researched, Code-Mapped)

Generated: 2026-02-07 (post-fix refresh)  
Scope: iOS app (`PorizoApp`) + server/legal artifacts that affect Apple App Review outcomes.

## 1) Apple Rejection Reasons (Comprehensive, Current)

Primary sources used:
- App Review Guidelines (Safety, Performance, Business, Design, Legal): https://developer.apple.com/app-store/review/guidelines/
- App Review process and common issues: https://developer.apple.com/distribute/app-review/
- Common submission mistakes (Apple): https://developer.apple.com/news/?id=33cpm46r
- Privacy manifests / required reason API troubleshooting (TN3181): https://developer.apple.com/documentation/technotes/tn3181-debugging-invalid-privacy-manifest

Most common rejection vectors to actively guard against:
1. Incomplete app experiences, placeholder UI, or non-functional features (Guideline 2.1).
2. Crashes, severe bugs, or unstable behavior on reviewer devices (Guideline 2.1).
3. Misleading or inaccurate metadata, screenshots, or feature claims (Guideline 2.3).
4. Broken links in legal/support/marketing fields (Guideline 2.3).
5. Subscriptions/paywalls without required clarity (renewal, billing cadence, cancellation, restore) (Guideline 3.1.2).
6. Payments that bypass Apple IAP where IAP is required (Guideline 3.1.1).
7. Sparse, low-value, template/spam-like apps or copycats (Guideline 4.3).
8. UGC surfaces without moderation safeguards (report/block/filter/contact path) (Guideline 1.2).
9. Harmful/offensive content or weak content controls (Guideline 1.1).
10. Missing account deletion flow for account-based apps (Guideline 5.1.1(v)).
11. Privacy disclosure mismatch between app behavior and App Store privacy answers (Guideline 5.1.1).
12. Tracking without proper ATT flow/permission consistency (Guideline 5.1.2).
13. Invalid privacy manifest declarations (invalid API reasons, invalid categories) (TN3181).
14. Missing or unusable reviewer access path for gated/login features (App Review process).
15. Device/compatibility mismatches (claims vs actual support/behavior) (Guideline 2.4).
16. IP/copyright/legal rights gaps in generated or user-shared content (Guideline 5.2).
17. Abuse of background modes or permissions that are not clearly user-benefiting (Guidelines 2.5 / 5.1).
18. Poor responsiveness/performance in core user flow (Apple common issue callout).

Note: Apple reports that more than 40% of unresolved issues occur in “App Completeness” and “Performance” areas.

## 2) Current Codebase Audit Against Those Reasons

### Quality Gates (Re-run Today)

- `npm run lint` -> pass
- `npm test` -> pass (`153` tests, `104` passed, `49` skipped, `0` failed)
- `xcodebuild -project /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' test` -> pass (`103` executed, `2` skipped, `0` failed, `** TEST SUCCEEDED **`)
- `xcodebuild -project /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Release -destination 'generic/platform=iOS' archive -archivePath /tmp/PorizoApp-2026-02-07-post-blocker-fixes.xcarchive` -> pass (`** ARCHIVE SUCCEEDED **`)

### Engineer Feedback Delta (2026-02-07): Status

Resolved:
1. NSMicrophoneUsageDescription is explicit and purpose-specific.
   - `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:23`
   - `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj/project.pbxproj:478`
2. ATS localhost exception is Debug-only and absent in Release.
   - `/Users/ao/Documents/projects/porizo/PorizoApp/Info.Debug.plist:27`
   - `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:1`
   - `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj/project.pbxproj:477`
3. Deployment target/capability contradiction is removed (`armv7` no longer declared).
   - `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj/project.pbxproj:455`
   - `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:1`
4. App Review demo account is explicitly documented.
   - `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:267`
   - `/Users/ao/Documents/projects/porizo/docs/testflight-demo-account.md:7`

Partially external/manual:
5. StoreKit restore now has automated backend proof, but real sandbox run capture is still an operational task.
   - Restore entry points: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SubscriptionView.swift:391`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:469`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/StoreKitManager.swift:308`
   - Restore API: `/Users/ao/Documents/projects/porizo/src/server.js:4987`
   - Automated restore tests: `/Users/ao/Documents/projects/porizo/test/workflows/billing-restore-path.test.js:53`

### Previously Open Blockers: Status

Closed:
1. Privacy device identifier mismatch.
   - Policy now reflects app-scoped identifier: `/Users/ao/Documents/projects/porizo/public/legal/privacy.html:121`
   - Implementation is app-scoped keychain ID (`ios_<uuid>`): `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/RootView.swift:232`
2. Privacy retention mismatch.
   - Policy now states 7-year audit retention: `/Users/ao/Documents/projects/porizo/public/legal/privacy.html:247`
   - Audit metadata uses 7-year retention: `/Users/ao/Documents/projects/porizo/src/services/gdpr-audit-service.js:48`
3. App privacy disclosure under-declaration.
   - Manifest now declares expanded data categories: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:13`
   - App Store privacy questionnaire mapping documented: `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:224`
4. Metadata mismatch on “download” claims.
   - Updated to save/share wording: `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:34`, `/Users/ao/Documents/projects/porizo/docs/appstore/description.md:35`
5. Missing visible abuse-reporting path for shared content.
   - Added report actions in shared views: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/ShareClaimView.swift:170`, `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SharedPoemView.swift:278`
   - Added abuse contact in support page: `/Users/ao/Documents/projects/porizo/public/support.html:81`

## 3) Residual Risk and Rejection Likelihood

No remaining code/documentation blockers likely to trigger immediate rejection were found in this pass.

Remaining practical risk is operational:
1. No captured real sandbox purchase+restore evidence attached yet for reviewer context.
2. Demo account validity must be confirmed at submission time.

Non-blocking technical debt:
1. Archive emits existing Swift warnings (including Swift 6 migration warnings).
2. Archive emits existing run-script/app-icon warnings.

## 4) Submission Verdict

Current verdict: **READY TO SUBMIT (code/build/document alignment)**.

Required before pressing Submit for Review:
1. Run one real StoreKit sandbox purchase + restore flow in TestFlight and include the evidence in App Review notes.
2. Validate demo account credentials on the submission day.
