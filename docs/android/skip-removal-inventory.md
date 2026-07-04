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

## U2 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:core:model` and `:core:domain` modules. |
| `PorizoAndroid/Android/build.gradle.kts` | native-owned | Added Android library plugin availability for native core modules. |
| `PorizoAndroid/Android/gradle/libs.versions.toml` | native-owned | Added Android library plugin and Kotlin test dependencies. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now depends on native core model/domain modules. |
| `PorizoAndroid/Android/core/model/**` | native-owned | Native value types for auth, create/story, onboarding, library, share/claim, render, billing, and voice enrollment. |
| `PorizoAndroid/Android/core/domain/**` | native-owned | Native repository contracts plus pure auth, share/claim, story, onboarding, library, deep-link, and render decisions. |

U2 parity gate passed with `:core:domain:testDebugUnitTest` and `:app:assembleDebug` on 2026-07-04. The equivalent Swift/Skip files remain as references until downstream data/UI/platform slices are complete, because the Skip package still compiles against them.

## U3 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:core:network`, `:core:datastore`, and `:core:data` native modules. |
| `PorizoAndroid/Android/gradle/libs.versions.toml` | native-owned | Added Retrofit, OkHttp, and Moshi dependencies for native backend contracts. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now depends on the native data graph. |
| `PorizoAndroid/Android/core/model/**` | native-owned | Added create-flow request/result models used by native repositories. |
| `PorizoAndroid/Android/core/domain/**` | native-owned | Repository contracts now include native create, render, library, share, billing, push, and voice-enrollment data seams. |
| `PorizoAndroid/Android/core/network/**` | native-owned | Native Retrofit service, DTOs, mappers, authenticated header interceptor, and error-envelope mapper. |
| `PorizoAndroid/Android/core/datastore/**` | native-owned | Native Android Keystore-backed secure string store plus session, device-token, draft, and render-poll stores. |
| `PorizoAndroid/Android/core/data/**` | native-owned | Native repository implementations and app data graph behind the domain contracts. |

U3 parity gate passed with `:core:domain:testDebugUnitTest`, `:core:data:assembleDebug`, and `:app:assembleDebug` on 2026-07-04. `AndroidAPIClient.swift`, `AndroidAPIModels.swift`, `AndroidSecureStore.swift`, and `AndroidLocalStores.swift` now have native counterparts, but they remain retained references until the UI/feature slices wire these repositories through runtime flows and U11 performs final Skip deletion.

## U4 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:core:ui` for reusable Compose tokens, typography, and components. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now depends on native UI primitives instead of owning reusable design resources. |
| `PorizoAndroid/Android/core/ui/**` | native-owned | Native Warm Canvas theme, Fraunces typography, cards, buttons, bottom navigation primitives, and migrated font resources. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/AppRoot.kt` | native-owned | Replaced placeholder shell with the native themed app root. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/navigation/**` | native-owned | Native Home/Songs/Poems/Settings navigation shell; Claim remains a deep-link flow, not a tab. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/MainActivity.kt` | native-owned | App links are parsed through the native domain deep-link parser and passed into Compose state. |
| `PorizoAndroid/Android/app/src/main/res/font/*.ttf` | deleted | Fonts moved to `:core:ui` so feature modules can share typography without depending on `:app`. |

U4 parity gate passed with `:core:ui:assembleDebug` and `:app:assembleDebug` on 2026-07-04. Runtime smoke installed `app-debug.apk` on `emulator-5554`, launched `com.porizo.app/.MainActivity`, confirmed the app window was focused, and captured `/private/tmp/porizo-u4-smoke.png`.

## Retained Reference: Swift and Skip Package

| Path | Status | Delete Gate |
|---|---|---|
| `PorizoAndroid/Package.swift` | retain-reference | U11 after U2-U10 parity gates pass. |
| `PorizoAndroid/Package.resolved` | retain-reference | U11 after U2-U10 parity gates pass. |
| `PorizoAndroid/Skip.env` | retain-reference | U10 migrates app id/version/signing knowledge, then U11 deletes. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAPIClient.swift` | retain-reference | Native network/data parity exists; keep for U5-U8 flow wiring audits, then delete in U11. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAPIModels.swift` | retain-reference | Native model/DTO parity exists; keep for U5-U8 flow wiring audits, then delete in U11. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidAppConfig.swift` | retain-reference | Native data graph owns base URL wiring; keep for U5-U10 config/signing audits, then delete in U11. |
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
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidSecureStore.swift` | retain-reference | Native Keystore-backed secure storage exists; keep until feature runtime coverage, then delete in U11. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AndroidLocalStores.swift` | retain-reference | Native draft/render/local stores exist; keep until feature runtime coverage, then delete in U11. |
| `PorizoAndroid/Sources/PorizoSkipSpike/AuthLogic.swift` | migrate-or-delete | U2 auth logic tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ClaimLogic.swift` | migrate-or-delete | U2/U7 claim logic tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/PoemClaimLogic.swift` | migrate-or-delete | U2/U7 poem claim tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ShareLogic.swift` | migrate-or-delete | U2/U7 share logic tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/SongLibrary.swift` | migrate-or-delete | U2/U6 library tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/PoemLibrary.swift` | migrate-or-delete | U2/U6 poem library tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/StoryEngine.swift` | migrate-or-delete | U2/U8 story tests ported. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ViewModel.swift` | candidate-delete | U5-U8 ViewModel ports complete. |
| `PorizoAndroid/Sources/PorizoSkipSpike/ContentView.swift` | candidate-delete | U4-U10 native screens complete. |
| `PorizoAndroid/Sources/PorizoSkipSpike/DesignTokens.swift` | retain-reference | Native UI token parity exists; keep for feature screen parity audits, then delete in U11. |
| `PorizoAndroid/Sources/PorizoSkipSpike/FrauncesTitle.swift` | retain-reference | Native Fraunces typography exists in `:core:ui`; keep for feature screen parity audits, then delete in U11. |
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
