---
title: "Android Skip Gate A Findings"
date: 2026-06-30
status: gate-a-more-spike-required
source_plan: docs/plans/2026-06-30-001-feat-android-via-skip-plan.md
execution_plan: docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md
---

# Android Skip Gate A Findings

## Gate State

**Verdict:** `more spike required`

**Gate A passed:** No.

Gate A cannot release S1/S2/S4 yet. Local Skip Fuse build/export evidence is materially positive, U2 did not find a platform-research no-go, bundletool split-delivery sizing did not find a technical Play-size blocker, and the first Android emulator smoke run passed core recipient/create/settings flows. Two hard Gate A pass criteria remain unresolved:

- No physical Android device was available for the 30-minute runtime, visual/accessibility, audio, and native escape-hatch proof. The emulator run supplements evidence only; it does not satisfy the hardware gate.
- SkipStone AGPL-3.0 / generated-artifact legal signoff is still pending.

No Phase 2+ stream may start until this file contains an explicit Gate A verdict of `Skip`.

Allowed verdict values:

- `Skip`
- `Compose fallback`
- `more spike required`

## Frozen Baseline

| Field | Value |
| --- | --- |
| Branch | `refactor` |
| Baseline commit for Android execution | `d952cc2a3ae890635245adc5e332bb4f0a6fc5ee` |
| Baseline commit summary | `docs: add Android Skip parallel execution plan` |
| Source plan | `docs/plans/2026-06-30-001-feat-android-via-skip-plan.md` |
| Parallel execution plan | `docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md` |
| Architecture refactor policy | Freeze architecture-shaping refactors while Gate A and Gate B are open. S2 remains single-writer for `project.pbxproj`, `Package.swift`, and module moves. |

## Local Toolchain Readiness

| Check | Result | Evidence |
| --- | --- | --- |
| Skip CLI | Pass | `skip version` -> `Skip version 1.9.4` |
| Skip doctor | Pass outside the workspace sandbox | `skip doctor` passed with Skip 1.9.4, Swift 6.3.2, Xcode 26.5, Gradle 9.6.1, Java 26.0.1, ADB 1.0.41, Android SDK 37.0.0. The sandboxed run produced false negatives from native-cache/sysctl restrictions. |
| Stable Xcode lane | Pass | `xcodebuild -version` -> Xcode 26.5, build 17F42. |
| Android devices | Partial: emulator smoke pass; physical hardware still blocked | Initial `adb devices -l`, `skip devices`, and Argent `list-devices` found no Android targets. Android Studio was launched, Android SDK command-line tools were installed to `/Users/ao/Library/Android/sdk/cmdline-tools/latest`, the API 36 Google Play arm64 system image was installed, and AVD `Porizo_GateA_API36` was created. Argent still cannot see Android because its MCP server lacks `ANDROID_HOME`/`adb` on PATH, so runtime smoke used `adb` fallback against `emulator-5554`. No physical Android device is attached. |
| U1 debug export | Pass | `skip export --debug --android --no-ios` completed in 414.05s. Reported APK/AAB/source zip: 217.3 MB / 65.5 MB / 22.6 MB. Disk sizes: 207M / 63M / 22M. |
| U1 release export | Pass | `skip export --release --android --no-ios` completed in 212.47s. Reported APK/AAB/source zip: 364.8 MB / 125.9 MB / 22.6 MB. Disk sizes: 348M / 120M / 22M. |
| U1 split-delivery size | Pass for spike; repeat for real build | Bundletool 1.18.3 estimated installable compressed download size at 4.75-43.12 MB across generated splits. Modern arm64 phone spec: 43.12 MB. Older 32-bit spec: 42.24 MB. |

## Runtime Availability Retest

Follow-up check on 2026-06-30:

