# App Store Rejection Fix Checklist (2026-02-24)

## Rejection Summary

Apple rejected version `1.0` under **Guideline 2.1 App Completeness** with this complaint:

- The app references **Plans** (subscription purchase surface), but associated in-app purchases were not submitted for review.
- Apple also requested an **App Review screenshot** for IAP submission.

This is a packaging/submission issue in App Store Connect, not an iOS crash/logic defect.

## Evidence in Current App

- Plans/paywall surface is user-visible:
  - `PorizoApp/PorizoApp/Tabs/SettingsTabView.swift:324` (`My Subscription`)
  - `PorizoApp/PorizoApp/SubscriptionView.swift:177` (`Plans`)
- Gift consumable purchase path is also user-visible from Home:
  - `PorizoApp/PorizoApp/Tabs/ExploreTabView.swift` (gift CTA)
  - `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift:395` (`Buy 1 Gift Token`)
- iOS product IDs used by app:
  - `com.porizo.plus_monthly`
  - `com.porizo.plus_annual`
  - `com.porizo.pro_monthly`
  - `com.porizo.pro_annual`
  - `com.porizo.gift_token_oneoff`
  - Source: `PorizoApp/PorizoApp/StoreKitManager.swift:16`

## Primary Fix Path (Recommended): Submit IAPs with the Binary

1. In App Store Connect, open all user-reachable iOS IAP products and ensure they are complete.
2. For each product, verify required metadata:
   - Localized display name
   - Localized description
   - Pricing
   - App Review screenshot (required for first submission)
   - Review notes
3. In the app version page, add these IAPs under **In-App Purchases and Subscriptions** so they are submitted together with the build.
4. Upload/select a new build and submit again.
5. Add review notes describing where reviewer can find:
   - Settings -> My Subscription -> Plans
   - Home -> Schedule and send, for them -> Buy 1 Gift Token

## Release-Safe Fallback Path: Hide Monetization Surfaces

If IAPs are not ready in ASC, disable monetization UI for the release build.

Feature flags added:

- `PORIZO_ENABLE_SUBSCRIPTIONS_UI` (default `true`)
- `PORIZO_ENABLE_GIFT_PURCHASE_UI` (default `true`)

Configured in:

- `PorizoApp/PorizoApp/AppConfig.swift`
- `PorizoApp/Info.plist`

What disabling does:

- `PORIZO_ENABLE_SUBSCRIPTIONS_UI = false`
  - Hides Settings subscription row (`My Subscription` / `Plans` entry point)
- `PORIZO_ENABLE_GIFT_PURCHASE_UI = false`
  - Hides Home gift CTA
  - Prevents gift flow presentation
  - Blocks gift token purchase inside gift flow if reached

## Pre-Submit Verification

1. Run app in Release configuration and verify:
   - If flags `true`: Plans and gift purchase are visible and functional.
   - If flags `false`: no visible path to Plans/gift purchase.
2. Confirm App Review screenshot(s) exist for each submitted IAP.
3. Confirm IAP status in ASC is compatible with submission (not missing metadata).
4. Submit app + IAPs in the same review package.
