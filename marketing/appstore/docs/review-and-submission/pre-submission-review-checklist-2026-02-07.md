# Porizo iOS Pre-Submission Review Checklist (Current)

Generated: 2026-02-07 (post-fix refresh)

## Quality Gates (Run Today)

- [x] Release archive
  - Command: `xcodebuild -project /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Release -destination 'generic/platform=iOS' archive -archivePath /tmp/PorizoApp-2026-02-07-post-blocker-fixes.xcarchive`
  - Result: `** ARCHIVE SUCCEEDED **`
- [x] Lint
  - Command: `npm run lint`
  - Result: pass
- [x] Tests
  - Command: `npm test`
  - Result: `153` tests, `104` passed, `49` skipped, `0` failed
- [x] iOS XCTest (simulator)
  - Command: `xcodebuild -project /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97' test`
  - Result: `103` executed, `2` skipped, `0` failed (`** TEST SUCCEEDED **`)

## Submission Blockers

- [x] Privacy policy device identifier statement matches implementation
  - Policy text: `/Users/ao/Documents/projects/porizo/public/legal/privacy.html:121`
  - Code path: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/RootView.swift:217`
- [x] Privacy retention statement matches implementation
  - Policy text: `/Users/ao/Documents/projects/porizo/public/legal/privacy.html:247`
  - Audit metadata: `/Users/ao/Documents/projects/porizo/src/services/gdpr-audit-service.js:48`
- [x] App privacy disclosures reconciled with runtime behavior and SDKs
  - Manifest declarations expanded: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:13`
  - App Store Connect mapping table: `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:224`
- [x] StoreKit restore path covered in automated backend tests (success + invalid receipt)
  - `/Users/ao/Documents/projects/porizo/test/workflows/billing-restore-path.test.js:53`
  - Backend restore endpoint: `/Users/ao/Documents/projects/porizo/src/server.js:4987`

## Engineer Gap Checks (Added 2026-02-07)

- [x] NSMicrophoneUsageDescription is explicit about why recording is needed
  - `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:23`
- [x] ATS localhost exception is scoped to Debug only
  - Debug plist exception: `/Users/ao/Documents/projects/porizo/PorizoApp/Info.Debug.plist:27`
  - Release plist has no localhost ATS exception: `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:1`
  - Debug target uses `Info.Debug.plist`: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj/project.pbxproj:477`
- [x] Deployment target/capability contradiction resolved (`armv7` removed)
  - Deployment target: `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp.xcodeproj/project.pbxproj:455`
  - Release plist has no legacy device capability key: `/Users/ao/Documents/projects/porizo/PorizoApp/Info.plist:1`
- [x] App Review demo account is explicitly documented for reviewer access
  - Review note credentials: `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:267`
  - Source of truth: `/Users/ao/Documents/projects/porizo/docs/testflight-demo-account.md:7`

## High Priority (Now Addressed)

- [x] App Store copy aligned to shipped save/share behavior (no download mismatch)
  - `/Users/ao/Documents/projects/porizo/PorizoApp/app-store-metadata.md:34`
  - `/Users/ao/Documents/projects/porizo/marketing/appstore/docs/review-and-submission/description.md:35`
- [x] User-facing report-abuse path added for shared UGC surfaces
  - `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/ShareClaimView.swift:170`
  - `/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/SharedPoemView.swift:278`
  - `/Users/ao/Documents/projects/porizo/public/support.html:81`

## Remaining Manual Pre-Submit Items

- [ ] Capture a real StoreKit sandbox purchase + restore run in TestFlight and attach evidence in App Review notes.
- [ ] Confirm demo account credentials are still valid on submission day.

## Cleanups (Non-Blocking)

- [ ] Remove unassigned app icon child warning (`AppIcon-old.png`).
- [ ] Burn down Swift 6 concurrency warnings shown during archive.

## Final Decision

- Current status: **READY TO SUBMIT (code and build gates)**.
- Operational caveat: complete the two manual pre-submit items above before pressing Submit for Review.
- Detailed rationale: `/Users/ao/Documents/projects/porizo/marketing/appstore/docs/review-and-submission/app-review-rejection-audit-2026-02-07.md`
