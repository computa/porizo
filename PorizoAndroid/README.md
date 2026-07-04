# Porizo Android

Porizo Android is a native Kotlin/Jetpack Compose app. Open and build the
Gradle project at `PorizoAndroid/Android`.

## Project Layout

- `Android/app`: application shell, Hilt composition root, app navigation,
  release identity, signing, icons, and manifest.
- `Android/core/model`: shared domain models.
- `Android/core/domain`: pure use cases, repository contracts, and decision
  logic.
- `Android/core/network`: Retrofit/Moshi API surface for the Porizo backend.
- `Android/core/datastore`: encrypted and local persistence.
- `Android/core/data`: repository implementations that compose network and
  local stores.
- `Android/core/media`: playback support.
- `Android/core/platform`: Android SDK integrations for Google sign-in, Play
  Billing, OneSignal push routing, Activity access, and WAV recording.
- `Android/core/share`: SMS/share-sheet/clipboard dispatch.
- `Android/core/ui`: design tokens, typography, reusable Compose components,
  and accessibility helpers.
- `Android/feature/*`: feature-owned UI and ViewModels for auth, onboarding,
  library, claim, create, and settings.

## Android Studio

1. Open `PorizoAndroid/Android`.
2. Let Gradle sync complete.
3. Select the `app` run configuration.
4. Select a running emulator or USB-authorized physical phone.
5. Run the `debug` variant.

The production application ID is `com.porizo.app`. Debug builds default to
`https://api.porizo.co`; Settings includes a debug API-base override for staging
or tunneled backend testing.

## CLI Build

From `PorizoAndroid/Android`:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/ao/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/ao/Library/Android/sdk" \
PATH="/Users/ao/Library/Android/sdk/platform-tools:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
gradle :app:assembleDebug
```

Install the debug APK on an authorized phone:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb devices -l
/Users/ao/Library/Android/sdk/platform-tools/adb install -r -g \
  app/build/outputs/apk/debug/app-debug.apk
```

## Verification

Run focused checks from `PorizoAndroid/Android`:

```bash
gradle :core:domain:testDebugUnitTest
gradle :feature:create:assembleDebug :feature:settings:assembleDebug
gradle :app:assembleDebug
```

Run release packaging checks:

```bash
gradle :app:assembleRelease :app:bundleRelease
/Users/ao/Library/Android/sdk/build-tools/37.0.0/aapt dump badging \
  app/build/outputs/apk/release/app-release.apk
```

Expected release identity:

- Package: `com.porizo.app`
- Label: `Porizo`
- Version code: `1`
- Version name: `0.1.0`
- Min SDK: `28`
- Target SDK: `36`

## Release Signing

Release signing reads `Android/app/keystore.properties` when present. That file
and `Android/app/keystore.jks` are intentionally ignored.

Start from `Android/app/keystore.properties.example` on a release machine. The
fallback signing path exists only to verify release compilation locally; do not
upload fallback-signed artifacts to Play Console.

## Runtime Integration Surface

- App Links and custom `porizo://` links enter through `MainActivity` and route
  into native navigation for share, receiver handoff, poem, and playback flows.
- Phone auth, device registration, share/claim, create, render status, billing,
  push registration, and voice enrollment are backed by native repositories.
- Google sign-in uses Android Credential Manager and the backend social-login
  link-confirmation contract.
- OneSignal initializes from native settings/platform code, maps the signed-in
  Porizo user as the external ID, requests notification permission, registers
  the push token, and consumes tapped routes on resume.
- Play Billing 9.1 queries products, launches purchases, restores active
  purchases, and syncs Google receipt tokens with the backend entitlement path.
- Voice enrollment records WAV prompt chunks, uploads them to presigned URLs,
  notifies chunk completion, completes enrollment, and refreshes profile status.
- Auth session JSON and device JWTs use Android Keystore-backed encrypted
  storage. Drafts and recoverable render state use local stores behind
  repositories.

## Store Checklist

Use `Android/PLAY_STORE_CHECKLIST.md` before internal testing or Play upload.
External release blockers remain: real upload keystore, Play Console products,
OneSignal Android/FCM credentials, backend Google Play service-account
configuration, App Links `assetlinks.json` for the final signing fingerprint,
and physical-phone smoke testing.
