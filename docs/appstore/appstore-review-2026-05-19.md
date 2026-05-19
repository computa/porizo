# App Store Review Audit — 2026-05-19

**Build under audit:** 122 (1.5.12) — archive at `build/PorizoApp.xcarchive`, Release config, arm64
**App ID:** 6758205028 | **Bundle:** `porizo.ios.app.PorizoApp` | **iOS target:** 17.0 | **Devices:** Universal (1,2)
**Prior audit:** `appstore-review-2026-04-16.md` (build 96 / 1.5.4)

## Verdict: GO

Binary is clean. ASC EULA configured. IAP products all APPROVED. Screenshots valid. The only iOS-side change since 2026-04-16 is one new SwiftUI component (`BlurBackdropArtwork.swift`) that uses AsyncImage only — no new permissions, no new API surfaces, no privacy-manifest impact. Backend artwork pipeline (Flux/Replicate) is out of Apple's review scope.

**TestFlight upload of build 122 authorized.**

---

## Blockers (0)

None.

## Warnings (1)

| # | Category | Issue | File:Line | Fix |
|---|----------|-------|-----------|-----|
| W1 | A | `BlurBackdropArtwork.swift` is defined but not yet wired into any view body — orphan code in shipped binary | `PorizoApp/PorizoApp/Components/BlurBackdropArtwork.swift:9` | Not a rejection risk (private struct, no user-visible surface). Either wire it into the Reveal flow before next submission or accept as forward-staging code. Apple does not reject dead Swift types. |

## Info (4)

| # | Category | Note | File:Line |
|---|----------|------|-----------|
| I1 | I | Backend `npm run lint` reports 1 minor `no-regex-spaces` error in a test file — irrelevant to App Store review | `test/web-player-motion-helpers.test.js:131` |
| I2 | B | `NSPrivacyTracking=true` with tracking domains (Facebook/Google/Apple Ads). Same posture as 4/16 audit — ATT prompt is required before any tracking domain is contacted | `PrivacyInfo.xcprivacy:5-16`, `PorizoAppApp.swift:387` |
| I3 | L | Version 1.5.12 not yet created in ASC. Will be auto-created when build 122 is attached after TestFlight processing | n/a |
| I4 | H | UGC flag in ASC still declared as `false` from prior audit. Open lyrics input could expose UGC reviewer pushback. Carry-over from 2026-04-16 I4 — not blocking | n/a |

## Pre-Submit Action List (ordered by rejection risk)

1. **None blocking.** Upload to TestFlight now.
2. After TestFlight processing: create version 1.5.12 in ASC, attach build 122, set "What's New" text (current placeholder in repo metadata: `"App improvements"` — consider replacing with a real changelog summary about the artwork redesign before submitting to App Store review).
3. Optional: revisit UGC=false declaration (I4 carry-over).

## Quality Gates

| Gate | Result | Details |
|------|--------|---------|
| `npm run lint` | FAIL (non-blocking) | 1 error in `test/web-player-motion-helpers.test.js:131` (regex-spaces). Backend-only — not in iOS binary |
| `xcodebuild build -configuration Release` | **PASS** | `** BUILD SUCCEEDED **`, 2 cache hits / 54 tasks |
| `xcodebuild archive` (build 122) | **PASS** | Archive at `build/PorizoApp.xcarchive`, CFBundleVersion=122, CFBundleShortVersionString=1.5.12 |
| ASC: EULA configured | **PASS** | Custom EULA `b741bf8c-5cb9-47d6-9be9-db2ee8cdca7d` (~8.4KB, Feb 4 2026 revision) |
| ASC: IAP products ready | **PASS** | 4 of 4 consumables state=APPROVED (`gift_bundle_1`, `gift_bundle_3`, `gift_bundle_5`, `gift_token_oneoff`) |
| ASC: Screenshots valid | **PASS** | iPhone 6.9": 5 × 1320×2868, 72 DPI, no alpha, PNG. iPad 12.9": 5 × 2048×2732, 72 DPI, no alpha, PNG |
| Privacy manifest currency | **PASS** | 11 data types + 3 accessed-API reasons declared. New `BlurBackdropArtwork` adds nothing — AsyncImage only |
| Legal URLs reachable | **PASS** | privacy=200, terms=200, support=200 (HTTP→HTTPS redirect resolved) |
| ATT / SIWA / Restore / Delete Account in code | **PASS** | All present and rendered in view bodies |
| Sub auto-renew disclosure rendered | **PASS** | `SubscriptionViewV2.swift:404` renders `subscriptionDisclosureText` |

## Submission Completeness Checklist