| Check | Result |
| --- | --- |
| Argent device discovery | `list-devices` still returns no Android devices/AVDs because the MCP server does not have `ANDROID_HOME`/`adb` on PATH. Argent remains usable for iOS only until its Android SDK path is configured or the server is restarted with the right environment. |
| ADB attached devices | Before emulator setup, `/Users/ao/Library/Android/sdk/platform-tools/adb devices -l` returned only the header. After AVD boot, it returned `emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64`. |
| ADB version | ADB 1.0.41, version 37.0.0-14910828. |
| Emulator package | Installed by Android Studio/SDK Manager: Android Emulator 36.6.11. |
| SDK contents | Installed packages now include `emulator` 36.6.11, `platform-tools` 37.0.0, `platforms;android-36`, `platforms;android-36.1`, and `system-images;android-36;google_apis_playstore;arm64-v8a`. |
| AVD | Created `Porizo_GateA_API36` using device profile `pixel_8`, target Google Play Android 16/API 36, ABI `arm64-v8a`. |

Conclusion: local emulator smoke testing is now possible and has been run, but U1 still cannot pass until Ambrose attaches a physical Android device. Emulator-only evidence is insufficient for the Gate A `Skip` verdict because the source plan requires physical hardware for runtime, audio, push, background, and deep-link confidence.

## Android Emulator Runtime Smoke

Run date: 2026-06-30.

Target:

- AVD: `Porizo_GateA_API36`
- Serial: `emulator-5554`
- Android release: `16`
- System image: `system-images;android-36;google_apis_playstore;arm64-v8a`
- APK: `/private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-release.apk`
- Package/activity: `com.porizo.skipfusespike/porizo.skip.spike.MainActivity`

Smoke results:

| Flow | Result | Evidence |
| --- | --- | --- |
| Install | Pass | `adb -s emulator-5554 install -r -g /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-release.apk` -> `Success`. |
| Launch | Pass | `am start -n com.porizo.skipfusespike/porizo.skip.spike.MainActivity` launched `MainActivity`; foreground confirmed by `dumpsys window`. Screenshot: `/private/tmp/porizo-gatea-launch.png`. |
| Recipient screen render | Pass with visual issues | UI tree shows `Recipient MVP`, `Someone made you a song`, `Happy Birthday Sarah`, preview link, playback controls, and claim button. Visual screenshot shows several missing symbol fallbacks as warning triangles. |
| Playback control | Pass with visual issues | Tapping Play changed text to `Pause` and progress advanced from `18 / 62 sec` to `25 / 62 sec`; no crash or audio runtime error in logcat. Screenshot: `/private/tmp/porizo-gatea-after-play.png`. Missing symbol warnings include `pause.fill`. |
| Claim | Pass | Tapping `Claim on this Android device` changed state to `Claimed here`, title to `Saved to this device`, and bound device to `android-local-fixture`. Screenshot: `/private/tmp/porizo-gatea-after-claim.png`. |
| Strict App Link | Fail | `pm get-app-links com.porizo.skipfusespike` reports `porizo.app: legacy_failure`. Unforced `am start -a android.intent.action.VIEW -d https://porizo.app/s/sarah-birthday` opened Chrome first-run (`com.android.chrome/org.chromium.chrome.browser.firstrun.FirstRunActivity`), not the app. Screenshot: `/private/tmp/porizo-gatea-app-link.png`. |
| Package-targeted link | Partial pass only | `am start -W -a android.intent.action.VIEW -d https://porizo.app/s/sarah-birthday -p com.porizo.skipfusespike` cold-launched `MainActivity` in 2624 ms. This proves the activity can receive the URL when forced, but does not prove verified App Link routing. Screenshot: `/private/tmp/porizo-gatea-targeted-link.png`. |
| Create/Warm Canvas tab | Pass | Tab renders `Warm Canvas`, token chips, recipient field, occasion picker row, toggles, and message/tone inputs. Screenshot: `/private/tmp/porizo-gatea-create.png`. |
| Settings tab | Pass with visual issues | Tab renders `Spike Settings`, auth/subscription rows, appearance row, native escape-hatch placeholder, probe state, and bridge budget. Screenshot: `/private/tmp/porizo-gatea-settings.png`. Missing symbol warnings include `person.crop.circle.badge.checkmark` and `creditcard`. |
| Auth sheet | Pass with visual issues | Sheet opens with `Auth`, `PASSWORDLESS EMAIL`, `sarah@example.com`, `Send sign-in link`, and device trust placeholder. Screenshot: `/private/tmp/porizo-gatea-auth-sheet.png`. |
| Subscription sheet | Pass with visual issues | Sheet opens with `Subscription`, entitlement rows, `Gift Plus`, credits, and purchase-proof placeholder. Screenshot: `/private/tmp/porizo-gatea-subscription-sheet.png`. |
| Background/foreground | Pass | HOME then explicit relaunch resumed `MainActivity`; same process stayed alive (`pid=6860`) and foreground returned to `com.porizo.skipfusespike/porizo.skip.spike.MainActivity`. |
| Crash buffer | Pass | `adb -s emulator-5554 logcat -b crash -d` returned no crash entries for this run. |

