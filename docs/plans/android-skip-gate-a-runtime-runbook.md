---
title: "Android Skip Gate A Runtime Runbook"
date: 2026-06-30
status: waiting-for-physical-device
source_plan: docs/plans/2026-06-30-001-feat-android-via-skip-plan.md
execution_plan: docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md
gate: Gate A
---

# Android Skip Gate A Runtime Runbook

## Purpose

This runbook closes the remaining U1 hardware evidence gap once a physical Android device is available. It does not authorize downstream S1/S2/S4 work. Gate A can change to `Skip` only after this runbook's required physical-device evidence and the legal review packet are both green.

## Current Spike Inputs

| Item | Value |
| --- | --- |
| Package | `com.porizo.skipfusespike` |
| Main activity | `porizo.skip.spike.MainActivity` |
| App Link fixture | `https://porizo.app/s/sarah-birthday` |
| Intent filter | `https`, host `porizo.app`, path prefix `/s/` |
| Release APK | `/private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-release.apk` |
| Debug APK | `/private/tmp/skip-fuse-export-debug-u1/PorizoSkipSpike-debug.apk` |
| Source workspace | `spikes/skip-fuse-spike/` (ignored throwaway workspace) |

The release APK is suitable for runtime sizing/performance evidence, but it is debug-signed in this spike. It is not a Play submission artifact.

## Required Environment

- Physical Android phone, not only an emulator.
- API level 28 or newer, with microphone hardware.
- USB debugging enabled and trusted by the machine.
- Network access available for link/browser behavior.
- Permission to use the generated APK locally for internal engineering validation.
- Legal review still separate: do not distribute APK/AAB outside approved internal testing until `android-skip-legal-review-packet.md` is signed off.

## Device Discovery

Preferred control path is Argent. Start with:

1. `list-devices`
2. Select an Android entry with `state: "device"`.
3. Use that serial as `udid` for `reinstall-app`, `launch-app`, `open-url`, `describe`, `screenshot`, and gestures.

Shell evidence to capture in the findings file:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb devices -l
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell getprop ro.product.manufacturer
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell getprop ro.product.model
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell getprop ro.build.version.sdk
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell getprop ro.product.cpu.abi
```

## Install And Launch

Preferred:

1. Install with Argent `reinstall-app`, using the release APK and package above.
2. Launch with Argent `launch-app`, bundle ID `com.porizo.skipfusespike`.
3. Immediately run `describe`, then capture a baseline screenshot.

ADB fallback:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> install -r -g /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-release.apk
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell monkey -p com.porizo.skipfusespike 1
```

## Evidence To Capture

| Evidence | Required |
| --- | --- |
| Device identity | Manufacturer, model, API level, ABI. |
| Install result | Command/tool output and installed package confirmation. |
| Launch result | First screen `describe` plus screenshot. |
| Crash/ANR state | `logcat -b crash` and app process logs after run. |
| Flow screenshots | Recipient, Warm Canvas, Settings, Auth sheet, Subscription sheet, native escape-hatch section. |
| App Link result | Verified link opens the claim surface without manual package targeting, or exact failure recorded. |
| Stability result | 30-minute start/end timestamp, interactions performed, no crash/ANR. |
| Accessibility result | Dynamic font / large text pass or exact layout failure. |

## Runtime Flow

Use discovery before every tap. Do not use screenshot coordinates.

1. **Launch smoke:** app opens to `Recipient MVP`; no blank screen; no crash.
2. **Recipient state matrix:** switch claim fixture through Ready, Claimed here, Already claimed, Expired, Wrong device. Expected: each state renders distinct copy and no layout overlap.
3. **Playback fixture:** in Ready and Claimed here states, tap Play/Pause. Expected: button toggles and progress remains stable; disabled states stay disabled.
4. **App Link:** open `https://porizo.app/s/sarah-birthday`. Strict pass requires verified App Link routing to the claim surface on the physical device. If only an explicit package-targeted `adb am start` works, mark App Link proof partial and do not pass Gate A.
5. **Warm Canvas:** open Create tab. Exercise text field, occasion picker, toggles, text editor, voice picker, and duration slider. Expected: dense form remains usable with keyboard open and no text clipping.
6. **Settings sheets:** open Settings tab. Open Auth sheet, close it; open Subscription sheet, close it. Expected: sheet payload is correct on every launch and no stale/empty sheet appears.
7. **Appearance:** switch System/Light/Dark. Expected: no illegible colors or stuck state after relaunch.
8. **Native escape hatch:** verify the Android recording/STT shell placeholder is visible. Switch probe states Idle, Permission shell, Backgrounded, Failed. Expected: Compose escape hatch renders and survives navigation.
9. **Background/foreground:** while on Playback and native escape-hatch surfaces, background the app, wait at least 30 seconds, foreground it. Expected: no crash, state remains coherent.
10. **Accessibility:** set font scale to a large value on a test device, relaunch, and inspect Recipient/Warm Canvas/Settings. Restore font scale after test.

Font-scale shell fallback for a disposable test device:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell settings get system font_scale
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell settings put system font_scale 1.3
# run accessibility pass, then restore the original value
```

## Thirty-Minute Stability Run

Record start time, end time, device state, and every interaction. Minimum loop:

| Minute | Action |
| --- | --- |
| 0 | Fresh install, launch, baseline screenshot. |
| 5 | Recipient state switch + Play/Pause. |
| 10 | App Link open. |
| 15 | Warm Canvas text input/picker/toggle pass. |
| 20 | Settings Auth/Subscription sheets. |
| 25 | Background/foreground from native escape-hatch section. |
| 30 | Final screenshot, crash log, app log. |

Required pass: no crash, no ANR, no unrecoverable blank screen, no repeated tap failure, and no state corruption that prevents continuing.

## App Link Strictness

Gate A's product bet is installed-app handoff. Treat these separately:

| Result | Gate Meaning |
| --- | --- |
| Verified `https://porizo.app/s/...` opens the app directly to Recipient MVP | Pass candidate. |
| Link opens a chooser/browser because `assetlinks.json` is absent or unverified | Blocked/partial; record exact state. |
| Explicit package-targeted `adb am start` opens the app | Useful routing smoke, but not enough for Gate A pass. |
| App opens but does not show claim surface | Fail until fixed or Compose fallback decision. |

## Logs

Capture before and after:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> logcat -c
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> shell pidof -s com.porizo.skipfusespike
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> logcat -b crash -d
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> logcat -d
```

If app PID exists, also capture a process-filtered log during the 30-minute run.

## Verdict Update Rules

Update `android-skip-gate-a-findings.md` only after the run:

| Condition | Verdict |
| --- | --- |
| Physical runtime passes, App Link strict pass, visual/accessibility acceptable, native escape hatch survives, legal review signed off | Change Gate A to `Skip`; then S1/S2/S4 may dispatch. |
| Runtime mostly passes but App Link/legal/visual/accessibility remains unresolved | Keep `more spike required`; list exact missing evidence. |
| Runtime shows repeated crash/ANR, unacceptable layout failures, or unbounded native escape-hatch work | Prefer `Compose fallback` unless a narrow fix can be proven quickly. |

Do not edit the verdict based on emulator-only evidence.

## Cleanup

After testing:

```bash
/Users/ao/Library/Android/sdk/platform-tools/adb -s <serial> uninstall com.porizo.skipfusespike
```

Restore any test-device setting changes. Stop Argent simulator/device servers at the end of the session.
