# Android Skip Removal Inventory

Date: 2026-07-04

This inventory tracks every Skip-owned Android artifact while the native Kotlin app replaces it. Status meanings:

- `deleted`: removed from the active code path in this migration.
- `native-owned`: retained and now owned by the native Android app.
- `retain-reference`: keep temporarily as a behavior reference until the named native parity unit passes.
- `candidate-delete`: remove after the named parity gate passes.
- `migrate-or-delete`: inspect during the named unit, migrate useful assets/contracts, then delete the Skip source.

## U1 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Replaced Skip plugin prebuild with standard Gradle plugin/dependency management. |
| `PorizoAndroid/Android/build.gradle.kts` | native-owned | Added root native plugin declarations. |
| `PorizoAndroid/Android/gradle/libs.versions.toml` | native-owned | Added native Android version catalog based on the previously generated local Skip catalog. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | Replaced `skip-build-plugin` app build with native Android/Kotlin/Compose/Hilt build. |
| `PorizoAndroid/Android/app/src/main/kotlin/Main.kt` | deleted | Removed Skip runtime entry point, bridge delegates, and Compose wrapper. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/**` | native-owned | New native application/activity/root shell. |
| `PorizoAndroid/Android/app/src/main/AndroidManifest.xml` | native-owned | Preserved app id behavior, permissions, and deep-link filters while pointing to native classes. |

## Retained Reference: Swift and Skip Package

| Path | Status | Delete Gate |
|---|---|---|
| `PorizoAndroid/Package.swift` | retain-reference | U11 after U2-U10 parity gates pass. |
| `PorizoAndroid/Package.resolved` | retain-reference | U11 after U2-U10 parity gates pass. |
| `PorizoAndroid/Skip.env` | retain-reference | U10 migrates app id/version/signing knowledge, then U11 deletes. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAPIClient.swift` | migrate-or-delete | U3 network/data parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAPIModels.swift` | migrate-or-delete | U2 model and U3 DTO parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAppConfig.swift` | migrate-or-delete | U3 config parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAuthModel.swift` | migrate-or-delete | U5 auth parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidOnboardingModel.swift` | migrate-or-delete | U5 onboarding parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidPlayerModel.swift` | migrate-or-delete | U6 player parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAudioPlayer.swift` | migrate-or-delete | U6 Media3 parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidClaimModel.swift` | migrate-or-delete | U7 claim parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidDeepLink.swift` | migrate-or-delete | U7 deep-link parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidShare.swift` | migrate-or-delete | U7 share intent parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidCreateFlowModel.swift` | migrate-or-delete | U8 create flow parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidRenderModel.swift` | migrate-or-delete | U8 render lifecycle parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidRenderController.swift` | migrate-or-delete | U2/U8 render logic parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidNativeAdapters.swift` | migrate-or-delete | U9 platform service parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidGoogleSignIn.swift` | migrate-or-delete | U5 Google sign-in parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidPushRouting.swift` | migrate-or-delete | U9 push routing parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidSecureStore.swift` | migrate-or-delete | U3 secure storage parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidLocalStores.swift` | migrate-or-delete | U3 local persistence parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AuthLogic.swift` | migrate-or-delete | U2 auth logic tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ClaimLogic.swift` | migrate-or-delete | U2/U7 claim logic tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/PoemClaimLogic.swift` | migrate-or-delete | U2/U7 poem claim tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ShareLogic.swift` | migrate-or-delete | U2/U7 share logic tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/SongLibrary.swift` | migrate-or-delete | U2/U6 library tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/PoemLibrary.swift` | migrate-or-delete | U2/U6 poem library tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/StoryEngine.swift` | migrate-or-delete | U2/U8 story tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ViewModel.swift` | candidate-delete | U5-U8 ViewModel ports complete. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ContentView.swift` | candidate-delete | U4-U10 native screens complete. |
| `PorizoAndroid/Sources/PorizoSkipSpike/DesignTokens.swift` | migrate-or-delete | U4 core UI tokens parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/FrauncesTitle.swift` | migrate-or-delete | U4 font/title parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/HostTestShims.swift` | candidate-delete | U11 after Swift tests are gone. |
| `PorizoAndroid/Sources/PorizoSkipSpike/PorizoSkipSpikeApp.swift` | candidate-delete | U11 after native app owns launch/deep links. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Views/**` | candidate-delete | U4-U8 screen parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Resources/**` | migrate-or-delete | U4 migrates useful assets/localization. |

## Retained Reference: Skip Kotlin Bridges

| Path | Status | Delete Gate |
|---|---|---|
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativeAudioBridge.kt` | migrate-or-delete | U6 native media parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativeBillingBridge.kt` | migrate-or-delete | U9 billing parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativeGoogleSignInBridge.kt` | migrate-or-delete | U5 Google sign-in parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativePushBridge.kt` | migrate-or-delete | U9 push parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativeRecorderBridge.kt` | migrate-or-delete | U9 recorder parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativeSecureStore.kt` | migrate-or-delete | U3 secure storage parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/PorizoNativeShareBridge.kt` | migrate-or-delete | U7 share parity. |
| `PorizoAndroid/Sources/PorizoSkipSpike/Skip/skip.yml` | candidate-delete | U11 after all bridge code is migrated or deleted. |

## Retained Reference: Swift Tests

All files under `PorizoAndroid/Tests/PorizoSkipSpikeTests/**` remain `retain-reference` until their behavior is covered by Kotlin tests in U2-U8. Delete in U11 only after the native test matrix replaces them.

## Retained Reference: Darwin and Xcode Shell

| Path | Status | Delete Gate |
|---|---|---|
| `PorizoAndroid/Darwin/**` | candidate-delete | U11 after Android no longer uses the Skip package. |
| `PorizoAndroid/Project.xcworkspace/**` | candidate-delete | U11 after Android no longer uses the Skip package. |

