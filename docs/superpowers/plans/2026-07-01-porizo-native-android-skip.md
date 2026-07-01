# Porizo Native Android Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing ignored Skip spike into a tracked production Android app for Porizo, then port the core SwiftUI product surfaces and backend contracts until the app can be built, installed, and validated on a physical Android phone.

**Architecture:** Keep the existing iOS SwiftUI app as the canonical product reference. Create a tracked Skip app at `PorizoAndroid/` that compiles SwiftUI-compatible views through Skip/Fuse for Android. Shared contracts should be explicit in Android-facing models and services instead of copying iOS-only UIKit, StoreKit, Keychain, OneSignal, or AVFoundation code into the Skip target. Platform-specific pieces live behind small adapters: device identity/storage, push, billing, audio recording/playback, and Android signing/release config.

**Tech Stack:** Swift, SwiftUI-compatible Skip/Fuse UI, Gradle Android application plugin, Kotlin/Compose escape hatches for Android-only capability gaps, Porizo backend HTTP API, Android App Links, Play Billing, FCM or OneSignal Android push, Android keystore signing.

---

## Current Findings

- The only Android app today is `spikes/skip-fuse-spike/`, and the root `.gitignore` ignores that entire directory.
- The spike builds an APK, but it identifies as `com.porizo.skipfusespike` / `PorizoSkipSpike`.
- The spike UI is fixture-only and intentionally says there are no backend calls.
- Existing iOS code has production contracts for auth, create flow, share/claim, billing, push, and storage, but much of it is iOS-only and must be adapted, not blindly copied.
- A physical Android phone is not visible to ADB as of 2026-07-01 09:55 AWST, so install validation is blocked until USB debugging/authorization is fixed and rechecked.
- Android Studio should open `PorizoAndroid/Android` directly. Skip documentation says custom Kotlin/Java files belong under `Sources/<ModuleName>/Skip`, while generated `.build` sources must be treated as disposable output.
- The app is only ready for a meaningful physical-phone test when auth/device-token storage, render polling, native-adapter readiness, provider configuration gates, and App Link routes are visible and testable in the app.

## Adversarial Review

- Risk: Renaming the Skip Swift module directly can break Skip-generated bridges and generated Android entrypoints.
  - Resolution: Keep the internal Swift module stable for the first production slice, but move it to a tracked project and set production Android application ID, package namespace, label, app links, permissions, and version metadata.
- Risk: Copying iOS `APIClient` wholesale will import UIKit/Keychain/iOS-specific assumptions and produce an unmaintainable Android fork.
  - Resolution: Build Android-facing contract services that match backend endpoints and introduce platform adapters only where needed.
- Risk: Implementing every backend/product surface in one pass will create another patchwork port.
  - Resolution: Use vertical slices: identity/build, shell/screens, auth+device token, share/claim, create/storage, billing, push/release.
- Risk: The ignored spike can hide changes from Git.
  - Resolution: No production work remains only under `spikes/skip-fuse-spike/`; production source lives under `PorizoAndroid/`.
- Risk: Store signing secrets must not enter Git.
  - Resolution: Commit signing templates/docs only; keep `keystore.jks` and `keystore.properties` ignored.

## Parallel Execution Lanes

- Lane A, Android platform/release: project promotion, package identity, manifest, permissions, icons, signing template, Gradle release build.
- Lane B, Product screens: port core SwiftUI shell, recipient claim, create flow, songs, poems, settings into Skip-compatible views.
- Lane C, Backend contracts: Android API client, auth/session storage, device token, share/claim, create/render status, billing, push token registration.
- Lane D, QA/review: build checks, APK/AAB inspection, physical-device install, smoke flows, architecture docs.

## Implementation Tasks

### Slice 1: Production Project Identity

