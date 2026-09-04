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

## U5 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:feature:auth` and `:feature:onboarding`. |
| `PorizoAndroid/Android/gradle/libs.versions.toml` | native-owned | Added lifecycle ViewModel support for feature state owners. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now wires native feature modules and exposes the backend base URL through typed `BuildConfig`. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/di/**` | native-owned | Native Hilt graph provides the data graph and auth repository to feature ViewModels. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/MainActivity.kt` | native-owned | Activity owns the native `AuthViewModel` and passes it into Compose. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/AppRoot.kt` | native-owned | Root now gates first launch through native onboarding and shows native auth when account actions require it. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/navigation/**` | native-owned | Settings exposes sign-in/sign-out account actions against native auth state. |
| `PorizoAndroid/Android/core/ui/src/main/kotlin/com/porizo/core/ui/PorizoComponents.kt` | native-owned | Shared UI components now include enabled-state buttons and a reusable native text field. |
| `PorizoAndroid/Android/feature/auth/**` | native-owned | Native phone-auth state machine, Hilt ViewModel, and Compose sign-in/profile completion screens. |
| `PorizoAndroid/Android/feature/onboarding/**` | native-owned | Native onboarding graph ViewModel and Compose screen built from the domain onboarding engine. |

U5 parity gate passed with `:feature:auth:assembleDebug`, `:feature:onboarding:assembleDebug`, and `:app:assembleDebug` on 2026-07-04. Runtime smoke reinstalled the APK on `emulator-5554`, cleared app data, launched `com.porizo.app/.MainActivity`, confirmed the native onboarding screen was focused without a fatal logcat event, captured `/private/tmp/porizo-u5-onboarding-smoke.png`, and validated the Android accessibility hierarchy exposed large clickable onboarding choices.

## U6 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:core:media` and `:feature:library`. |
| `PorizoAndroid/Android/gradle/libs.versions.toml` | native-owned | Added Media3 and coroutines dependencies for native playback and state streaming. |
| `PorizoAndroid/Android/core/media/**` | native-owned | Native Media3 playback engine, streaming URL/header policy, app-scoped player state, seek/toggle/clear controls, and progress polling. |
| `PorizoAndroid/Android/feature/library/**` | native-owned | Native Songs and Poems feature module with repository-backed ViewModels, filters, signed-out states, poem detail, mini-player, and now-playing sheet. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/di/**` | native-owned | App graph now provides `LibraryRepository` and singleton native player without exposing datastore internals. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/PlayerViewModel.kt` | native-owned | Activity-scoped Hilt ViewModel carries the shared player without Activity field injection. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/navigation/**` | native-owned | Songs/Poems tabs now render native library screens and show the persistent mini-player above bottom navigation. |
| `PorizoAndroid/Android/core/data/src/main/kotlin/com/porizo/core/data/PorizoDataGraph.kt` | native-owned | Added a narrow access-token accessor for streaming headers, preserving the `:core:data` to `:core:datastore` boundary. |

U6 parity gate passed with `:core:media:assembleDebug`, `:feature:library:assembleDebug`, and `:app:assembleDebug` on 2026-07-04. Runtime smoke reinstalled the APK on `emulator-5554`, cleared app data, launched `com.porizo.app/.MainActivity`, skipped onboarding via discovered accessibility bounds, opened the Songs tab via discovered tab bounds, confirmed the app process remained focused, captured `/private/tmp/porizo-u6-songs-smoke.png`, and verified the signed-out library CTA rendered natively.

## U7 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:feature:claim`. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now depends on native claim UI and state. |
| `PorizoAndroid/Android/app/src/main/AndroidManifest.xml` | native-owned | Custom scheme coverage now includes `porizo://s`, `porizo://share`, `porizo://play`, and `porizo://poem` alongside existing HTTPS links. |
| `PorizoAndroid/Android/feature/claim/**` | native-owned | Native claim ViewModel and sheet for track shares, poem shares, receiver handoffs, PIN entry, preview playback, claim retry after device-token auth errors, and graceful failure states. |
| `PorizoAndroid/Android/core/share/**` | native-owned | Native Android share sheet, SMS, and clipboard dispatcher backed by the existing `ShareLogic` message/channel decisions. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/di/**` | native-owned | App graph now provides `ShareRepository` to the claim feature. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/navigation/**` | native-owned | Incoming share, poem-share, and receiver-handoff routes now open native claim UI instead of placeholder route notices. |

U7 claim/deep-link gate passed with `:feature:claim:assembleDebug` and `:app:assembleDebug` on 2026-07-04. Runtime smoke reinstalled the APK on `emulator-5554`, launched `porizo://share/u7-smoke-fixed` through Android's VIEW intent, confirmed the native claim sheet opened and handled the fake share id with `Share token not found.`, verified the app process remained focused, and captured `/private/tmp/porizo-u7-claim-smoke.png`. U7 share-dispatch gate passed with `:core:share:assembleDebug` and `:app:assembleDebug`; the dispatcher is ready for U8 create/reveal share generation.

## U8 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:feature:create`. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now depends on native create UI and state. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/MainActivity.kt` | native-owned | Activity owns the native `CreateViewModel` beside auth, claim, library, and player state owners. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/AppRoot.kt` | native-owned | Root passes create state into the main navigation shell. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/di/**` | native-owned | App graph now provides create/render repositories and the native Android share dispatcher to create flow state. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/navigation/**` | native-owned | Home tab now renders the native create flow instead of placeholder cards. |
| `PorizoAndroid/Android/core/model/src/main/kotlin/com/porizo/core/model/CreateModels.kt` | native-owned | Create drafts now preserve recipient phone and song/poem content type. |
| `PorizoAndroid/Android/core/datastore/src/main/kotlin/com/porizo/core/datastore/LocalStores.kt` | native-owned | Native create draft storage persists phone and content type behind the data layer. |
| `PorizoAndroid/Android/core/domain/src/main/kotlin/com/porizo/core/domain/repository/RepositoryContracts.kt` | native-owned | `CreateRepository` owns draft load/save/clear so feature code does not reach into Android storage directly. |
| `PorizoAndroid/Android/core/data/src/main/kotlin/com/porizo/core/data/**` | native-owned | Native create repository now composes backend story endpoints with draft persistence; data graph wires create/render repositories. |
| `PorizoAndroid/Android/feature/create/**` | native-owned | Native create state machine and Compose UI for name, details, story conversation, lyrics review, preview render, reveal playback, send, and protected share-link generation. |

U8 parity gate passed with `:feature:create:assembleDebug` and `:app:assembleDebug` on 2026-07-04. Runtime smoke reinstalled the APK on `emulator-5554`, cleared app data, launched `com.porizo.app/.MainActivity`, skipped onboarding through discovered accessibility bounds, entered `Sarah`, advanced to the signed-out details step, confirmed compact type/occasion controls plus the visible `Sign in to create` CTA, verified the app process remained focused without `AndroidRuntime` fatal logs, and saved the final hierarchy at `/private/tmp/porizo-u8-final-details.xml`.

## U9 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/settings.gradle.kts` | native-owned | Added `:core:platform` as the native Activity-bound SDK module and `:feature:settings` for billing, push, and voice enrollment controls. |
| `PorizoAndroid/Android/gradle/libs.versions.toml` | native-owned | Pinned Play Billing 9.1.0, Credential Manager 1.7.0-alpha02, Google ID 1.2.0, and OneSignal 5.9.5. |
| `PorizoAndroid/Android/app/build.gradle.kts` | native-owned | App now depends on native platform/settings modules and exposes Google, OneSignal, and Play product config through typed BuildConfig values. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/MainActivity.kt` | native-owned | Activity publishes its foreground instance through a narrow `ActivityHolder` and emits a resume signal for push-tap consumption. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/AppRoot.kt` | native-owned | Root threads the settings state owner into navigation. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/di/**` | native-owned | App graph now exposes billing, push, voice-enrollment repositories, Google OAuth config, and settings platform config through Hilt. |
| `PorizoAndroid/Android/app/src/main/kotlin/com/porizo/app/navigation/**` | native-owned | Settings tab now delegates to `:feature:settings`; pending push tap routes are consumed on resume and route to Songs notices. |
| `PorizoAndroid/Android/core/platform/**` | native-owned | Native platform foundation for Credential Manager Google sign-in, Play Billing, OneSignal push/tap routing, and WAV voice recording. |
| `PorizoAndroid/Android/feature/auth/**` | native-owned | Google sign-in now uses Credential Manager ID tokens, `/auth/social`, and the backend link-confirmation retry contract. |
| `PorizoAndroid/Android/feature/settings/**` | native-owned | Native settings feature wires Play Billing catalog/purchase/restore/receipt sync, OneSignal registration/logout, push-tap consumption, and WAV voice-enrollment recording/upload/profile completion. |

U9 platform-foundation gate passed with `:core:platform:assembleDebug` and `:app:assembleDebug` on 2026-07-04. U9 Google-auth gate passed with `:feature:auth:assembleDebug` and `:app:assembleDebug` on 2026-07-04. U9 settings/platform-services gate passed with `:feature:settings:assembleDebug` and `:app:assembleDebug` on 2026-07-04. Existing repo-wide AGP/Kotlin migration warnings remain; these slices do not add Kotlin source warnings.

## U10 Changes

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Android/app/proguard-rules.pro` | native-owned | Removed Skip/JNA bridge keep rules and kept only native Retrofit/Moshi metadata required for the minified release build. |
| `PorizoAndroid/Android/app/src/main/AndroidManifest.xml` | native-owned | Release manifest disables Android backup for auth/device-state safety and declares microphone hardware optional while retaining runtime recording permission. |
| `PorizoAndroid/Android/PLAY_STORE_CHECKLIST.md` | native-owned | Records production identity, fallback-vs-upload signing expectations, generated artifact paths, and external Play/OneSignal/App Links setup gates. |

U10 release-packaging gate passed with `:app:assembleRelease`, `:app:bundleRelease`, and `aapt dump badging` on 2026-07-04. The APK reports package `com.porizo.app`, versionCode `1`, versionName `0.1.0`, label `Porizo`, minSdk `28`, and targetSdk `36`.

## U11 Final Deletion

| Path | Status | Notes |
|---|---|---|
| `PorizoAndroid/Package.swift` | deleted | Native Gradle project is the Android source of truth. |
| `PorizoAndroid/Package.resolved` | deleted | Local untracked resolver file removed from disk; no tracked package resolver remains. |
| `PorizoAndroid/Skip.env` | deleted | App identity, version, API, signing, OAuth, OneSignal, and Play product config now live in native Gradle/BuildConfig/release docs. |
| `PorizoAndroid/Darwin/**` | deleted | Xcode shell removed from the Android app tree. |
| `PorizoAndroid/Project.xcworkspace/**` | deleted | Workspace shell removed from the Android app tree. |
| `PorizoAndroid/Sources/PorizoSkipSpike/**` | deleted | SwiftUI-compatible source and Kotlin bridge shims replaced by native Kotlin modules across U2-U10. |
| `PorizoAndroid/Tests/PorizoSkipSpikeTests/**` | deleted | Swift parity tests removed after native domain/data/feature/build gates replaced the active Android verification surface. |
| `PorizoAndroid/README.md` | native-owned | Rewritten as a native Kotlin/Compose Android README with module map, Android Studio workflow, CLI checks, release identity, and runtime integration surface. |

U11 final gate passed with `testDebugUnitTest`, `:app:assembleDebug`, `:app:assembleRelease`, and `:app:bundleRelease` on 2026-07-04. Source audit found no active build/runtime references outside this historical inventory; the only live app reference to "Skip" is the onboarding button label.

U11 intentionally preserves this inventory as historical migration evidence. Remaining source-control references to "Skip" should either be in this document or be product text such as the onboarding "Skip" button, not active build/runtime dependencies.
