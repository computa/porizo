---
name: porizo-swiftui-release-workflow
description: Use for Porizo SwiftUI feature work, iOS release readiness, Xcode release adoption, preview matrices, accessibility checks, simulator validation, Instruments/Organizer performance checks, and App Store screenshot impact review.
metadata:
  version: 1.0.0
---

# Porizo SwiftUI Release Workflow

This skill turns SwiftUI implementation and Apple platform release adoption into
a repeatable Porizo workflow. Use it whenever touching `PorizoApp/PorizoApp/**/*.swift`,
planning an iOS release, evaluating Xcode/iOS SDK changes, or changing screens
that appear in App Store screenshots.

## Source of truth

- Product constraints: `CLAUDE.md`, `specs/personalized-song-platform-spec.md`,
  and `docs/architecture-and-flows.md`.
- Simulator details: `docs/dev/simulator-testing.md` and the
  `porizo-simulator-testing` skill.
- Release gate: `docs/pre-testflight-distribution-checklist.md`.
- Detailed workflow: `docs/ios-swiftui-release-workflow.md`.

Preserve the core constraints: user-voice output, share-once with device claim,
app-only saving, auditability, and no voice file upload bypasses.

## Required companion skills

Use the smallest relevant set, but default to this stack for app UI work:

- `swiftui-ui-patterns` during implementation or refactor.
- `swiftui-pro` before handoff or review.
- `swiftui-performance-audit` for slow screens, major flows, or release candidates.
- `porizo-simulator-testing` for simulator launch, fixture navigation, and visual checks.
- `app-store-screenshots` and `screenshot-optimization` when UI changes affect store assets.
- `app-icon-optimization` when adopting Icon Composer or changing the icon.
- `localization` when adding languages, String Catalogs, or localized store copy.

## Xcode adoption policy

- Ship release builds from the current stable Xcode line unless Ambrose explicitly
  asks for a beta release build or Apple changes App Store requirements.
- Treat Xcode 27 beta as a compatibility lane only until it is stable.
- Keep older-device QA on Xcode 26.x when debugging iOS 15 or iOS 16 behavior,
  because Xcode 27 beta device debugging starts at iOS 17.
- When testing Address Sanitizer or Thread Sanitizer against 26.x OS releases,
  use Xcode 26.5 or newer.
- Rebuild any Xcode 26.4 MetricKit-using app with Xcode 26.4.1 or newer.

## Implementation workflow

1. Classify the change.
   - Product flow: onboarding, create, reveal, library, playback, share, paywall, settings.
   - Risk area: auth, billing, data persistence, voice enrollment, share/device claim,
     app store screenshot state, or purely visual.
   - Release lane: stable shipping, beta compatibility, or exploratory prototype.

2. Establish state ownership before coding.
   - Keep local UI state local.
   - Use environment-injected services for shared dependencies.
   - Prefer SwiftUI-native state and avoid unnecessary view models.
   - For selected-payload flows, use `.sheet(item:)` or `.fullScreenCover(item:)`
     instead of a boolean plus separate payload state.

3. Define the preview matrix.
   Every important screen should have representative previews for:
   - Empty, loading, error, and populated states.
   - Long recipient names, long generated copy, and failed network/provider states.
   - Light and dark mode.
   - Dynamic Type at normal and accessibility sizes.
   - Small iPhone and large iPhone layouts.
   - Any release fixture states used by App Store screenshots.

4. Build for accessibility.
   - Interactive controls need clear labels.
   - Icon-only actions need accessible names.
   - VoiceOver reading order must match the intended task flow.
   - Dynamic Type must not clip call-to-action text or generated content.
   - Reduce Motion must avoid blocking reveal/playback comprehension.

5. Avoid SwiftUI performance traps.
   - Do not sort, filter, decode images, create formatters, or perform network work
     in `body`.
   - Use stable IDs in `ForEach`.
   - Avoid root view churn when a small conditional section would work.
   - Keep broad observable state out of leaf views when it causes invalidation fan-out.
   - Downsample large images before display.

6. Validate with simulator or device workflow.
   - Use `porizo-simulator-testing` for fixture launches and flow verification.
   - Do not guess tap coordinates from screenshots.
   - For production-risk changes, verify the real backend path or explicitly state
     why only fixture validation was possible.

7. Validate release impact.
   - Run relevant build, lint, and tests from `package.json` and Xcode.
   - For release candidates, check Organizer metrics or recent crash/hang data when
     available.
   - Use Instruments Run Comparison for major performance-sensitive UI changes.
   - Update App Store screenshots or screenshot docs when visible store-facing UI changes.

## Acceptance checklist

Before handoff, be able to state:

- Which companion skills were used and why.
- Which previews or fixture states cover the changed UI.
- Which simulator/device flows were checked.
- Which tests/builds ran, with exact command names.
- Whether App Store screenshots, icon, localization, or metadata are affected.
- Whether Xcode beta-only behavior remains isolated from stable release builds.
