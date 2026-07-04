# Porizo Android Play Store Checklist

## Identity

- Application ID: `com.porizo.app`
- Display name: `Porizo`
- Default production API: `https://api.porizo.co`
- App Link hosts: `porizo.co`, `www.porizo.co`; legacy fallback `porizo.app`

## Release Signing

- Generate a release keystore outside Git.
- Copy `app/keystore.properties.example` to `app/keystore.properties`.
- Replace all passwords and verify `app/keystore.properties` and `app/keystore.jks` remain ignored.
- Confirm Git ignores release signing files:
  `git check-ignore -v PorizoAndroid/Android/app/keystore.properties PorizoAndroid/Android/app/keystore.jks`.
- Build a Play-uploadable release APK/AAB only after signing values are configured.
- The local fallback release signing path is for compile/package verification only; do not upload fallback-signed artifacts.

## Store Readiness

- Launcher icon and adaptive icon layers are tracked for the internal Android build.
- Play listing/internal-testing setup is tracked in `play-store/internal-testing-config.md`.
- Release builds disable Android backup so auth/device state is not restored onto
  a different install.
- Microphone hardware is declared optional; voice enrollment still requests
  runtime microphone permission when the user records samples.
- Auth sessions and device JWTs use Android Keystore-backed encrypted storage on
  Android, with legacy local token migration.
- Settings exposes native readiness states for secure storage, voice enrollment recording,
  push, Play Billing, App Links, and release signing before phone QA.
- Play Billing 9.1 is wired for subscription product query, purchase launch,
  active-purchase token lookup, backend `POST /billing/receipt/google` sync, and
  entitlement refresh. Real purchases still need Play Console products and a
  store-signed/internal-testing install.
- Android gift-bundle purchases still need a backend Google consumable receipt
  endpoint before gift wallet credit can match the iOS Apple consumable path.
- OneSignal Android is wired as the first push-provider path. Real push delivery
  still requires Android/FCM credentials in the OneSignal dashboard.
- Backend Google validation requires `GOOGLE_PLAY_PACKAGE_NAME` and service-account
  credentials in the backend environment.
- Voice enrollment is wired with Android microphone permission, WAV prompt
  recording, presigned upload, chunk notification, completion, and profile status
  checks. Physical-device QA must still verify real microphone behavior.
- Verify App Links after `assetlinks.json` includes the Android signing certificate fingerprint.
- Start from `release/assetlinks.json.example`; replace the placeholder with the Play App Signing SHA-256 fingerprint and publish the same body at `https://porizo.co/.well-known/assetlinks.json`, `https://www.porizo.co/.well-known/assetlinks.json`, and any fallback share host still enabled in the manifest.
- Run physical-device smoke tests before uploading an internal testing build.

## Internal Testing Gate

- `:app:assembleDebug` succeeds.
- `aapt dump badging` reports package `com.porizo.app`, label `Porizo`, versionCode `1`, and versionName `0.1.0`.
- `:app:assembleRelease` and `:app:bundleRelease` succeed on a signing-configured machine.
- ADB lists the physical phone as `device`, not `unauthorized` or empty.
- Smoke test auth, secure token persistence across restart, create draft recovery,
  render auto-polling, app-link claim routing, share claim errors, billing receipt
  error handling, OneSignal token registration, Play Billing subscription sync,
  voice enrollment recording/upload/complete, and Settings readiness states.

## 2026-07-04 Native Release Verification Baseline

This was the last known release-packaging baseline before the U1-U10 parity
fix pass. Rerun the release gate after the current parity changes before any
internal-testing upload.

- `gradle :app:assembleRelease :app:bundleRelease` succeeded with R8/resource shrinking enabled.
- Generated APK: `app/build/outputs/apk/release/app-release.apk` (`6.6M`).
- Generated AAB: `app/build/outputs/bundle/release/app-release.aab` (`8.1M`).
- `/Users/ao/Library/Android/sdk/build-tools/37.0.0/aapt dump badging app/build/outputs/apk/release/app-release.apk`
  reported `com.porizo.app`, versionCode `1`, versionName `0.1.0`, label `Porizo`,
  minSdk `28`, and targetSdk `36`.
- Remaining external release setup: real upload keystore, Play Console products,
  OneSignal Android/FCM credentials, backend Google Play service account, and
  `assetlinks.json` for the final Play-signing certificate fingerprint.
