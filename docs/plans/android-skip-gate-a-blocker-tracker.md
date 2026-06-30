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
| Full Android plan | In progress | 18-20% | U0, U2, local U1 build/export/size, legal packet, and runtime runbook are done. No Phase 2+ work may start. |
| Gate A | Blocked | 75% | The local technical evidence is mostly positive, but physical-device runtime proof and legal signoff are still missing. |
| U1 Skip Fuse spike | Partial | 65% | Build/export/size/runbook are done; physical runtime, App Link, visual/accessibility, and native escape-hatch proof remain. |
| U2 research | Done | 100% | No research no-go found; platform caveats are assigned to later streams. |
| S1/S2/S4 dispatch | Blocked | 0% | Must wait for Gate A verdict `Skip`. |

These percentages are planning estimates, not effort accounting. They reflect gate risk more than line count.

## Gate A Blockers

| Blocker | Owner | Current Evidence | Exit Criteria | Blocks |
| --- | --- | --- | --- | --- |
| Physical Android device runtime | Ambrose / engineering | Argent `list-devices` returned no Android devices or AVDs; ADB returned no attached devices; local SDK has no emulator package. | Run `android-skip-gate-a-runtime-runbook.md` on a physical Android phone and record pass/fail evidence in `android-skip-gate-a-findings.md`. | Gate A verdict, S1/S2/S4 dispatch. |
| App Link strict proof | Ambrose / engineering | Spike manifest contains `https://porizo.app/s/` intent filter, but no physical-device verified-link run happened. | `https://porizo.app/s/sarah-birthday` opens the installed app claim surface without manual package targeting, or the failure is documented and resolved/fallback chosen. | Gate A verdict. |
| Visual/accessibility parity | Ambrose / engineering | Local build exists; no physical screenshot/accessibility pass. | Recipient, Warm Canvas, Settings, Auth sheet, Subscription sheet, and native escape-hatch surfaces pass visual and font-scale checks or exact remediation is documented. | Gate A verdict. |
| Native escape-hatch runtime | Ambrose / engineering | `RecordingEscapeHatchView` uses Compose escape hatch locally; Android runtime not proven. | Escape-hatch section renders on hardware and survives navigation/background-foreground. | Gate A verdict. |
| Legal/toolchain signoff | Ambrose / counsel | `android-skip-legal-review-packet.md` prepared; no signoff yet. | Written approval or rejection of SkipStone AGPL, Skip Fuse LGPL, MPL package, generated artifact, and APK/AAB distribution questions. | Gate A verdict. |

## What Is Done

- Baseline and execution plan committed.
- SDK, legal/toolchain, release-scope, and migration ledgers committed.
- U2 platform research completed.
- U1 local Skip spike generated in ignored throwaway workspace.
- Debug and release Android exports completed.
- Bundletool 1.18.3 split-delivery estimate completed; max spike download estimate is about 43.12 MB.
- Runtime runbook written.
- Legal review packet written.

## What Is Not Done

- No physical Android runtime run.
- No strict App Link proof.
- No visual/accessibility pass on Android hardware.
- No native escape-hatch runtime proof.
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

These are intentionally not committed.
