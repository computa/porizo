# iOS SwiftUI Release Workflow

Last reviewed: 2026-06-09

This workflow defines how Porizo adopts new Xcode/iOS releases and how SwiftUI
changes move from implementation to release readiness. It is intentionally
conservative: stable release builds stay on the stable Xcode line, while beta
SDK work runs in a separate compatibility lane until Apple makes it mandatory.

## Goals

- Keep Porizo shippable on the current stable Xcode release.
- Detect iOS 27 and future SDK breakage early without letting beta tooling leak
  into production release builds.
- Make SwiftUI implementation, previews, accessibility, performance, simulator
  validation, and App Store screenshot impact a single repeatable system.

## Required Skills

Use `porizo-swiftui-release-workflow` as the entry point for app UI work. It
coordinates these companion skills:

- `swiftui-ui-patterns`: implementation and refactor patterns.
- `swiftui-pro`: modern API, navigation, data flow, accessibility, performance,
  and hygiene review.
- `swiftui-performance-audit`: runtime performance review and Instruments plan.
- `porizo-simulator-testing`: fixture launch and simulator flow verification.
- `app-store-screenshots` and `screenshot-optimization`: App Store visual impact.
- `app-icon-optimization`: Icon Composer or app icon changes.
- `localization`: app and App Store localization.

## Xcode Adoption Policy

### Stable Lane

Use the stable Xcode 26.x line for App Store and TestFlight builds unless
Ambrose explicitly requests otherwise or Apple changes upload requirements.
As of this review, Xcode 26.5 includes Swift 6.3 and the 26.5 SDKs.

Any app built with Xcode 26.4 that uses MetricKit should be rebuilt with Xcode
26.4.1 or newer, because Apple fixed missing-symbol crashes on OS versions below
26.4 in that update.

### Beta Compatibility Lane

Use Xcode 27 beta only for compatibility discovery, previewing new APIs, and
planning migrations. Do not use it for production release builds.

Key beta constraints to remember:

- Xcode 27 beta requires macOS Tahoe 26.4 or later.
- Xcode 27 beta installs and runs only on Apple silicon Macs.
- Xcode 27 beta supports on-device debugging from iOS 17, tvOS 17, watchOS 10,
  and visionOS. Keep Xcode 26.x available for iOS 15 and iOS 16 debugging.
- The `ld64` linker is removed and `-ld_classic` is no longer supported.
- The iOS 27 SDK requires scene-based UIKit apps. Porizo is SwiftUI-based, but
  any UIKit lifecycle remnants should be treated as migration risk.

## SwiftUI Implementation Gate

Before editing SwiftUI code, identify:

- Flow: onboarding, create, reveal, library, playback, share, paywall, settings.
- Risk: auth, billing, persistence, voice enrollment, share/device claim, App
  Store screenshot state, or visual-only.
- Release lane: stable shipping, beta compatibility, or prototype.

Follow these rules while coding:

- Prefer SwiftUI-native state: `@State`, `@Binding`, `@Observable`, and
  `@Environment`.
- Keep local UI state local and shared dependencies environment-injected.
- Use `.sheet(item:)` or `.fullScreenCover(item:)` for selected-payload flows.
- Avoid Boolean presentation state plus a separate payload, because it can launch
  stale or empty data.
- Keep views small and feature-scoped.
- Avoid UIKit unless the existing file already owns the bridge or Ambrose asks
  for UIKit explicitly.
- Do not introduce third-party UI frameworks without approval.

## Preview Matrix

Important Porizo screens should have previews or fixture states for:

- Empty state.
- Loading state.
- Error state.
- Populated state.
- Long recipient names.
- Long generated poem/song copy.
- Light and dark appearance.
- Normal and accessibility Dynamic Type sizes.
- Small iPhone and large iPhone.
- App Store screenshot states when the screen appears in marketing assets.

Prioritize this matrix for:

