---
title: "Android Skip Gate A Blocker Tracker"
date: 2026-06-30
status: blocked-on-hardware-and-legal
source_plan: docs/plans/2026-06-30-001-feat-android-via-skip-plan.md
execution_plan: docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md
gate: Gate A
---

# Android Skip Gate A Blocker Tracker

## Status Snapshot

| Area | Status | Percent | Notes |
| --- | --- | ---: | --- |
| Full Android plan | In progress | 20-22% | U0, U2, local U1 build/export/size, emulator smoke, legal packet, and runtime runbook are done. No Phase 2+ work may start. |
| Gate A | Blocked | 82% | Local technical evidence is now mostly positive, including emulator smoke, but physical-device runtime proof and legal signoff are still missing. |
| U1 Skip Fuse spike | Partial | 78% | Build/export/size/runbook/emulator smoke are done; physical runtime, strict App Link resolution, visual/accessibility remediation, and native escape-hatch hardware proof remain. |
| U2 research | Done | 100% | No research no-go found; platform caveats are assigned to later streams. |
| S1/S2/S4 dispatch | Blocked | 0% | Must wait for Gate A verdict `Skip`. |

These percentages are planning estimates, not effort accounting. They reflect gate risk more than line count.

## Gate A Blockers

| Blocker | Owner | Current Evidence | Exit Criteria | Blocks |
| --- | --- | --- | --- | --- |
| Physical Android device runtime | Ambrose / engineering | Emulator `Porizo_GateA_API36` ran install/launch/playback/claim/tabs/sheets/background-foreground without crash, but no physical Android phone is attached. | Run `android-skip-gate-a-runtime-runbook.md` on a physical Android phone and record pass/fail evidence in `android-skip-gate-a-findings.md`. | Gate A verdict, S1/S2/S4 dispatch. |
| App Link strict proof | Ambrose / engineering | Emulator `pm get-app-links` reports `porizo.app: legacy_failure`; unforced URL opens Chrome first-run, not the app. Package-targeted URL cold-launches `MainActivity` in 2624 ms, which is only partial proof. | `https://porizo.app/s/sarah-birthday` opens the installed app claim surface without manual package targeting, or the failure is documented and resolved/fallback chosen. | Gate A verdict. |
| Visual/accessibility parity | Ambrose / engineering | Emulator screenshots exist for Recipient, Create, Settings, Auth sheet, and Subscription sheet. Layout is basically usable, but missing SF Symbols render as warning triangles. No Dynamic Type/accessibility or physical visual pass yet. | Recipient, Warm Canvas, Settings, Auth sheet, Subscription sheet, and native escape-hatch surfaces pass visual and font-scale checks or exact remediation is documented. | Gate A verdict. |
| Native escape-hatch runtime | Ambrose / engineering | Settings escape-hatch section renders in emulator and survives background/foreground, but it is still a placeholder: `No native probe has run. Hardware validation is still required.` | Escape-hatch section renders on hardware and survives navigation/background-foreground; native recording/STT probe result is recorded or explicitly scoped out. | Gate A verdict. |
| Legal/toolchain signoff | Ambrose / counsel | `android-skip-legal-review-packet.md` prepared; no signoff yet. | Written approval or rejection of SkipStone AGPL, Skip Fuse LGPL, MPL package, generated artifact, and APK/AAB distribution questions. | Gate A verdict. |

## What Is Done

- Baseline and execution plan committed.
- SDK, legal/toolchain, release-scope, and migration ledgers committed.
- U2 platform research completed.
- U1 local Skip spike generated in ignored throwaway workspace.
- Debug and release Android exports completed.
- Bundletool 1.18.3 split-delivery estimate completed; max spike download estimate is about 43.12 MB.
- Android Studio launched, command-line tools installed, API 36 Google Play arm64 system image installed, and AVD `Porizo_GateA_API36` created.
- Release APK installed and smoke-tested on `emulator-5554`.
- Emulator smoke passed launch, Recipient playback/claim, Create tab, Settings tab, Auth sheet, Subscription sheet, package-targeted URL launch, and background/foreground without crash.
- Runtime runbook written.
- Legal review packet written.

## What Is Not Done

- No physical Android runtime run.
- Strict App Link proof is failing in emulator (`porizo.app: legacy_failure`); needs assetlinks/host/cert fix or fallback decision.
- Visual remediation is needed for missing Android symbol fallbacks.
- No visual/accessibility pass on Android hardware.
- No native escape-hatch hardware/runtime probe proof.
- No legal signoff.
- No S1 backend work.
- No S2 Swift modularization work.
- No S4 Android auth/device-trust client work.
- No Gate B, Recipient MVP, full parity, or release work.

## Restart Procedure

When a physical Android device is attached:

1. Run `docs/plans/android-skip-gate-a-runtime-runbook.md`.
2. Append measured results to `docs/plans/android-skip-gate-a-findings.md`.
3. If runtime passes and legal is still blocked, keep verdict `more spike required`.
4. If runtime fails materially, choose between a narrow spike fix and `Compose fallback`.
5. If runtime passes and legal signs off, change Gate A verdict to `Skip`, then dispatch S1/S2/S4 per `docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md`.

## Next Dispatch If Gate A Passes

The first allowed fan-out after Gate A `Skip`:

- S1: `U8a-server`, `U8b-server`, `U6-server`, `U8d`.
- S2: `U3a` only; S2 remains serial.
- S4: `U8a-client`, `U8b-client`.

Do not dispatch any of these while the findings file says `more spike required`.

## Local Artifacts

| Artifact | Status | Size |
| --- | --- | ---: |
| `spikes/skip-fuse-spike/` | Ignored throwaway workspace | ~11G |
| `/private/tmp/skip-fuse-export-release-u1` | Local export artifacts | ~490M |
| `/private/tmp/skip-fuse-export-debug-u1` | Local export artifacts | ~291M |
| `/private/tmp/porizo-skip-spike-release.apks` | Bundletool intermediate | ~1.0G |
| `/private/tmp/bundletool-all-1.18.3.jar` | Local bundletool jar | ~31M |
| `/private/tmp/commandlinetools-mac-14742923_latest.zip` | Android command-line tools archive | ~143M |
| `/private/tmp/porizo-gatea-*.png` | Emulator smoke screenshots | ~1.4M |

These are intentionally not committed.