| Check | Status | Notes |
|-------|--------|-------|
| App version submittable | **N/A** | 1.5.12 not yet created — created automatically after TF build attach |
| All IAP products "Ready" | **YES** | 4/4 APPROVED |
| IAP review screenshots | **NOT BLOCKING** | All products are APPROVED state from prior reviews; new builds inherit |
| EULA configured in ASC | **YES** | Custom Porizo EULA active |
| iPhone screenshots ready | **YES** | 6.9" set complete (5 PNGs) |
| iPad screenshots ready | **YES** | iPad 12.9" set complete (5 PNGs); 6.1/6.3/6.5 also present as fallback |
| Screenshots dimensions valid | **YES** | All 1320×2868 (iPhone 6.9") or 2048×2732 (iPad 12.9"), 72 DPI |
| Screenshots no alpha/PNG/RGB | **YES** | Verified via `sips` |
| Demo account in review notes | **CARRY-OVER** | Set in prior submissions; verify still present when creating 1.5.12 |
| Privacy/Terms/Support URLs 200 | **YES** | All 3 return 200 after HTTPS redirect |
| Build uploaded and processed | **PENDING** | Action item: upload build 122 after this audit passes |
| No placeholder in description | **YES** | Live 1.5.11 desc is clean; 1.5.12 metadata in repo matches |

## Regression Scan (Session Δ since 2026-04-16)

### iOS-touching commits since 4/16

- `64ed1cd feat(ios): BlurBackdropArtwork SwiftUI component` — new file, 63 lines
- `1a9f178 chore(ios): bump build to 122 for TestFlight upload` — version bump only

### What changed in iOS binary

| File | Change | Privacy / Entitlement Impact |
|------|--------|------------------------------|
| `PorizoApp/PorizoApp/Components/BlurBackdropArtwork.swift` | NEW (63 lines) | None. Uses `AsyncImage`, `Color`, `ProgressView`, `.blur`, `.overlay` only |
| `PorizoApp/PorizoApp.xcodeproj/project.pbxproj` | 4× `CURRENT_PROJECT_VERSION` 121→122 | None |

### Files verified UNCHANGED since 4/16 audit

- `PrivacyInfo.xcprivacy` — same 11 data types + 3 API reasons + 7 tracking domains
- `PorizoApp.entitlements` — applesignin, aps-environment=production, app-groups, associated-domains
- `PorizoNotificationServiceExtension.entitlements`
- `Info.plist` (root + extension) — same usage strings, background modes, SKAdNetworkItems
- `marketing/appstore/metadata/version/1.5.12/en-US.json` — same description/keywords

### Backend changes (out of Apple review scope)

- Replicate Flux 1.1 Pro Ultra image generation (`src/llm/adapters/flux-image.js`) — `dataHandling.containsPII=false`, recipient names are NEVER sent to Flux
- Haiku 4.5 lyrics→vars extractor (`src/llm/adapters/anthropic-haiku.js`) — bounded vocabulary, no PII
- 75 photoreal library images committed at `storage/artwork-library/v2/` — server-side asset, not bundled in iOS app

**Conclusion: zero new privacy/entitlement surface area from this session.**

## Verification Log

| Check | Method | Evidence |
|-------|--------|----------|
| BlurBackdropArtwork has no permission APIs | Grep + Read full file | No `requestAuthorization`, no `PHPhotoLibrary`, no `UNUserNotificationCenter`, no `ATTrackingManager` — only `AsyncImage` / SwiftUI primitives |
| BlurBackdropArtwork not yet wired into view body | Grep for callers | Only references are its own `struct` + `#Preview` — no production view uses it yet |
| Privacy manifest unchanged | Read `PrivacyInfo.xcprivacy` and compare against 4/16 audit declaration of "11 data types + 3 API reasons" | Verified identical content |
| Archive build number matches pbxproj | `PlistBuddy` on `xcarchive/Info.plist` and `.app/Info.plist` | Both report 122 / 1.5.12 |
| Screenshot specs | `sips -g pixelWidth -g pixelHeight -g dpiWidth -g hasAlpha -g format` on all 10 PNGs | iPhone 6.9": 1320×2868, iPad: 2048×2732, all 72 DPI, hasAlpha=no, format=png |
| ASC EULA exists | `asc eula list --app 6758205028` | Returns `endUserLicenseAgreements` record with ~8.4KB `agreementText` |
| IAP states | `asc iap list --app 6758205028` | All 4 products `state=APPROVED` |
| Legal URLs | `curl -sI -L` with redirect-follow | privacy=200, terms=200, support=200 |
| Release build succeeds | `xcodebuild build ... -configuration Release` | `** BUILD SUCCEEDED **` |
| Subscription disclosure rendered | Read SubscriptionViewV2.swift line 404 | `Text(subscriptionDisclosureText)` in view body, references property at line 439 |
| Restore Purchases button rendered | Grep "Restore Purchases" Text() | Found in `SettingsTabView.swift:710` and `SubscriptionViewV2.swift:305,413` |
| Delete Account UI present | Grep "Delete Account" | Two-step flow in `AccountManagementView.swift:83-566` |

## Sources

- Prior audit `appstore-review-2026-04-16.md` — carry-over baseline
- Apple TN3181 (Privacy Manifests) — unchanged manifest verified compliant
- Apple Guideline 2.3.3 (Accurate Metadata) — screenshots validated per device-class dims

