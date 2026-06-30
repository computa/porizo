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

Gate A cannot release S1/S2/S4 yet. Local Skip Fuse build/export evidence is materially positive, U2 did not find a platform-research no-go, and bundletool split-delivery sizing did not find a technical Play-size blocker. Two hard Gate A pass criteria remain unresolved:

- No physical Android device was available for the 30-minute runtime, visual/accessibility, App Link, audio, and native escape-hatch proof.
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
| Android devices | Blocked for hardware verdict | `adb devices -l` returned no attached Android devices on 2026-06-30. `skip devices` listed iOS simulators/devices only. A follow-up Argent `list-devices` pass returned no Android devices and no AVDs. The local Android SDK has `platform-tools`, `build-tools`, `licenses`, and `platforms`, but no `emulator/` package. An emulator would be useful for partial UI smoke testing only; Gate A still requires physical Android hardware. |
| U1 debug export | Pass | `skip export --debug --android --no-ios` completed in 414.05s. Reported APK/AAB/source zip: 217.3 MB / 65.5 MB / 22.6 MB. Disk sizes: 207M / 63M / 22M. |
| U1 release export | Pass | `skip export --release --android --no-ios` completed in 212.47s. Reported APK/AAB/source zip: 364.8 MB / 125.9 MB / 22.6 MB. Disk sizes: 348M / 120M / 22M. |
| U1 split-delivery size | Pass for spike; repeat for real build | Bundletool 1.18.3 estimated installable compressed download size at 4.75-43.12 MB across generated splits. Modern arm64 phone spec: 43.12 MB. Older 32-bit spec: 42.24 MB. |

## Runtime Availability Retest

Follow-up check on 2026-06-30:

| Check | Result |
| --- | --- |
| Argent device discovery | `list-devices` returned `devices: []` and `avds: []`. |
| ADB attached devices | `/Users/ao/Library/Android/sdk/platform-tools/adb devices -l` returned only the header. |
| ADB version | ADB 1.0.41, version 37.0.0-14910828. |
| Emulator package | `/Users/ao/Library/Android/sdk/emulator/emulator` does not exist; `which emulator` returned no executable. |
| SDK contents | SDK contains `build-tools`, `licenses`, `platform-tools`, and `platforms`; no local emulator package was available to boot an AVD. |

Conclusion: U1 cannot finish locally until Ambrose attaches a physical Android device. Installing/configuring an emulator/AVD would help with partial UI smoke testing and bundle-install rehearsal, but emulator-only evidence is insufficient for the Gate A `Skip` verdict because the source plan requires physical hardware for runtime, audio, push, background, and deep-link confidence.

Runtime execution checklist: `docs/plans/android-skip-gate-a-runtime-runbook.md`.

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
| Native escape hatches | <= 1 unplanned native bridge per screen | One planned native escape hatch placeholder: `RecordingEscapeHatchView` uses `ComposeView` + `ContentComposer`; Android runtime not proven. | Partial |
| Bridge LOC | <= 150 LOC per screen average outside planned platform features | Approx. 28 Swift lines for the `ComposeView`/`ContentComposer` placeholder plus manifest App Link/audio permission entries. | Pass locally |
| Clean Android debug build | <= 10 minutes on local machine | Passed in 23.68s after fixing `private @State`. | Pass |
| Incremental UI edit build | <= 90 seconds | Passed in 3.98s. | Pass |
| Release APK/AAB | Produced successfully, size recorded and acceptable for Play/install conversion | Release APK/AAB produced. Reported 364.8 MB APK and 125.9 MB AAB; disk sizes 348M and 120M. APK is a universal local artifact with three large ABI payloads; bundletool estimates Play-style split downloads at <=43.12 MB for supported non-x86 phone ABIs in this spike. | Pass for spike; repeat on real Recipient MVP |
| Runtime stability | 30-minute physical-device run with no crash on spike flows | Blocked: no Android device attached and no local AVD/emulator package available. | Blocked |
| Visual/accessibility parity | Fonts/tokens visually acceptable against iOS screenshots; Dynamic Type/accessibility basics not broken | Pending U1 | Pending |
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

This is the current Gate A verdict after U1 local build/export work and U2 research.

```text
Gate A verdict: more spike required
Date: 2026-06-30
Owner: Codex
Rationale: Local Skip Fuse compile/build/export, U2 research, and bundletool split-delivery sizing are promising enough to continue Gate A, but the mandatory physical Android runtime proof and SkipStone legal review are missing.
Blocking evidence:
- `adb devices -l` returned no Android device.
- `skip devices` listed no Android device.
- Argent `list-devices` returned no Android devices and no AVDs; the local Android SDK has no emulator package to boot.
- U1 runtime, visual/accessibility, App Link, audio, and native escape-hatch checks did not run on Android hardware.
- SkipStone AGPL-3.0 / Skip Fuse LGPL / generated-artifact legal review is not signed off.
Follow-up tasks:
- Attach a physical Android device and rerun U1 runtime checks. An emulator may supplement this, but cannot replace the physical-device Gate A proof.
- Complete SkipStone / Skip Fuse / generated-artifact legal review using `android-skip-legal-review-packet.md`.
- Repeat bundletool/Play Console size review on the real Recipient MVP build and revisit Skip Fuse vs. Compose if that build materially exceeds the 43 MB spike estimate.
```
