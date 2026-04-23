# Harden Launch Config And First-Launch Sample Playback

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this change, Porizo should keep its launch and first-launch onboarding behavior stable even when unrelated code changes land. A local simulator build that cannot reach a local `/app/config` endpoint should still resolve the hosted onboarding sample correctly, `RootView` should consume one fully resolved config shape instead of rebuilding URLs ad hoc, and the onboarding sample-play decision should be testable without `AVPlayer` or a simulator. The result is that launch-flash and onboarding sample regressions become contract failures in tests or in a smoke script instead of surprises during manual QA.

## Progress

- [x] (2026-04-23 13:35 AWST) Inspected `APIClient+Billing`, `AppConfigResponse`, `RootView`, `OnboardingV2View`, and existing test files to identify the launch/config seams.
- [x] (2026-04-23 13:43 AWST) Centralized simulator debug fallback policy for `/app/config` in a pure `AppConfigLoadPolicy`.
- [x] (2026-04-23 13:48 AWST) Moved onboarding media URL resolution into `AppConfigResponse` so `RootView` only consumes fully resolved config.
- [x] (2026-04-23 13:55 AWST) Replaced `RootView`’s scattered onboarding config state with `RootAppConfigState`.
- [x] (2026-04-23 14:01 AWST) Added a pure `OnboardingSplashAudioPlan` so first-appear autoplay and play-fallback decisions no longer depend on a live `AVPlayer`.
- [x] (2026-04-23 14:08 AWST) Added contract tests for fallback policy, URL resolution, root onboarding state wiring, and autoplay trigger decisions.
- [x] (2026-04-23 14:12 AWST) Added a non-simulator smoke script at `tools/verify-app-config-smoke.js` and exposed it as `npm run appconfig:smoke`.
- [x] (2026-04-23 14:16 AWST) Ran `npm run appconfig:smoke`, a clean simulator build, and the full iOS XCTest suite successfully.

## Surprises & Discoveries

- Observation: The first local fix for simulator fallback was incomplete because hosted config returned relative media paths, and `RootView` rebuilt them against `AppConfig.apiBaseURL`, which still pointed to `localhost`.
  Evidence: `https://api.porizo.co/app/config` returned `"sample_audio_url": "/audio/cafeteria-light-trimmed.mp3"` while `RootView.refreshAppConfig` prefixed relative paths with `AppConfig.apiBaseURL`.

- Observation: `LivingSplashView` was not the broken surface. The missing first-launch sample came from config origin handling, not from the splash view disappearing.
  Evidence: `RootView` still routes through `.splash` and then into `.onboardingV2`; `OnboardingV2View` only starts audio when `splashDemoURL` resolves to a valid URL.

- Observation: Local simulator validation remains unreliable because `CoreSimulatorService` crashes intermittently in this environment.
  Evidence: repeated `xcodebuild test` and `simctl` runs failed with `CoreSimulatorService connection became invalid`.

## Decision Log

- Decision: Put fallback eligibility in a pure `AppConfigLoadPolicy` instead of leaving it buried in `APIClient`.
  Rationale: The behavior needs direct contract tests. Pure policy code is testable without network or simulator state.
  Date/Author: 2026-04-23 / Codex

- Decision: Resolve onboarding URLs when decoding/fetching app config and never in `RootView`.
  Rationale: A fetched config should already be “ready to use.” Rebuilding URLs in multiple layers is exactly what caused the regression.
  Date/Author: 2026-04-23 / Codex

- Decision: Introduce `RootAppConfigState` rather than leaving nine separate `@State` fields in `RootView`.
  Rationale: First-launch onboarding depends on a coherent bundle of related config. A single state object is easier to test and less likely to drift.
  Date/Author: 2026-04-23 / Codex

- Decision: Add a pure `OnboardingSplashAudioPlan` instead of trying to unit-test `AVPlayer` behavior.
  Rationale: The regression risk is the decision to attempt autoplay and show fallback UI, not Apple’s media framework.
  Date/Author: 2026-04-23 / Codex

- Decision: Add a network smoke script outside XCTest.
  Rationale: This explicitly avoids depending on simulator/manual QA for the public `/app/config` contract and catches backend drift earlier.
  Date/Author: 2026-04-23 / Codex

## Outcomes & Retrospective

The hardening pass is complete. Launch/onboarding config now has one source of truth, simulator debug fallback is explicit and testable, and first-launch autoplay decisions no longer depend on `AVPlayer` side effects to be verified. The public config contract is also covered by a smoke script, which removes simulator/manual QA as the only guardrail for this path.

The main remaining follow-up is operational: wire `npm run appconfig:smoke` into CI or release automation so the live onboarding sample contract is checked automatically before shipping.

## Context and Orientation