- First open and onboarding.
- Create flow and story/occasion inputs.
- Voice enrollment.
- Paywall and purchase confirmation.
- Creating/progress screens.
- Reveal and playback.
- Share postcard and recipient claim.
- Library, poems, songs, and settings.

## Accessibility Gate

Every app-facing UI change should confirm:

- Icon-only controls have accessible names.
- Primary actions are discoverable by VoiceOver.
- VoiceOver reading order follows the task flow.
- Dynamic Type does not clip controls, generated text, or paywall pricing.
- Reduce Motion still communicates reveal/progress/playback state.
- Color and contrast do not rely on one hue family or low-contrast gold-on-dark
  combinations.

## Performance Gate

During implementation and review, check for:

- Sorting, filtering, formatter creation, image decoding, or network work in
  `body`.
- Unstable `ForEach` identity.
- Root view swaps where a local conditional would preserve identity.
- Broad observable models invalidating large subtrees.
- Deep layout stacks, large `GeometryReader` use, or preference chains.
- Large images without downsampling.
- Implicit animations applied to broad hierarchies.

For release candidates or high-risk UI changes, collect before/after evidence
with Instruments when practical:

- SwiftUI instrument.
- Time Profiler or CPU Profiler.
- Animation Hitches.
- Swift Concurrency instruments for async flow regressions.
- Run Comparison for before/after traces.

## Simulator And Device Gate

Use `porizo-simulator-testing` for simulator validation. Do not guess tap
coordinates from screenshots; use UI snapshots and element references.

Minimum simulator checks for visible UI changes:

- App launches with `--bypass-auth`.
- The changed screen is reachable from a fixture or normal flow.
- The primary happy path works.
- Empty/error states remain coherent.
- Screens that affect screenshots still match the intended marketing state.

For production-risk flows, prefer one real-backend validation pass:

- Voice enrollment.
- Create flow.
- Purchase/paywall.
- Reveal and playback.
- Share link creation.
- Recipient claim/device binding.

## Organizer And Release Metrics

For release candidates, inspect available Organizer, crash, and analytics signals
before shipping:

- Launch time.
- Hangs.
- Animation hitches.
- Battery usage.
- Disk writes.
- Storage footprint.
- Crashes in onboarding, create, reveal, playback, share, and paywall flows.

If Organizer generates recommendations, treat them as triage input, not an
automatic patch. Apply normal review, tests, and simulator validation before
accepting agent-generated fixes.

## App Store Asset Gate

Any visible change to onboarding, create, reveal, playback, share, library, or
paywall screens must answer:

- Does this change alter current App Store screenshots?
- Does the screenshot narrative still sell one clear idea per slide?
- Are localized screenshots affected?
- Does the app icon still render correctly in current and next-generation Icon
  Composer previews?
- Does the first three screenshots still explain Porizo without scrolling?

Use the screenshot and icon skills when the answer is yes.

## Localization Gate

Use Xcode String Catalogs for app UI strings. Agent-assisted translation is
acceptable for draft localization, but human review is required for:

- App Store metadata.
- Screenshot copy.
- Paywall copy.
- Voice/consent/security copy.
- Emotional poem/song creation language.

Do not treat translated keywords as direct translations of English keywords.
Run market-specific keyword research for App Store metadata.

## Validation Summary Template

Use this in PRs, handoffs, or final agent responses for SwiftUI work:

```
SwiftUI workflow:
- Implementation skill(s):
- Review skill(s):
- Preview states checked:
- Accessibility checks:
- Simulator/device checks:
- Tests/builds run:
- Performance evidence:
- App Store asset impact:
- Localization impact:
- Xcode lane: stable / beta compatibility / prototype
```

## References

- Apple Xcode updates: https://developer.apple.com/documentation/updates/xcode
- Xcode release notes: https://developer.apple.com/documentation/xcode-release-notes
- Porizo simulator workflow: `docs/dev/simulator-testing.md`
- Pre-TestFlight checklist: `docs/pre-testflight-distribution-checklist.md`