Runtime issues found:

- SkipUI cannot resolve several SF Symbol names on Android; visible fallbacks appear as warning triangles. Observed names include `gift`, `link`, `pause.fill`, `checkmark.seal.fill`, `person.crop.circle.badge.checkmark`, `creditcard`, `lock.shield`, and `cart.badge.questionmark`.
- First render and tab/sheet transitions show emulator jank: logcat includes `Skipped 84/39 frames` and multiple `Davey!` frames around 727-1140 ms. The emulator reported software GL due host memory pressure, so this must be remeasured on physical hardware before making a product decision.
- Strict App Link verification is failing (`legacy_failure`). This is a real Gate A blocker unless resolved by `assetlinks.json`/host/cert setup or a deliberate fallback decision.
- Native escape hatch remains a placeholder. The Settings screen renders the placeholder and states: `No native probe has run. Hardware validation is still required.`

Runtime execution checklist: `docs/plans/android-skip-gate-a-runtime-runbook.md`.

Current blocker tracker: `docs/plans/android-skip-gate-a-blocker-tracker.md`.

## Gate A Inputs From U0

| Input | Status | Notes |
| --- | --- | --- |
| Release scope table | Ready | See `android-third-party-ledger.md`. Recipient MVP and Full Parity are split explicitly. |
| SDK ledger | Ready | See `android-third-party-ledger.md`. AppsFlyer/App Links are Recipient MVP-sensitive; most other SDKs are full-parity. |
| Legal/toolchain ledger | Ready | See `android-third-party-ledger.md`. Skip component licenses are separated by component. |
| Migration reservations | Ready | See `android-third-party-ledger.md`. Reservations avoid duplicate numeric prefixes while S1 agents fan out. |

## U1 Spike Thresholds

These thresholds are copied from the source plan and must be filled with measured results before Gate A can pass.