`PorizoApp/PorizoApp/APIClient+Billing.swift` fetches `/app/config`, which is the public remote configuration used by onboarding, STT routing, and update prompts. `PorizoApp/PorizoApp/Services/AppConfigResponse.swift` defines the decoded shape, including onboarding sample audio and question graph URLs. `PorizoApp/PorizoApp/RootView.swift` owns the cold-launch route through splash, onboarding, auth, and the main app. `PorizoApp/PorizoApp/Onboarding/OnboardingV2View.swift` starts the first-launch sample audio and renders the splash-to-questionnaire flow. The tests live under `PorizoApp/PorizoAppTests/`.

The regression we are hardening against was: simulator debug fell back to hosted `/app/config`, but relative onboarding media URLs were later rebuilt against `localhost`, so the first-launch sample audio disappeared locally even though the hosted config was valid.

## Plan of Work

First, make fallback behavior and config resolution pure and centralized. `APIClient.getAppConfig()` should return a fully resolved `AppConfigResponse`, and the decision to use hosted config during simulator debug should live in a pure policy helper. Second, collapse `RootView`’s onboarding-related config into one state object so onboarding and launch flash read from the same source of truth. Third, factor the autoplay/fallback decision in `OnboardingV2View` into a pure audio plan so tests can prove whether autoplay should be attempted on first appearance. Fourth, add focused regression tests that lock each behavior. Finally, add a smoke script that hits the live config endpoint and verifies the onboarding sample contract without needing a simulator.

## Concrete Steps

Run these commands from `/Users/ao/Documents/projects/porizo`.

Build the iOS app after code changes:

    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Debug -sdk iphonesimulator -derivedDataPath /tmp/porizo-config-fallback-build-2 build

Run the focused logic tests once the simulator service is healthy:

    xcodebuild test -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -only-testing:PorizoAppTests/AppConfigResponseTests -only-testing:PorizoAppTests/AppConfigLoadPolicyTests -only-testing:PorizoAppTests/RootAppConfigStateTests -only-testing:PorizoAppTests/OnboardingSplashAudioPlanTests

Run the live smoke check:

    npm run appconfig:smoke

Expected smoke output:

    [appconfig:smoke] PASS
    config: https://api.porizo.co/app/config
    stt.primary_provider: apple
    sample_audio_url: https://api.porizo.co/audio/cafeteria-light-trimmed.mp3

Observed validation:

    npm run appconfig:smoke
    [appconfig:smoke] PASS
    config: https://api.porizo.co/app/config
    stt.primary_provider: apple
    sample_audio_url: https://api.porizo.co/audio/cafeteria-light-trimmed.mp3

    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Debug -sdk iphonesimulator -derivedDataPath /tmp/porizo-launch-hardening-build build
    ** BUILD SUCCEEDED **

    xcodebuild test -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,id=8E29B537-7E71-44A8-BA8D-F221CF7CBC97'
    Executed 201 tests, with 2 tests skipped and 0 failures (0 unexpected)
    ** TEST SUCCEEDED **

## Validation and Acceptance

Acceptance means four things are true. First, `AppConfigLoadPolicy` falls back to hosted config only for the intended simulator debug failure modes, and tests prove that. Second, relative onboarding URLs are resolved against the actual fetched config origin, and tests prove that. Third, `RootView` consumes a single `RootAppConfigState` for first-launch onboarding and launch flash, and tests prove the state carries the resolved sample URL into onboarding. Fourth, the autoplay decision for onboarding sample audio is expressed as a pure `OnboardingSplashAudioPlan`, and tests prove the app attempts autoplay only when a playable sample URL exists. Separately, `npm run appconfig:smoke` must pass against the public config endpoint.

## Idempotence and Recovery

All code changes are safe to rerun. The smoke script is read-only. If simulator test infrastructure fails again with `CoreSimulatorService` errors, rerun the build and smoke script first, then retry the focused `xcodebuild test` command after restarting Simulator services. No migration or destructive data step is involved.

## Artifacts and Notes

Important implementation points:

    APIClient.getAppConfig() now uses AppConfigLoadPolicy.fallbackURL(...)
    AppConfigResponse.resolvingRelativeURLs(against:) returns hosted absolute URLs
    RootView.refreshAppConfig now assigns RootAppConfigState(response: response)
    OnboardingV2View computes OnboardingSplashAudioPlan.resolve(sampleURL:isAudioPlaying:)

## Interfaces and Dependencies

The change keeps using the existing `APIClient`, `AppConfigResponse`, `RootView`, and `OnboardingV2View` types. The new hardening logic introduces three pure interfaces inside existing source files:

- `AppConfigLoadContext` and `AppConfigLoadPolicy`, which decide when fallback is allowed.
- `RootAppConfigState`, which is the single onboarding/launch-flash config bundle consumed by `RootView`.
- `OnboardingSplashAudioPlan`, which decides whether autoplay and fallback UI should activate.

The smoke test uses Node’s built-in `fetch`, so no extra dependency is required beyond the existing Node runtime already used by the repository.

Revision note: created on 2026-04-23 to harden launch config and onboarding sample playback after the simulator/hosted-config regression.
