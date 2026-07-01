# Porizo Android

This is the tracked production Android app for Porizo, built with [Skip](https://skip.dev)
from SwiftUI-compatible source.


<!-- TODO: add iOS screenshots to fastlane metadata
## iPhone Screenshots

<img alt="iPhone Screenshot" src="Darwin/fastlane/screenshots/en-US/1_en-US.png" style="width: 18%" /> <img alt="iPhone Screenshot" src="Darwin/fastlane/screenshots/en-US/2_en-US.png" style="width: 18%" /> <img alt="iPhone Screenshot" src="Darwin/fastlane/screenshots/en-US/3_en-US.png" style="width: 18%" /> <img alt="iPhone Screenshot" src="Darwin/fastlane/screenshots/en-US/4_en-US.png" style="width: 18%" /> <img alt="iPhone Screenshot" src="Darwin/fastlane/screenshots/en-US/5_en-US.png" style="width: 18%" />
-->

<!-- TODO: add Android screenshots to fastlane metadata
## Android Screenshots

<img alt="Android Screenshot" src="Android/fastlane/metadata/android/en-US/images/phoneScreenshots/1_en-US.png" style="width: 18%" /> <img alt="Android Screenshot" src="Android/fastlane/metadata/android/en-US/images/phoneScreenshots/2_en-US.png" style="width: 18%" /> <img alt="Android Screenshot" src="Android/fastlane/metadata/android/en-US/images/phoneScreenshots/3_en-US.png" style="width: 18%" /> <img alt="Android Screenshot" src="Android/fastlane/metadata/android/en-US/images/phoneScreenshots/4_en-US.png" style="width: 18%" /> <img alt="Android Screenshot" src="Android/fastlane/metadata/android/en-US/images/phoneScreenshots/5_en-US.png" style="width: 18%" />
-->

## Building

This project is both a stand-alone Swift Package Manager module,
as well as an Xcode project that builds and translates the project
into a Kotlin Gradle project for Android using the skipstone plugin.

## Running

Xcode and Android Studio must be downloaded and installed in order to
run the app in the iOS simulator / Android emulator.
An Android emulator must already be running, which can be launched from
Android Studio's Device Manager.

The project can be opened and run in Xcode from
`Project.xcworkspace`, which also enables parallel development of Skip library
dependencies.

To run both the Swift and Kotlin apps simultaneously,
launch the Skip app target from Xcode.
A build phases runs the "Launch Android APK" script that
will deploy the Skip app to a running Android emulator or connected device.
Logging output for the iOS app can be viewed in the Xcode console, and in
Android Studio's logcat tab for the transpiled Kotlin app, or
using `adb logcat` from a terminal.

## Testing

The module can be tested using the standard `swift test` command
or by running the test target for the macOS destination in Xcode,
which will run the Swift tests as well as the transpiled
Kotlin JUnit tests in the Robolectric Android simulation environment.

Parity testing can be performed with `skip test`,
which will output a table of the test results for both platforms.

## Android CLI Build

From `PorizoAndroid/Android`:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/ao/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/ao/Library/Android/sdk" \
GRADLE_USER_HOME="/private/tmp/porizo-gradle-cache" \
PATH="/Users/ao/Library/Android/sdk/platform-tools:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
gradle :app:assembleDebug
```

The production Android application ID is `com.porizo.app`.

To inspect the generated debug APK:

```bash
/Users/ao/Library/Android/sdk/build-tools/36.0.0/aapt dump badging \
  PorizoAndroid/.build/Android/app/outputs/apk/debug/app-debug.apk
```

To install on a physical phone once USB debugging is enabled and the device is
authorized:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb devices -l
/Users/ao/Library/Android/sdk/platform-tools/adb install -r -g \
  PorizoAndroid/.build/Android/app/outputs/apk/debug/app-debug.apk
```

Release validation uses the same environment:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="/Users/ao/Library/Android/sdk" \
ANDROID_SDK_ROOT="/Users/ao/Library/Android/sdk" \
GRADLE_USER_HOME="/private/tmp/porizo-gradle-cache" \
PATH="/Users/ao/Library/Android/sdk/platform-tools:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
gradle :app:assembleRelease :app:bundleRelease
```

## Signing

Release signing reads `Android/app/keystore.properties` when present. That file
and `Android/app/keystore.jks` are intentionally ignored. Start from
`Android/app/keystore.properties.example` when configuring a release machine.
Without that file, release validation may build with the local fallback signing
configured for development, but the artifact is not Play Store uploadable.

## Android Integration Surface

- App Links are delivered by `MainActivity` into `PorizoSkipSpikeAppDelegate.onOpenURL`,
  then consumed by SwiftUI to open share, receiver-handoff, or poem routes.
- Phone auth, device registration, share/claim, create, render status, billing,
  and push-token registration are implemented through `AndroidAPIClient`.
- Local create drafts and pending render jobs use `UserDefaults` as an MVP Android
  store. Auth/device tokens should move behind an Android Keystore adapter before
  production rollout.
- Recording/STT and real push-provider SDK integration remain native adapter work;
  the current app keeps those boundaries explicit instead of copying iOS-only APIs.