| Threshold | Pass Standard | Measured Result | Status |
| --- | --- | --- | --- |
| Unsupported SwiftUI constructs | <= 2 blocking constructs per screen, each with a documented fix | One initial Skip bridge compile issue: `private @State` was rejected; U1 fixed it before successful builds. No broader unsupported-screen no-go found locally. | Pass locally |
| Native escape hatches | <= 1 unplanned native bridge per screen | One planned native escape hatch placeholder: `RecordingEscapeHatchView` uses `ComposeView` + `ContentComposer`. Emulator Settings screen renders the native escape-hatch section and survives background/foreground, but the actual recording/STT probe has not run on hardware. | Partial |
| Bridge LOC | <= 150 LOC per screen average outside planned platform features | Approx. 28 Swift lines for the `ComposeView`/`ContentComposer` placeholder plus manifest App Link/audio permission entries. | Pass locally |
| Clean Android debug build | <= 10 minutes on local machine | Passed in 23.68s after fixing `private @State`. | Pass |
| Incremental UI edit build | <= 90 seconds | Passed in 3.98s. | Pass |
| Release APK/AAB | Produced successfully, size recorded and acceptable for Play/install conversion | Release APK/AAB produced. Reported 364.8 MB APK and 125.9 MB AAB; disk sizes 348M and 120M. APK is a universal local artifact with three large ABI payloads; bundletool estimates Play-style split downloads at <=43.12 MB for supported non-x86 phone ABIs in this spike. | Pass for spike; repeat on real Recipient MVP |
| Runtime stability | 30-minute physical-device run with no crash on spike flows | Emulator smoke passed install, launch, recipient playback/claim, package-targeted URL launch, Create tab, Settings tab, Auth sheet, Subscription sheet, and background/foreground without crash. Physical 30-minute run still not performed. | Partial |
| Visual/accessibility parity | Fonts/tokens visually acceptable against iOS screenshots; Dynamic Type/accessibility basics not broken | Emulator visual pass found acceptable basic layout on Recipient/Create/Settings/sheets, but visible warning-triangle icon fallbacks from missing SF Symbols. Dynamic Type/accessibility and physical-device visuals remain untested. | Partial |
| Legal/toolchain | No unresolved license or reproducibility blocker | U2 found no technical no-go, but SkipStone AGPL-3.0 / Skip Fuse LGPL / generated-artifact legal review remains unresolved. Evidence packet: `android-skip-legal-review-packet.md`. | Blocked |

U1 spike files were generated under local throwaway workspace `spikes/skip-fuse-spike/` and are not merged into the app. Main authored spike files:

- `spikes/skip-fuse-spike/Sources/PorizoSkipSpike/ContentView.swift`
- `spikes/skip-fuse-spike/Sources/PorizoSkipSpike/ViewModel.swift`
- `spikes/skip-fuse-spike/Android/app/src/main/AndroidManifest.xml`

## Release Artifact Size Review

Artifact paths:

| Artifact | Disk Size | Zip Size / Reported Size | Notes |
| --- | --- | --- | --- |
| `/private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-release.apk` | 348M | 364,803,436 bytes | Universal local APK with large native payloads for `arm64-v8a`, `armeabi-v7a`, and `x86_64`; `x86` exists but only carries a tiny native graphics-path library. |
| `/private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-release.aab` | 120M | 125,937,146 bytes | Play-relevant bundle artifact; not itself a download-size estimate. |
| `/private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip` | 22M | 22.6 MB reported | Generated source export. |

APK compressed-size breakdown from `zipinfo -l`:

| Group | Compressed | Uncompressed | Interpretation |
| --- | ---: | ---: | --- |
| `lib/arm64-v8a` | 121.0 MB | 121.0 MB | Native Swift/Foundation/Skip payload. |
| `lib/armeabi-v7a` | 110.8 MB | 110.8 MB | Native Swift/Foundation/Skip payload. |
| `lib/x86_64` | 117.9 MB | 117.9 MB | Emulator/native debug convenience payload; not a typical phone delivery target. |
| `dex` | 13.7 MB | 13.7 MB | JVM/Kotlin/Compose code. |
| Other assets/resources/META-INF | <1 MB | <1 MB | Not material. |

AAB compressed-size breakdown from `zipinfo -l`:

| Group | Compressed | Uncompressed | Interpretation |
| --- | ---: | ---: | --- |
| `base/lib/arm64-v8a` | 38.1 MB | 121.0 MB | AAB entry size for the modern-device native payload, not a verified download size by itself. |
| `base/lib/armeabi-v7a` | 37.5 MB | 110.8 MB | AAB entry size for the 32-bit native payload, not a verified download size by itself. |
| `base/lib/x86_64` | 38.1 MB | 117.9 MB | AAB entry size for emulator/native payload; should not affect most Play phone installs if split correctly. |
| `base/dex` | 4.8 MB | 13.7 MB | App/JVM payload. |
| `BUNDLE-METADATA` | 7.0 MB | 90.0 MB | Mostly `proguard.map`; check whether upload metadata affects Play delivery estimate. |

