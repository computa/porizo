---
title: "Android Skip Legal Review Packet"
date: 2026-06-30
status: needs-legal-review
source_plan: docs/plans/2026-06-30-001-feat-android-via-skip-plan.md
execution_plan: docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md
gate: Gate A
---

# Android Skip Legal Review Packet

## Purpose

This packet gathers the Skip-related licensing and generated-artifact evidence needed to unblock Gate A. It is not legal advice and does not sign off use of Skip. Gate A must remain `more spike required` until Ambrose or counsel explicitly accepts the license/toolchain obligations.

## Current Decision Needed

Before the plan can change Gate A to `Skip`, decide whether Porizo may:

- Use the Skip CLI / `skipstone` SwiftPM plugin in a proprietary commercial build process.
- Commit any Skip-generated Android project files to the repo.
- Ship APK/AAB artifacts that include Skip/Swift runtime binaries.
- Vendor or modify MPL/LGPL/Apache-covered Skip package source if the generated project requires it.

If the answer to any of those is no, the source plan's co-equal fallback remains: shared backend plus native Compose UI.

## Evidence Collected

| Surface | Evidence | Review Meaning |
| --- | --- | --- |
| Local Skip CLI | `skip version` -> `Skip version 1.9.4`. | Version in use for the spike. |
| Spike package dependency | `spikes/skip-fuse-spike/Package.swift` depends on `https://source.skip.tools/skip.git` from `1.9.4` and `https://source.skip.tools/skip-fuse-ui.git` from `1.0.0`; target uses plugin `.plugin(name: "skipstone", package: "skip")`. | `skipstone` is an active build plugin, not a passive transitive library. |
| Resolved spike pins | `spikes/skip-fuse-spike/Package.resolved` includes `skip`, `skip-android-bridge`, `skip-bridge`, `skip-foundation`, `skip-fuse`, `skip-fuse-ui`, `skip-lib`, `skip-model`, `skip-ui`, `skip-unit`, `swift-android-native`, and `swift-jni`. | Legal review should cover the whole resolved set, not only `skip` and `skip-fuse-ui`. |
| Generated export | `/private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip` includes generated Gradle modules plus vendored Swift package sources and their license files. | Generated/exported project output may contain third-party source, not just Porizo-authored generated code. |
| Repo commit status | Generated spike workspace is ignored by `.gitignore`; release APK/AAB/project zip live under `/private/tmp`; no generated Android project output is committed. | Current repo state is conservative; legal review can happen before generated output enters source control. |
| License scan | `rg "AGPL|Affero|GNU Affero|MPL|Mozilla Public License|SPDX-License-Identifier|skipstone|SkipStone"` against the non-build spike workspace found only plugin/project references, not AGPL text. `zipgrep` / targeted `unzip -p` checks on the export zip found many MPL license files and `LICENSE.LGPL` for `skip-fuse`. `GNU Affero` appears inside MPL boilerplate secondary-license language, not as a standalone AGPL license file in the generated export. | Absence of standalone AGPL text in the checked spike/export files does not settle the `skipstone` plugin obligation; it narrows the artifact question to generated output and vendored package source. |

## Observed License Families

| Component / Source | Observed License Evidence | Open Questions |
| --- | --- | --- |
| `skipstone` / `skip` plugin | U0 ledger recorded GitHub API result for `skiptools/skipstone` as `AGPL-3.0`; `Package.swift` uses the `skipstone` plugin from package `skip`. | Does AGPL build-tool/plugin execution impose obligations on Porizo app source, generated Kotlin/Gradle files, build scripts, APK/AAB output, or only modified/distributed `skipstone` itself? |
| Skip MPL packages | Exported `LICENSE.txt` files for `skip-fuse-ui`, `skip-ui`, `skip-foundation`, `skip-lib`, `skip-model`, `skip-unit`, `skip-bridge`, and `skip-android-bridge` begin with Mozilla Public License 2.0. | Are unmodified MPL-covered package sources allowed in the generated project repo? What notice/source-offer process is required if Porizo modifies those package files? |
| `skip-fuse` | Exported `LICENSE.LGPL` says LGPL3 plus a special exception for combined works that link statically or dynamically, subject to the rest of LGPL3 and application license compliance. | Is the special exception sufficient for closed-source Porizo distribution? What notice, attribution, or modification-source obligations remain? |
| `swift-jni` | Exported `LICENSE.txt` begins with Apache License 2.0. | Standard Apache notice handling likely applies; confirm whether notices must appear in-app, in Play listing, or in repo docs. |
| Swift Android runtime binaries | APK/AAB include Swift/Foundation/ICU/native runtime libraries. | Confirm license/notice obligations for Swift Android native runtime and ICU/Foundation binaries in distributed APK/AAB artifacts. |
| Android/Gradle dependencies | APK/AAB include AndroidX/Compose/WorkManager and related metadata/licenses. | Standard Android open-source notices may be needed for full release, especially once real app dependencies are added. |

## Generated Artifact Questions

Counsel/reviewer should answer these before a `Skip` Gate A verdict:

1. Can Porizo commit generated Android Gradle project files produced by Skip?
2. Can Porizo commit generated Kotlin sources under paths like `SkipSwiftUI/src/main/kotlin/skip/swift/ui/*.kt`?
3. Can Porizo commit vendored Skip package sources and licenses from the export zip, or must those remain package-manager dependencies only?
4. If generated output includes or derives from Skip-owned templates, does committing or distributing that output trigger MPL/LGPL/AGPL source obligations?
5. Are the APK/AAB artifacts safe to distribute internally for hardware testing before full legal signoff, or should runtime testing be limited to local devices?
6. What third-party notices must be included in-app, in release notes, in the repository, and in Play Console artifacts?
7. Is a commercial Skip license or written permission needed to proceed with a closed-source Porizo Android app?

## Interim Controls

Until signoff:

- Do not commit generated Skip Android project output.
- Do not commit `/private/tmp/skip-fuse-export-*` artifacts or `PorizoSkipSpike-project.zip`.
- Do not modify vendored Skip package source.
- Keep `spikes/skip-fuse-spike/` ignored and clearly throwaway.
- Treat APK/AAB distribution as local/internal engineering evidence only.
- If legal review approves Skip, add a third-party notices file and a license update task before U9.

## Commands Run For Evidence

```bash
skip version
rg -n "AGPL|Affero|GNU Affero|MPL|Mozilla Public License|SPDX-License-Identifier|skipstone|SkipStone" spikes/skip-fuse-spike --glob '!**/.build/**' --glob '!**/.gradle/**' --glob '!**/build/**'
unzip -l /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip
zipgrep -n "Mozilla Public License" /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip
zipgrep -n "GNU LESSER GENERAL PUBLIC LICENSE" /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip
zipgrep -n "GNU Affero" /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip
unzip -p /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip PorizoSkipSpike/PorizoSkipSpike/src/main/swift/Packages/skip-fuse/LICENSE.LGPL
unzip -p /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip PorizoSkipSpike/PorizoSkipSpike/src/main/swift/Packages/skip-fuse-ui/LICENSE.txt
unzip -p /private/tmp/skip-fuse-export-release-u1/PorizoSkipSpike-project.zip PorizoSkipSpike/PorizoSkipSpike/src/main/swift/Packages/swift-jni/LICENSE.txt
```

## References

- `docs/plans/android-third-party-ledger.md`
- `docs/plans/android-skip-gate-a-findings.md`
- `https://github.com/skiptools/skipstone`
- `https://source.skip.tools/skip.git`
- `https://source.skip.tools/skip-fuse-ui.git`
