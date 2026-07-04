# Porizo Android Internal Testing Config

This file is the checked-in Play Console setup reference for the native Android
app. It is not a substitute for Play Console configuration; use it to keep the
first internal-testing upload consistent and auditable.

## App Identity

- Package name: `com.porizo.app`
- App name: `Porizo`
- Version code: `1`
- Version name: `0.1.0`
- Category: Music & Audio
- Default language: English (United States)
- Privacy policy URL: `https://porizo.app/privacy`

## Listing Copy

- Short description: `Create personal songs and poems for the people who matter.`
- Full description:
  `Porizo helps you create personal songs and poems for birthdays, thank-yous,
  anniversaries, and private gifts. Answer a few guided prompts, review the
  story, render the gift, and share it through protected app links. Your songs,
  poems, claims, and playback stay tied to your Porizo account.`

## Store Assets

- Launcher icon source: `app/src/main/res/mipmap-*/ic_launcher*.png`
- Adaptive icon source: `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Required before upload: current 512x512 Play icon, feature graphic, phone
  screenshots for Create, Songs, Poems, Claim, and Settings.
- Do not use stale microphone-era Android marketing art for the Play icon.

## Products

Subscriptions configured in Android code:

- `com.porizo.plus_monthly`
- `com.porizo.plus_annual`
- `com.porizo.pro_monthly`
- `com.porizo.pro_annual`

One-time gift products are wired to the backend Google consumable receipt
endpoint; Play Console products and real purchase QA are still required:

- `com.porizo.gift_token_oneoff`
- `com.porizo.gift_bundle_1`
- `com.porizo.gift_bundle_3`
- `com.porizo.gift_bundle_5`

## Data Safety Surfaces

Declare collection/processing for:

- Account identifiers and authentication state.
- Recipient names, gift prompts, song and poem content.
- Audio recordings when users explicitly start voice enrollment.
- Purchase tokens for subscription receipt validation.
- Push notification tokens and OneSignal subscription identifiers.
- Crash/build/device diagnostics required by Google Play services, OneSignal,
  Play Billing, and Android platform libraries.

## Upload Gate

Before promoting an internal-testing build:

- Real release keystore is configured in `app/keystore.properties`.
- `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`
  does not report `CN=Android Debug`.
- `release/assetlinks.json.example` has been replaced with the Play App Signing
  SHA-256 fingerprint and published at
  `https://porizo.co/.well-known/assetlinks.json`,
  `https://www.porizo.co/.well-known/assetlinks.json`, and any fallback share
  host still enabled in the manifest.
- Play Console products above exist and match backend product configuration.
- OneSignal Android/FCM credentials are configured.
- Physical-device smoke test covers auth, create/render, library playback,
  app-link claim, push token registration, subscription sync, and voice
  enrollment recording/upload.
