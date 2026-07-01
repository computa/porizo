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

- Add final launcher icons and adaptive icon layers.
- Add Play Billing package configuration after billing adapter integration.
- Add FCM or OneSignal Android configuration after push adapter integration.
- Verify App Links after `assetlinks.json` includes the Android signing certificate fingerprint.
- Run physical-device smoke tests before uploading an internal testing build.
