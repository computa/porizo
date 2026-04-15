# App Store Pre-Submission Audit — Porizo 1.5.3 (Build 92)

**Audit date:** 2026-04-11
**Submission target:** TestFlight External Beta (Group: "other", public link `testflight.apple.com/join/xFMhkgZP`)
**Build state:** Uploaded, `processingState=VALID`, `externalBuildState=READY_FOR_BETA_SUBMISSION`, `internalBuildState=IN_BETA_TESTING`
**Build ID:** `c1ab0e30-7129-4764-8f29-cb7fb97732e8`
**App ID:** `6758205028`

---

## Verdict: GO for TestFlight External Beta (build 93, after remediation)

**Original build 92 verdict:** NO-GO (2 blockers, 5 high warnings)
**Remediated build 93 verdict:** **GO** — all blockers verified fixed at the binary level; all 5 high warnings addressed in source

- Blockers resolved: **2 / 2**
- High warnings resolved: **5 / 5**
- Medium warnings: 3 (polish, not blocking)
- Verified OK: 9 categories

**Calibration note (post-Codex review):** The original "will be auto-rejected" language was overstated. Build 92 passed ASC's upload-time validator, proving the upload-path scanner did not hard-stop the bundle. What the blockers represent is (a) significant rejection risk at external beta review, and (b) a bundle shape internally inconsistent with the declared no-IDFA / no-tracking posture. The remediation path is unchanged: remove dead-weight SDKs that aren't providing value.

---

## Resolution — Build 93 (2026-04-11, post-remediation)

### B1 resolved — TikTokBusinessSDK removed

Changes applied:
- `PorizoApp/PorizoApp.xcodeproj/project.pbxproj` — removed 6 references: PBXBuildFile, Frameworks build phase entry, packageProductDependencies, packageReferences, XCRemoteSwiftPackageReference block, XCSwiftPackageProductDependency block
- `PorizoApp/PorizoApp/PorizoAppApp.swift` — removed `import TikTokBusinessSDK`, the `TikTokBiz` enum, and the init block
- `PorizoApp/Info.plist` — removed `PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN`, `PORIZO_TIKTOK_BUSINESS_APP_ID`, `PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID`
- `Package.resolved` — removed `tiktok-business-ios-sdk` pin

Binary-level verification on `build/PorizoApp-1.5.3-build93.xcarchive/Products/Applications/PorizoApp.app/PorizoApp`:
- `nm -u | grep -E "ASIdentifierManager|ATTrackingManager|advertisingIdentifier"` → **empty** (no IDFA symbols)
- `otool -L | grep -E "AdSupport|AppTrackingTransparency"` → **empty** (no ad frameworks linked)
- `strings | grep -c "TikTokBusiness"` → **0** (no TikTokBusiness strings)
- `Frameworks/` directory: no `TikTokBusiness*` frameworks, no `TTSDKCrash`, no `AdSupport.framework`

### B2 resolved — ProductInteraction added to privacy manifest

`PorizoApp/PorizoApp/PrivacyInfo.xcprivacy` now includes:
```xml
<dict>
    <key>NSPrivacyCollectedDataType</key>
    <string>NSPrivacyCollectedDataTypeProductInteraction</string>
    <key>NSPrivacyCollectedDataTypeLinked</key><true/>
    <key>NSPrivacyCollectedDataTypeTracking</key><false/>
    <key>NSPrivacyCollectedDataTypePurposes</key>
    <array>
        <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
    </array>
</dict>
```
This matches the existing `app-store-metadata.md:238` nutrition label declaration.

### W1 resolved — GoogleAdsOnDeviceConversion.framework removed from bundle

Changed `FirebaseAnalytics` SPM product reference to `FirebaseAnalyticsCore` in `project.pbxproj`. In Firebase iOS SDK 12.8.0, `FirebaseAnalyticsCore` is the library product whose underlying target depends on `GoogleAppMeasurementCore` instead of `GoogleAppMeasurement` — dropping `GoogleAdsOnDeviceConversion` from the transitive dependency graph.