- [x] Create tracked production Skip project at `PorizoAndroid/` from the current spike source, excluding build artifacts.
- [x] Update `PorizoAndroid/Skip.env` with production Android identifiers:
  - `PRODUCT_BUNDLE_IDENTIFIER = com.porizo.app`
  - `ANDROID_APPLICATION_ID = com.porizo.app`
  - `ANDROID_PACKAGE_NAME` remains bridge-stable until the dedicated module/package rename slice
  - `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` set for the first Android internal build.
- [x] Keep the internal Swift module and Skip package name stable until a separate bridge-safe rename is validated.
- [x] Update Android manifest label to `Porizo`, app links for `https://porizo.app/s/` and receiver handoff paths, and production permissions.
- [x] Add Android release signing template/docs without committing secrets.
- [x] Add a tracked adaptive launcher icon so APK metadata does not report a blank app icon.
- [x] Build `:app:assembleDebug` and inspect APK package metadata.

### Slice 2: Android App Shell and Skip-Compatible Screens

- [x] Replace spike copy with production copy and navigation labels.
- [x] Port app shell tabs from iOS `MainTabView.swift` into Android-compatible equivalents:
  - Home/create entry
  - Songs
  - Poems
  - Recipient claim
  - Settings
- [x] Preserve product constraints in UI state:
  - user-voice output
  - share-once device claim
  - app-only saving
  - auditability
- [x] Keep non-Skip-compatible iOS UI behind Android-safe adapters or fixtures until implemented.

### Slice 3: Backend Auth and Session Storage

- [x] Add Android API config with `https://api.porizo.co` default and debug override support.
- [x] Add Android HTTP client infrastructure with JSON encoding/decoding and API error envelope handling.
- [x] Implement phone auth endpoints from `APIClient+Auth.swift`.
- [x] Add local session adapter for Android MVP, with a follow-up to bridge Android Keystore.
- [x] Add full auth state view model and settings account surface.

### Slice 4: Share, Claim, and App Links

- [x] Implement device ID and device token registration for Android.
- [x] Implement `GET /share/:shareId`, `POST /share/:shareId/claim`, receiver handoff resolution, receiver claim, and claimed stream URL retrieval.
- [x] Use platform value `android` in all claim/stream calls.
- [x] Parse Android App Link intents into share/receiver claim state.
- [ ] Validate share-once behavior against backend contract tests or smoke calls.

### Slice 5: Create Flow, Storage, and Render Status

- [x] Port create form state into a Skip-compatible view model.
- [x] Implement create endpoint and library read endpoints used by the Android shell.
- [x] Implement render/version/status endpoints used by iOS tracks API.
- [x] Add local draft storage and pending-create recovery.
- [x] Add render polling state with retry/backoff and explicit failure surfaces.
  - Manual polling, bounded automatic retry/backoff, pending-job recovery, and terminal/still-running states are implemented.
- [x] Keep audio upload/recording behind a platform adapter until Android recording is fully implemented.

### Slice 6: Billing and Push

- [x] Define Android billing adapter boundary for Play Billing purchase tokens.
- [x] Integrate backend Google billing validation endpoint without StoreKit assumptions.
- [x] Add Android push token registration boundary for FCM or OneSignal Android.
- [x] Document provider choice and required environment/config values.
- [x] Add in-app readiness states for Play Billing, push provider, recording/STT, secure token storage, App Links, and Android Studio phone QA so physical-device testing does not depend on tribal knowledge.

### Slice 6b: Secure Android Session Storage

- [x] Add an Android-native secure string store backed by Android Keystore AES/GCM and SharedPreferences ciphertext, using a Kotlin file under `PorizoAndroid/Sources/PorizoSkipSpike/Skip/`.
- [x] Bridge secure get/set/remove helpers through `#if SKIP` so compiled Swift can call them without editing generated `.build` output.
- [x] Move auth session JSON and device JWT storage from direct `UserDefaults` writes to the secure adapter.
- [x] Migrate any legacy `UserDefaults` auth/device token values into secure storage on first read, then remove the legacy copies.
- [x] Keep non-secret local recovery state, such as create drafts and pending render jobs, in `UserDefaults`.

