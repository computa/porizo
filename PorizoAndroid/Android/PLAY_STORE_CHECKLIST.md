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
- Play Billing package configuration still needs real Play Console product IDs and
  a native purchase-token acquisition adapter. Backend validation is wired through
  `POST /billing/receipt/google`.
- Push provider choice is still open between direct FCM and OneSignal Android.
  The app exposes the backend boundary through `/device/register` with `push_token`;
  the provider SDK/config values must supply that token.
- Backend Google validation requires `GOOGLE_PLAY_PACKAGE_NAME` and service-account
  credentials in the backend environment.
- FCM requires `google-services.json` or equivalent build-time Firebase config if
  direct FCM is selected. OneSignal requires the Android app ID and notification
  service setup if OneSignal is selected.
- Verify App Links after `assetlinks.json` includes the Android signing certificate fingerprint.
- Run physical-device smoke tests before uploading an internal testing build.

## Internal Testing Gate

- `:app:assembleDebug` succeeds.
- `aapt dump badging` reports package `com.porizo.app`, label `Porizo`, and version `0.1.0`.
- `:app:assembleRelease` and `:app:bundleRelease` succeed on a signing-configured machine.
- ADB lists the physical phone as `device`, not `unauthorized` or empty.
- Smoke test auth, create draft recovery, app-link claim routing, share claim errors,
  billing receipt error handling, and push-token registration.