Top compressed AAB entries: `lib_FoundationICU.so` is ~15.9-16.2 MB per ABI, followed by `libFoundationNetworking.so`, `libswiftCore.so`, `libFoundationEssentials.so`, and `libSkipFuseUI.so`. That means the size question is mostly Skip/Swift runtime economics, not Porizo content.

Bundletool 1.18.3 split-delivery estimate:

| Check | Result |
| --- | --- |
| Tooling | Downloaded `bundletool-all-1.18.3.jar` to `/private/tmp`; used Homebrew JDK at `/opt/homebrew/Cellar/openjdk/26.0.1/libexec/openjdk.jdk/Contents/Home/bin/java`. |
| APK set | `bundletool build-apks --mode=default` produced `/private/tmp/porizo-skip-spike-release.apks` (~1.0 GB intermediate analysis artifact). |
| Overall estimate | `bundletool get-size total --human-readable-sizes` -> 4.75 MB min / 43.12 MB max. |
| ABI estimate | `arm64-v8a`: 42.88-43.12 MB; `armeabi-v7a`: 42.23-42.47 MB; `x86_64`: 42.81-43.05 MB; `x86`: 4.75-4.98 MB. Treat `x86` as anomalous/non-product until runtime-verified because only a tiny native x86 library was packaged. |
| Modern arm64 phone spec | Partial device spec `supportedAbis=["arm64-v8a"]`, `screenDensity=440`, `sdkVersion=35`, `locale=en` -> 43.12 MB. |
| Older 32-bit phone spec | Partial device spec `supportedAbis=["armeabi-v7a"]`, `screenDensity=320`, `sdkVersion=28`, `locale=en` -> 42.24 MB. |

Conclusion: the universal APK is not a valid install-conversion proxy. The spike's Play-style split download estimate is materially smaller and does not create a technical Gate A size no-go. Repeat this measurement after the real Recipient MVP build, confirm final ABI policy, and use Play Console's app-size report before U9.

References:

- `https://developer.android.com/tools/bundletool`
- `https://support.google.com/googleplay/android-developer/answer/9859372`

## U2 Research Questions

U2 must fill the following table with primary-source links, conclusions, owners, and Gate A blocking status.