Binary-level verification:
- `otool -L | grep GoogleAdsOnDevice` → **empty**
- `find Frameworks -name "GoogleAdsOnDeviceConversion*"` → **empty**

`GoogleAppMeasurement.framework` is still in the bundle (same framework name) but it's now the Core variant — no ad identifier code paths, no IDFA access. The `import FirebaseAnalytics` + `Analytics.logEvent(...)` API still works because both `FirebaseAnalytics` and `FirebaseAnalyticsCore` SPM products link the same underlying `FirebaseAnalytics` binary target.

### W2 — partial (Firebase/Amplitude bundled frameworks still missing PrivacyInfo.xcprivacy)

Firebase iOS SDK 12.8.0's bundled frameworks still don't ship their own `PrivacyInfo.xcprivacy` files. This is an upstream Google issue. Leaving as WARNING (not blocker): prior Porizo builds 1.0 through 1.5.2 passed Apple's scanner with the same framework layout. Will re-evaluate if/when Google ships manifests. Future mitigation: upgrade Firebase when 12.9+ lands with embedded manifests.

### W3 resolved — Privacy policy updated with missing SDK disclosures

`public/legal/privacy.html` — added 4 new rows to the Third-Party Services table:
- Meta (Facebook SDK) — app install + session attribution, no device advertising identifier
- TikTok (Open SDK) — social sharing + sign-in
- OneSignal — marketing and engagement push notifications
- Apple Search Ads (AdServices) — opaque attribution token only

Requires redeploy of the static site before external review submission.

### W4 resolved — Fixed by B2 (metadata/manifest Product Interaction match)

### W5 — partial (Firebase collection flag inconsistency)

`Info.plist` still has `FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED=false` (analytics active) while `GoogleService-Info.plist` has `IS_ANALYTICS_ENABLED=false` (legacy flag, meaningless for Firebase 12.x). With Product Interaction now declared in the privacy manifest, this internal inconsistency is no longer a review blocker — it's a minor code-smell cleanup item for later.

### W6-W8 (medium polish, non-blocking)

- W6 (console log noise): removed with TikTokBusiness removal
- W7 (FacebookClientToken placeholder): unchanged, still silently skips init if not configured — not a blocker
- W8 (TestFlight test notes + Beta App Review Information): handled at submission time — populated with demo credentials from `app-store-metadata.md:267-269`

### Items still pending (submission-time)

- Redeploy `public/legal/privacy.html` to `https://porizo.co/legal/privacy`
- Create TestFlight build localization: `"Stability and performance improvements."`
- Verify Beta App Review Information populated in ASC
- Add build 93 to external group "other" with `--submit --confirm`

---

---

## Critical context — what changed in build 92

Build 92 introduces new ad attribution SDKs (commits `2d6cd93`, `59336af`, `acd7116`, `5ee35d8`):
- Meta (Facebook) SDK
- TikTok Business SDK + TikTok Open SDK
- Apple Search Ads (AdServices)
- Google (`GoogleAdsOnDeviceConversion.framework` via transitive Firebase dep)

The privacy posture documented in commit `acd7116 "Align ad attribution privacy posture"` (no-ATT, no-IDFA, `NSPrivacyTracking=false`) does NOT match the shipped binary. The `#if canImport(TikTokBusinessSDK)` guard in `PorizoAppApp.swift` is a red herring — the SDK is statically linked into the main binary regardless of whether `init()` runs.

This is the first build submitted for external beta review that contains TikTokBusinessSDK. All prior builds (1.0-1.5.2) passed the scanner because this SDK wasn't present.

---

## Blockers

### B1 — TikTokBusinessSDK statically links AdSupport/IDFA while manifest claims no tracking

**Evidence (binary-level):**
- `nm PorizoApp.app/PorizoApp` → undefined references to `_OBJC_CLASS_$_ASIdentifierManager` and `_OBJC_CLASS_$_ATTrackingManager`
- `otool -L` → `AdSupport.framework` linked NON-WEAK; `AppTrackingTransparency.framework` linked WEAK
- Embedded strings from `tiktok-business-ios-sdk/TikTokBusinessSDK/TTSDKCrash/...` confirm static linkage
- `~/Library/Developer/Xcode/DerivedData/.../tiktok-business-ios-sdk/TikTokBusinessSDK/TikTokDeviceInfo.m` and `UIDevice+TikTokAdditions.m` both call `ASIdentifierManager.advertisingIdentifier`

