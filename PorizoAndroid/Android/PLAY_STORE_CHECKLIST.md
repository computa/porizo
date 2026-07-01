# Porizo Android Play Store Checklist

## Identity

- Application ID: `com.porizo.app`
- Display name: `Porizo`
- Default production API: `https://api.porizo.co`
- App Link host: `porizo.app`

## Release Signing

- Generate a release keystore outside Git.
- Copy `app/keystore.properties.example` to `app/keystore.properties`.
- Replace all passwords and verify `app/keystore.properties` and `app/keystore.jks` remain ignored.
- Build a release APK/AAB only after signing values are configured.

## Store Readiness

- Launcher icon and adaptive icon layers are tracked for the internal Android build.
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
- Run physical-device smoke tests before uploading an internal testing build.

## Internal Testing Gate

- `:app:assembleDebug` succeeds.
- `aapt dump badging` reports package `com.porizo.app`, label `Porizo`, and version `0.1.0`.
- `:app:assembleRelease` and `:app:bundleRelease` succeed on a signing-configured machine.
- ADB lists the physical phone as `device`, not `unauthorized` or empty.
- Smoke test auth, secure token persistence across restart, create draft recovery,
  render auto-polling, app-link claim routing, share claim errors, billing receipt
  error handling, OneSignal token registration, Play Billing subscription sync,
  voice enrollment recording/upload/complete, and Settings readiness states.