| Question | Source Links | Conclusion | Owner | Blocks Gate A? |
| --- | --- | --- | --- | --- |
| SkipAV playback/recording/metering completeness and Android MediaSession fit | `https://skip.dev/docs/modules/skip-av/`, `https://github.com/skiptools/skip-av`, `https://developer.android.com/media/media3/session/background-playback` | SkipAV looks adequate for in-app `AVAudioPlayer`, `AVAudioRecorder`, and metering; Android lock-screen/notification/background controls still need a native Media3/MediaSession bridge. | U1 validates basic audio; S3/U7 owns Media3 bridge. | No research blocker; hardware proof still blocks pass. |
| SkipFoundation URLSession background support vs. WorkManager necessity | `https://skip.dev/docs/modules/skip-foundation/`, `https://developer.android.com/develop/background-work/background-tasks/data-transfer-options`, `https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started` | No evidence of iOS-style background `URLSession` parity on Android. Use WorkManager/foreground service behind protocols. | S2/U3a protocol; S3/U7 WorkManager bridge. | No if WorkManager bridge is accepted. |
| Skip Marketplace/StoreKit/Play Billing viability and limitations | `https://skip.dev/docs/modules/skip-marketplace/`, `https://developer.android.com/google/play/billing/integrate`, `https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get`, `https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get` | Skip Marketplace may be viable only for client purchase UI/token acquisition. Direct Play Billing remains fallback; backend stays entitlement authority. | S1/U6-server and S3/U6-client. | No for Recipient MVP; blocks Full Parity billing choice. |
| AppsFlyer deferred deep-link ownership on Android and exact OneLink handoff fields | `https://dev.appsflyer.com/hc/docs/dl_android_unified_deep_linking`, `https://dev.appsflyer.com/hc/docs/android-sample-payloads`, `https://developer.android.com/training/app-links/verify-applinks` | AppsFlyer owns deferred install attribution/OneLink resolution; Android App Links own verified installed-app routing. Existing server fields look sufficient: `deep_link_value`, `deep_link_sub1`, `deep_link_sub2`, `deep_link_sub3`, `pid`, `c`. | S4/U8a-client, S4/U8b-client, S1/U8b-server. | No research blocker; physical deferred-install/App Link proof still blocks pass. |
| Firebase/OneSignal split: push transport vs. marketing tags/external ID | `https://firebase.google.com/docs/cloud-messaging`, `https://firebase.google.com/docs/cloud-messaging/android/client`, `https://documentation.onesignal.com/docs/users`, `https://documentation.onesignal.com/docs/tags` | Keep FCM for Android transactional push and OneSignal for marketing segmentation/campaigns. Matches current APNs transactional service and separate OneSignal marketing service. | S1/U8d backend; Android FCM client; marketing push stream. | No for Recipient MVP unless push becomes MVP scope. |
| Enrollment-quality need for Whisper-grade STT vs. Android SpeechRecognizer | `https://developer.android.com/reference/android/speech/SpeechRecognizer`, `https://developer.android.com/reference/android/speech/RecognizerIntent`, `https://platform.openai.com/docs/guides/speech-to-text`, `PorizoApp/PorizoApp/Services/STTRouter.swift:60`, `docs/feature-audit/verify-p2p3/voiceenrollment.md:25` | Android `SpeechRecognizer` is acceptable for low-risk dictation UX, but not as the only enrollment-quality/full-parity STT path. Voice enrollment/safety still needs Whisper-grade backend transcription. | S3/U7 for Android dictation; backend/enrollment safety for Whisper. | No for Recipient MVP; yes if Full Parity tries to replace Whisper. |

## Gate A Verdict

This is the current Gate A verdict after U1 local build/export work, U2 research, bundletool sizing, and emulator runtime smoke.

```text
Gate A verdict: more spike required
Date: 2026-06-30
Owner: Codex
Rationale: Local Skip Fuse compile/build/export, U2 research, bundletool split-delivery sizing, and emulator runtime smoke are promising enough to continue Gate A, but the mandatory physical Android runtime proof and SkipStone legal review are missing. The emulator also surfaced real remediation items: strict App Link verification fails and several SF Symbols fall back to warning triangles on Android.
Blocking evidence:
- No physical Android device is attached.
- `skip devices` listed no Android device.
- Argent `list-devices` still returns no Android devices/AVDs because Argent's MCP server lacks Android SDK path configuration.
- U1 30-minute runtime, visual/accessibility, audio, and native escape-hatch checks did not run on physical Android hardware.
- Strict App Link verification fails on the emulator: `porizo.app: legacy_failure`; unforced `https://porizo.app/s/sarah-birthday` opens Chrome, not Porizo.
- Emulator UI shows visible missing-icon fallbacks for several SF Symbols.
- SkipStone AGPL-3.0 / Skip Fuse LGPL / generated-artifact legal review is not signed off.
Follow-up tasks:
- Attach a physical Android device and rerun U1 runtime checks. The emulator smoke supplements this, but cannot replace the physical-device Gate A proof.
- Fix or intentionally map missing Android symbols before treating visual parity as green.
- Serve/correct `assetlinks.json` for the spike package/certificate or document a fallback for strict App Links.
- Complete SkipStone / Skip Fuse / generated-artifact legal review using `android-skip-legal-review-packet.md`.
- Repeat bundletool/Play Console size review on the real Recipient MVP build and revisit Skip Fuse vs. Compose if that build materially exceeds the 43 MB spike estimate.
```
