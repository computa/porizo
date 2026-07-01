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

## Signing

Release signing reads `Android/app/keystore.properties` when present. That file
and `Android/app/keystore.jks` are intentionally ignored. Start from
`Android/app/keystore.properties.example` when configuring a release machine.