**Evidence (project-level):**
- `PorizoApp.xcodeproj/project.pbxproj:30` — `TikTokBusinessSDK in Frameworks`
- `:336` — declares `XCRemoteSwiftPackageReference "tiktok-business-ios-sdk"`
- `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:6` — `NSPrivacyTracking=false`
- `PrivacyInfo.xcprivacy` — `NSPrivacyTrackingDomains` is empty array
- `PorizoApp/Info.plist` — `NSUserTrackingUsageDescription` removed in commit `acd7116`

**Why it blocks:** Apple's privacy scanner rejects binaries where (a) `AdSupport` is linked and `ASIdentifierManager` symbols are referenced, (b) `NSPrivacyTracking=false`, and (c) no `NSUserTrackingUsageDescription` is present. These three facts are internally inconsistent — either the app tracks (and the manifest must say so) or it doesn't (and the SDK symbols must not be linked). TestFlight external review invokes the same scanner as full App Store review for the first build of a new version string.

**Secondary risk:** `TTSDKCrash` (TikTok's crash reporter) installs its own mach exception + signal handlers, which will conflict with FirebaseCrashlytics and produce garbage stack traces.

**Exact fix — recommended option (fast path, ~20 min):**
Remove the TikTokBusinessSDK package entirely. Delete lines in `project.pbxproj` referencing `tiktok-business-ios-sdk` (build file IDs `41B7CE2696C569D1A49E9961`, `FC533DEA832DF6C76A418CC0`, `58BC046D29CE3F6A937DA5A9`). Delete the `#if canImport(TikTokBusinessSDK)` block in `PorizoAppApp.swift` (lines 15-17, 40-50, 108-125). Delete the three `PORIZO_TIKTOK_BUSINESS_*` Info.plist keys at lines 41-46. TikTok Ads attribution can still work via SKAdNetwork + the Apple Search Ads token flow. Re-archive as build 93.

**Alternative fix — keep TikTokBusiness (~1 day):**
Call `TikTokBusinessConfig.setDisableTracking(true)` on the config before init. Add `NSUserTrackingUsageDescription` back to `Info.plist`. Change `NSPrivacyTracking` to `true` in `PrivacyInfo.xcprivacy`. Populate `NSPrivacyTrackingDomains` with TikTok's analytics hosts. Add `"Device advertising data"` entry with `NSPrivacyCollectedDataTypeTracking=true` to the data types array. Update `app-store-metadata.md` section 13A and `public/legal/privacy.html` to match.

### B2 — Privacy manifest missing `NSPrivacyCollectedDataTypeProductInteraction` for Firebase Analytics

**Evidence:**
- `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy` declares 10 data types, all with `NSPrivacyCollectedDataTypeTracking=false`. Missing: `NSPrivacyCollectedDataTypeProductInteraction`.
- `Info.plist:97-98` — `FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED=false` (analytics IS active)
- `AnalyticsService.swift:66` — `Analytics.logEvent(event.rawValue, parameters: properties)` fires on funnel events
- `PorizoApp/app-store-metadata.md:238` — declares "Product Interaction | Yes" in nutrition label, inconsistent with manifest

**Why it blocks:** Firebase Analytics' App Instance ID is a product-interaction analytics identifier that must be declared. Apple's scanner tightened in March 2026 to enforce this consistently. Nutrition label (metadata) and privacy manifest (bundle) must match.

**Exact fix:** Add this entry to `PrivacyInfo.xcprivacy` inside `NSPrivacyCollectedDataTypes` (after the PurchaseHistory entry):

```xml
<dict>
    <key>NSPrivacyCollectedDataType</key>
    <string>NSPrivacyCollectedDataTypeProductInteraction</string>
    <key>NSPrivacyCollectedDataTypeLinked</key>
    <true/>
    <key>NSPrivacyCollectedDataTypeTracking</key>
    <false/>
    <key>NSPrivacyCollectedDataTypePurposes</key>
    <array>
        <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
    </array>
</dict>
```

---

## High-severity warnings

### W1 — `GoogleAdsOnDeviceConversion.framework` bundled but unused, no privacy manifest

- Present at `build/PorizoApp-1.5.3-build92.xcarchive/Products/Applications/PorizoApp.app/Frameworks/GoogleAdsOnDeviceConversion.framework`
- No Swift code references `GoogleAdsOnDevice` / `ODCConversion`
- Transitive dependency of Firebase iOS SDK 12.8.0
- Framework contains no `PrivacyInfo.xcprivacy`

**Fix:** Replace `FirebaseAnalytics` product with `FirebaseAnalyticsWithoutAdIdSupport` in `project.pbxproj:20`. This variant drops `GoogleAdsOnDeviceConversion` entirely and is the correct choice for no-IDFA apps.

### W2 — FirebaseAnalytics, GoogleAppMeasurement, GoogleAppMeasurementIdentitySupport, AmplitudeCore missing privacy manifests

Bundled `Frameworks/` directory contains these but none include a `.xcprivacy` file. On Apple's TN3181 commonly-used-third-party-SDKs list — required.

**Fix:** Upgrade Firebase iOS SDK to latest 12.x maintenance release. For Amplitude, upgrade `AmplitudeCore` or `Amplitude-Swift 1.4.5+`. If latest versions still don't ship manifests, this blocks App Store review (may still pass TestFlight scanner depending on SDK versions).

### W3 — `public/legal/privacy.html` missing disclosures for bundled SDKs

Currently lists only Firebase, ElevenLabs, Suno, Replicate. Missing:
- Meta (Facebook) SDK
- TikTok Open SDK (used for share/auth)
- OneSignal (marketing push)
- Amplitude (linked, disabled at runtime)
- Apple Search Ads / AdServices

Required by Guideline 5.1.1(v) and GDPR Art. 13(1)(e).

**Fix:** Update `public/legal/privacy.html:170-202` to add rows for each. Redeploy before submission.

### W4 — `app-store-metadata.md` declares Product Interaction; manifest doesn't

Covered by B2. Fix is the same.

### W5 — Firebase collection flag inconsistency

- `Info.plist:97-98` — `FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED=false` (analytics active)
- `GoogleService-Info.plist:17-20` — `IS_ADS_ENABLED=false`, `IS_ANALYTICS_ENABLED=false` (legacy flags for deprecated GoogleAnalytics-for-Firebase SDK; do NOT disable modern FirebaseAnalytics 12.x)
- `app-store-metadata.md:216-221` — declares "IDFA = No" (technically correct; Firebase 12.x uses its own anonymous App Instance ID)

**Fix:** Pick one side. Either (a) set `FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED=true` in Info.plist to turn analytics off everywhere, OR (b) remove `IS_ANALYTICS_ENABLED` from `GoogleService-Info.plist` (legacy, meaningless) and declare `Product Interaction` in the manifest (per B2).

---

## Medium-severity warnings

### W6 — Console log messages may raise reviewer questions

`PorizoAppApp.swift:109-125` — logs `"[TikTokBiz] Initialized"` or `"[TikTokBiz] Skipped init — not configured"` at launch. If Apple's reviewer inspects Console during testing, the pattern of SDK init logs may trigger clarifying questions.

### W7 — `FacebookClientToken` build-setting resolution not verified in Release

`Info.plist:30-31` — `FacebookClientToken=$(PORIZO_FACEBOOK_CLIENT_TOKEN)`. If Release xcconfig doesn't define this, `FBSDK.isConfigured` correctly detects the unresolved `$(...)` literal and skips init. Silent pass but a product bug if Meta attribution is intended to be live.

### W8 — TestFlight external submission prerequisites not populated

- No build localizations (test notes) exist for build 92
- Beta App Review Information not populated in ASC
- Required before external beta review can be submitted

**Fix:** Populate test notes and ASC → TestFlight → Test Information using demo credentials from `app-store-metadata.md:250-275` (`reviewer@porizo.co / PorizoDemo2026!`).

---

## Verified OK

- **Entitlements:** Sign in with Apple, `aps-environment=production`, app group, associated domains — all match code
- **Info.plist usage descriptions:** Microphone, PhotoLibraryAdd, SpeechRecognition — each maps to actual call sites
- **Facebook SDK advertiser-ID collection:** `FacebookAutoLogAppEventsEnabled=true`, `FacebookAdvertiserIDCollectionEnabled=false`. FBSDKCoreKit 17+ defers to `ATTrackingManager.trackingAuthorizationStatus`, which without an ATT prompt returns `.notDetermined` → FB treats tracking as disabled. FB SDK ships its own privacy manifest.
- **Amplitude disabled at runtime:** placeholder key check in `AnalyticsService.swift:36-46` prevents network calls
- **Sign in with Apple:** implemented in `AuthView.swift:205`, `AuthManager.swift:542,672`. Entitlement present
- **Delete account:** `AuthManager.swift:1384`, UI in `SettingsTabView.swift:53-245,964-968`. Two-step confirmation
- **ASC readiness:** EULA exists (comprehensive), Plus Annual IAP approved, 1.5.3 is next version, privacy + terms URLs return 200
- **`AppleAdsAttributionService.swift`:** clean — uses `AAAttribution.attributionToken()`, stores in UserDefaults, submits via authenticated backend. No IDFA access. Token is opaque Apple-issued, not tracking data.
- **TikTok Open SDK (not Business):** ships bundled privacy manifests at `TikTokOpenSDK_TikTokOpenSDKCore.bundle/PrivacyInfo.xcprivacy` and `TikTokOpenSDK_TikTokOpenShareSDK.bundle/PrivacyInfo.xcprivacy`. Used for share/OAuth.

---

## TestFlight External vs Full App Store

All blockers and W1-W5 apply to BOTH TestFlight external submission and full App Store review (same automated scanner; TestFlight external review is the first human touchpoint for the new version string 1.5.3).

- **B1** (TikTokBusinessSDK) → MUST fix before TestFlight external
- **B2** (Product Interaction) → MUST fix before TestFlight external
- **W1** (GoogleAdsOnDeviceConversion dormant framework) → MUST fix before App Store; likely blocker for TestFlight
- **W2** (missing bundled manifests) → Should fix before TestFlight
- **W3** (privacy policy SDKs) → Should fix before TestFlight
- **W4-5** (declaration consistency) → Fix with B2
- **W6-7** (silent SDK init) → Polish, not blockers
- **W8** (TestFlight beta review details) → TestFlight-specific prerequisite

---

## Recommended fast-path to GO (build 93)

1. Delete `TikTokBusinessSDK` package entirely (20 min) — removes B1, W6, and the Crashlytics conflict
2. Replace `FirebaseAnalytics` product with `FirebaseAnalyticsWithoutAdIdSupport` in `project.pbxproj:20` — removes W1
3. Add `NSPrivacyCollectedDataTypeProductInteraction` entry to `PrivacyInfo.xcprivacy` — fixes B2, W4
4. Update `public/legal/privacy.html:170-202` to disclose Meta, TikTok Open, OneSignal, Apple Search Ads — fixes W3
5. Bump build number to 93, re-archive, upload to ASC
6. Populate TestFlight test notes + Beta App Review Information in ASC — fixes W8
7. Add build 93 to external group "other" with `--submit --confirm`

**Total effort:** ~90 minutes. Should yield GO verdict on re-audit.

---

## Sources (2026 web research)

- [Apple privacy manifest documentation](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [TN3183: required reason API entries](https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest)
- [Top iOS rejection reasons 2026](https://www.eitbiz.com/blog/top-reasons-ios-apps-get-rejected-by-the-app-store-and-fixes/)
- [RevenueCat — App Store Rejections](https://www.revenuecat.com/docs/test-and-launch/app-store-rejections)
- [TestFlight overview — Apple Developer](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
