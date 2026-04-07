# App Store Review Audit — 2026-04-07

## Verdict: GO

Both blockers resolved. Ready for submission.

## Blockers (0 — 2 resolved)

| # | Category | Issue | Status | Resolution |
|---|----------|-------|--------|------------|
| 1 | G | **SubscriptionViewV2 missing auto-renewal disclosure.** | FIXED | Added `subscriptionDisclosure` view with auto-renewal text, Apple ID charge language, Terms/Privacy links, Manage Subscription button. |
| 2 | A | **User-visible "coming soon" toast in Release build.** | FIXED | Replaced toast with no-op closure `{}`, matching MySongsView and TrackPlayerFullView patterns. |

## Warnings (7)

| # | Category | Issue | File:Line | Fix |
|---|----------|-------|-----------|-----|
| 1 | J | **Listing screenshot `02-explore-home.png` has 144 DPI.** All other listing screenshots are 72 DPI JPEG; this one is 144 DPI PNG with alpha. | `docs/appstore/subscription-screenshots/listing/02-explore-home.png` | Re-export at 72 DPI as JPEG. `sips -s dpiWidth 72 -s dpiHeight 72 -s format jpeg <file>` |
| 2 | J | **All iPhone and iPad screenshots have `hasAlpha: yes`.** Apple technically accepts PNGs with alpha if the background is opaque, but this has caused rejections. | `docs/appstore/iphone-screenshots/` and `ipad-screenshots/` | Flatten all screenshots: `sips -s hasAlpha no <file>` or convert to JPEG. |
| 3 | M | **Consumable IAP review screenshots may be incomplete in ASC.** Four consumable products exist but only one screenshot on disk. | `docs/appstore/screenshots/gift-bundle-picker.png` | Verify each consumable product in ASC has a review screenshot uploaded. |
| 4 | A | **Accessibility hints say "Coming soon" on search and notification buttons.** Apple reviewers may use VoiceOver and hear this. | `PorizoApp/PorizoApp/Tabs/ExploreTabView.swift:102,113` | Change to describe button action (e.g., "Search songs"). |
| 5 | D | **Terms of Service references "Google Play Store."** Porizo is iOS-only, Apple may question this. | `public/legal/terms.html:149,155` | Update to "Apple App Store" only. |
| 6 | F | **Demo account credentials need ASC verification.** Listed in description.md but must be entered in ASC Review Information. | `docs/appstore/description.md:286-287` | Verify credentials in ASC > App Review Information > Sign-In Information. |
| 7 | B | **Privacy manifest declares SystemBootTime but no direct code usage.** May conflict with SDK manifests. | `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:155-157` | Verify Firebase/Amplitude SDKs bundle their own manifest for this API. |

## Quality Gates

| Gate | Result | Details |
|------|--------|---------|
| npm test | PASS | 336 passed, 0 failed, 7 skipped |
| Xcode build (Release) | PASS | BUILD SUCCEEDED |
| ASC: EULA configured | PASS | Full text present |
| ASC: Version state | PASS | 1.5 in PREPARE_FOR_SUBMISSION |
| Legal URLs | PASS | privacy (200), terms (200) on porizo.co |
| Screenshots | WARNING | 1 file at 144 DPI, alpha channels on all PNGs |

## Pre-Submit Action List (Ordered by rejection risk)

1. **[BLOCKER]** Add subscription disclosure text to SubscriptionViewV2
2. **[BLOCKER]** Remove or implement "Save to Photos coming soon" toast
3. **[WARNING]** Fix listing screenshot DPI and flatten alpha channels
4. **[WARNING]** Verify consumable IAP review screenshots in ASC
5. **[WARNING]** Change "Coming soon" accessibility hints
6. **[WARNING]** Verify demo account credentials in ASC Review Information
7. **[WARNING]** Remove "Google Play Store" reference from Terms
8. **[WARNING]** Verify SystemBootTime privacy manifest entry