### Slice 7: Icons, Release Build, Play Store Config

- [x] Add production Android launcher icon assets.
- [x] Add release signing template and `keystore.properties.example`.
- [x] Produce `assembleRelease` and app bundle build for validation.
  - Play upload still requires a real release keystore and matching App Links `assetlinks.json` fingerprint.
- [x] Add Play Store metadata/config checklist.
- [x] Document build/install/release commands.

### Slice 8: Android Studio and Physical Phone QA

- [ ] Open `PorizoAndroid/Android` in Android Studio and confirm Gradle sync succeeds with the bundled JDK.
- [ ] Select the connected physical phone in Android Studio and run the `app` debug variant.
- [ ] Confirm ADB sees the physical phone with `adb devices -l`. Current result on 2026-07-01: no devices listed, so install is blocked until USB debugging/authorization is fixed.
- [ ] Install the debug APK with `adb install -r -g`.
- [ ] Launch the app and smoke test:
  - app opens as Porizo
  - app link routes to recipient claim
  - auth surface loads
  - create form persists state
  - preview/full render starts and auto-polling reaches a terminal or explicit still-running state
  - settings shows native-adapter readiness for secure storage, recording/STT, push, billing, App Links, and release signing
  - share/claim handles success and error envelopes
- [ ] Record unresolved device, billing, push, and release blockers.

### Slice 9: Native Provider Completion Before Store Release

- [ ] Choose and configure the Android push provider:
  - FCM path requires Firebase app registration, `google-services.json`, Gradle plugin wiring, runtime notification permission flow, and backend token registration.
  - OneSignal path requires app ID configuration, SDK Gradle dependency, runtime permission flow, and backend token registration.
- [ ] Implement Play Billing purchase-token acquisition:
  - Add Google Play Billing dependency.
  - Query configured products.
  - Launch purchase flow.
  - Send purchase token and subscription ID to `/billing/receipt/google`.
  - Refresh `/billing/entitlements`.
- [ ] Implement recording/STT native adapter:
  - Request microphone permission from the create flow.
  - Record and persist a temporary audio sample.
  - Hand recorded audio to the backend-supported upload/STT path once that endpoint is confirmed for Android.
- [ ] Configure release signing with a real keystore and publish `assetlinks.json` for the Play-signing fingerprint before Play upload.

## Validation Commands

Run from `PorizoAndroid/Android`:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/ao/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/ao/Library/Android/sdk" \
GRADLE_USER_HOME="/private/tmp/porizo-gradle-cache" \
PATH="/Users/ao/Library/Android/sdk/platform-tools:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
gradle :app:assembleDebug
```

Release APK/AAB validation:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/ao/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/ao/Library/Android/sdk" \
GRADLE_USER_HOME="/private/tmp/porizo-gradle-cache" \
PATH="/Users/ao/Library/Android/sdk/platform-tools:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
gradle :app:assembleRelease :app:bundleRelease
```

Inspect APK:

```bash
/Users/ao/Library/Android/sdk/build-tools/36.0.0/aapt dump badging PorizoAndroid/.build/Android/app/outputs/apk/debug/app-debug.apk
```

Install when a phone is authorized:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb devices -l
/Users/ao/Library/Android/sdk/platform-tools/adb install -r -g PorizoAndroid/.build/Android/app/outputs/apk/debug/app-debug.apk
```

## Definition of Done

- `PorizoAndroid/` is tracked source, not an ignored spike.
- Debug APK builds with production package identity.
- Production app shell no longer uses spike naming or fixture-only claims in primary copy.
- Backend integration slices are implemented behind maintainable adapters.
- Android signing/release docs are present and secrets are ignored.
- Physical-device install and smoke test are completed once ADB sees the phone.
