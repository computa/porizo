# Android Skip Clean Architecture Map

Date: 2026-07-04

## Current Shape

Porizo Android is currently a Skip app, not a Kotlin-first Android app. The Android Gradle project is the platform shell and build host, while the production app surface lives in `PorizoAndroid/Sources/PorizoSkipSpike`.

Current modules:

- `PorizoAndroid/Android/app`: Android application shell, Skip build plugin, native packaging, signing, and platform permissions.
- `PorizoAndroid/Sources/PorizoSkipSpike`: single Swift/Skip target containing UI, presentation state, domain decisions, API client, storage, and native bridge facades.
- `PorizoAndroid/Tests/PorizoSkipSpikeTests`: Swift tests for Skip-compatible logic.

This means a direct migration to Kotlin feature modules plus Hilt would not address the main dependency-boundary problem. Hilt can only wire Kotlin-owned Android classes unless the business logic is moved to Kotlin. The first architecture boundary must be in the Swift/Skip source.

## Target Dependency Flow

The Android app should converge on this dependency direction:

```text
Android app shell
  -> Skip app entry
    -> feature modules
      -> core UI
      -> domain use cases
        -> domain ports
          <- data implementations
            <- API client, stores, billing, push, recorder, share bridges
```

Allowed dependencies:

- Feature/UI can depend on domain, core model, and core UI.
- Domain can depend on core model only.
- Data can depend on domain ports, core model, and platform/native adapters.
- Android Gradle app can depend on Kotlin-native bridge implementations and the Skip output.

Disallowed dependencies:

- Domain code must not import SwiftUI, SkipFuse, Android bridge symbols, `UserDefaults`, `URLSession`, or billing/push/recorder APIs.
- Views and feature models must not instantiate transport clients directly.
- Data implementations must not import UI modules.
- Native bridge wrappers must stay behind protocol-shaped ports before crossing into feature code.
- Kotlin/Hilt classes must not become a parallel business-logic graph unless Android intentionally diverges from the shared Swift implementation.

## Target Swift Package Modules

When the single Skip target is split, use this order:

- `PorizoCoreModel`: shared value types such as occasions, tracks, poems, claims, share payloads, render status, and API DTOs that are intentionally stable.
- `PorizoDomain`: use cases and ports such as create story, render preview, claim gift, billing entitlement check, push registration, and storage policy.
- `PorizoData`: live implementations for HTTP, session storage, claim storage, billing, push, recorder, share, and persistence.
- `PorizoCoreUI`: design tokens, reusable controls, accessibility helpers, and non-feature presentation primitives.
- `PorizoFeatureCreate`: create flow views and presentation models.
- `PorizoFeatureLibrary`: songs, poems, playback, and saved content.
- `PorizoFeatureClaim`: share/claim entry and gift reveal.
- `PorizoFeatureSettings`: account, billing, push, diagnostics, and support.
- `PorizoApp`: composition root that wires live data implementations into feature entry points.

Until the package is split, use constructor injection inside `PorizoSkipSpike` and keep live dependencies at feature entry points.

## Hilt Policy

Do not add Hilt just to satisfy a checklist. Add Hilt only when there are Kotlin-owned dependencies that need lifecycle-aware Android injection, such as:

- `Application` setup for push, billing, or analytics SDKs.
- Kotlin bridge classes that own Android `Context`.
- Native service objects shared by multiple Android bridge entry points.
- Test replacement of Kotlin-native bridge implementations.

When Hilt is introduced:

- Keep Hilt modules in `PorizoAndroid/Android/app` or Kotlin-native Android modules.
- Use Hilt to provide Android `Context`, platform SDK wrappers, and bridge implementations.
- Keep Swift/Skip feature dependencies injected through Swift initializers or a Swift composition root.
- Do not expose Hilt-managed objects directly to domain code.

## Migration Sequence

1. Stop direct API client construction inside create, claim, auth, library, billing, push, and diagnostics presentation objects.
2. Add narrow domain ports for the flows that cross process, network, storage, billing, push, recorder, and share boundaries.
3. Move deterministic logic and use-case orchestration out of views and into domain or feature models.
4. Split `PorizoCoreModel` once DTO/model usage is stable.
5. Split `PorizoDomain` and `PorizoData`, moving `AndroidAPIClient` behind domain ports.
6. Split feature targets after their dependencies point only inward.
7. Introduce Hilt only for Kotlin-native bridge ownership, if the Android shell needs it.
8. Add architecture checks that fail on forbidden imports and direct client construction.

## First Enforced Rule

The create flow should receive its live dependencies through initializers. `AndroidCreateFlowModel` must not allocate a separate render API client; its default render model should share the injected create-flow client unless a test or preview supplies an alternate render model.

