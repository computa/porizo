---
title: "Android Skip Gate A Findings"
date: 2026-06-30
status: pre-gate
source_plan: docs/plans/2026-06-30-001-feat-android-via-skip-plan.md
execution_plan: docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md
---

# Android Skip Gate A Findings

## Gate State

**Verdict:** `pending`

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
| Android devices | Blocked for hardware verdict | `adb devices -l` returned no attached Android devices on 2026-06-30. `skip devices` listed iOS simulators/devices only. |

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
| Unsupported SwiftUI constructs | <= 2 blocking constructs per screen, each with a documented fix | Pending U1 | Pending |
| Native escape hatches | <= 1 unplanned native bridge per screen | Pending U1 | Pending |
| Bridge LOC | <= 150 LOC per screen average outside planned platform features | Pending U1 | Pending |
| Clean Android debug build | <= 10 minutes on local machine | Pending U1 | Pending |
| Incremental UI edit build | <= 90 seconds | Pending U1 | Pending |
| Release APK/AAB | Produced successfully, size recorded and acceptable for Play/install conversion | Pending U1 | Pending |
| Runtime stability | 30-minute physical-device run with no crash on spike flows | Blocked: no Android device attached | Blocked |
| Visual/accessibility parity | Fonts/tokens visually acceptable against iOS screenshots; Dynamic Type/accessibility basics not broken | Pending U1 | Pending |
| Legal/toolchain | No unresolved license or reproducibility blocker | Pending U2 + legal review | Pending |

## U2 Research Questions

U2 must fill the following table with primary-source links, conclusions, owners, and Gate A blocking status.

| Question | Source Links | Conclusion | Owner | Blocks Gate A? |
| --- | --- | --- | --- | --- |
| SkipAV playback/recording/metering completeness and Android MediaSession fit | Pending U2 | Pending | U2 | Yes |
| SkipFoundation URLSession background support vs. WorkManager necessity | Pending U2 | Pending | U2 | Yes |
| Skip Marketplace/StoreKit/Play Billing viability and limitations | Pending U2 | Pending | U2 | Yes |
| AppsFlyer deferred deep-link ownership on Android and exact OneLink handoff fields | Pending U2 | Pending | U2 | Yes |
| Firebase/OneSignal split: push transport vs. marketing tags/external ID | Pending U2 | Pending | U2 | Yes |
| Enrollment-quality need for Whisper-grade STT vs. Android SpeechRecognizer | Pending U2 | Pending | U2 | No for Recipient MVP; Yes for Full Parity |

## Gate A Verdict Template

Fill this section only after U1 and U2 are complete.

```text
Gate A verdict: <Skip | Compose fallback | more spike required>
Date:
Owner:
Rationale:
Blocking evidence:
Follow-up tasks:
```
