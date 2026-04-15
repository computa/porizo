# Implement YC Design Violations

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include its own `PLANS.MD`, so this document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this work, the most important shipped gaps from `docs/design/yc-design-violations-2026-04-13.md` will move from documented problems to observable product behavior improvements. A user who starts creating before authentication will keep their recipient context after signing in. A creator who reaches reveal will have sharing prepared before tapping Share. The app will stop leaking placeholder chrome and mismatched copy in key moments, and the outbound distribution copy will better explain why a recipient should click.

The work was executed in two code tranches on the same day. Tranche 1 handled `V1`, `V2`, `V4`, `V5`, `V6`, `V7`, and `V8`. Tranche 2 handled the route-behavior change in `V3`, the ownership-versus-public-listening work in `V9`, and the adjacent backend share-path defect `T1`.

## Progress

- [x] (2026-04-13 15:32 AWST) Read `~/.codex/PLANS.MD`, inspected worktree state, and confirmed the current violation list.
- [x] (2026-04-13 15:46 AWST) Reviewed the current implementations for `V1`, `V2`, `V4`, `V5`, `V6`, `V7`, and `V8` and identified the minimal safe edits.
- [x] (2026-04-13 16:08 AWST) Implemented `V1` pre-auth carry-through without regressing the current Name Entry → Auth → Main routing.
- [x] (2026-04-13 16:12 AWST) Implemented `V2` eager share-link generation on reveal entry for the full-render path.
- [x] (2026-04-13 16:18 AWST) Implemented copy and chrome cleanup for `V4`, `V5`, and `V6`.
- [x] (2026-04-13 16:25 AWST) Implemented distribution copy improvements for `V7` OG metadata and `V8` share-sheet message text.
- [x] (2026-04-13 16:54 AWST) Ran relevant validation commands (`npm run lint`, `npm test`, iOS build/test) and recorded evidence.
- [x] (2026-04-13 16:57 AWST) Updated `docs/design/yc-design-violations-2026-04-13.md` checklist items completed in this tranche.
- [x] (2026-04-13 21:18 AWST) Fixed the backend share playlist/share-path 500 by guarding local HLS path construction and tightening the HLS contract test.
- [x] (2026-04-13 21:34 AWST) Implemented `V3` reveal/player settle so reveal actions no longer bounce directly to Songs.
- [x] (2026-04-13 21:42 AWST) Implemented `V9` by preserving a public browser listening surface after claim when web streaming remains allowed.
- [x] (2026-04-13 22:06 AWST) Re-ran `npm run lint`, `npm test`, iOS simulator build, and iOS simulator tests after tranche 2 changes.

## Surprises & Discoveries

- Observation: The worktree is already dirty in many design-related files, including some files touched by the validation harness work.
  Evidence: `git status --short` showed existing modifications in `OnboardingView.swift`, `ExploreTabView.swift`, `WaitPulseView.swift`, and `InlineCreatingCard.swift` before this tranche started.

- Observation: Several of those existing diffs add accessibility identifiers only, which aligns with the validation-harness plan and should be preserved.
  Evidence: `git diff -- <relevant files>` showed only accessibility identifier additions in the affected UI files.

- Observation: Adding `initialRecipientName` to `CreateFlowBootstrapAction.resolve(...)` broke the existing robustness tests until the new argument was threaded through the test call sites.
  Evidence: `test_sim` initially failed in `WarmCanvasFlowRobustnessTests.swift` with missing-argument compiler errors before the tests were updated.

- Observation: Full backend tests still surface the previously known playlist/share-path 500 during the HLS share route exercise, but the suite does not fail on it.
  Evidence: `npm test` logged `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined` from `getVersionDir` while still exiting successfully.

- Observation: The share embed tests were coupled to the old assumption that claim should kill web playback, so they had to be rewritten to validate the new product rule instead of the old implementation detail.
  Evidence: `test/share-flow.test.js` and `test/share-embed.test.js` both encoded “claimed share requires app/no browser stream” expectations until tranche 2 updated them.

## Decision Log

- Decision: Implement the violations in two tranches instead of one monolithic change.
  Rationale: `V3` and `V9` change route semantics and public-listening semantics and carry more product risk than the copy/state fixes. Shipping the lower-risk tranche first produces user-visible wins without destabilizing the flow.
  Date/Author: 2026-04-13 / Codex

- Decision: Preserve existing accessibility-id additions in UI files and build on top of them.
  Rationale: They support the validation harness and do not conflict with the design fixes.
  Date/Author: 2026-04-13 / Codex

- Decision: Implement `V3` with the smallest correct route change instead of a full reveal-flow architecture rewrite.
  Rationale: The real product requirement is “do not eject on reveal actions.” Opening the full player inside the flow and moving exit behind an explicit close action satisfies that without destabilizing the broader create flow.
  Date/Author: 2026-04-13 / Codex

- Decision: Implement `V9` inside the current token model first, rather than inventing a second public-listen token in the same tranche.
  Rationale: The product rule is that claiming must not kill browser listening. Preserving read-only claimed playback behind the existing share token solves the user-facing problem now. A separate public-listen token can remain a later refinement if abuse or lifecycle concerns justify it.
  Date/Author: 2026-04-13 / Codex

## Outcomes & Retrospective

Implemented the lower-risk tranche successfully:

- `V1` now carries recipient, occasion, and type across Name Entry → Auth → Main and auto-launches the create flow once with the pending context.
- `V2` now prepares the share link as reveal is entered and also when reveal is reconstructed from a resumed flow.
- `V4`, `V5`, and `V6` are cleaned up in the UI.
- `V7` and `V8` now use stronger human-facing framing in OG tags and share-sheet copy.

Validation evidence:

- `npm run lint` → passed
- `npm test` → passed
- iOS simulator build (`PorizoApp`) → passed
- iOS simulator tests (`PorizoApp`) → passed after updating robustness tests for the new bootstrap argument

Still open by design for a later tranche:
- behavioral validation via the dedicated harness
- potential future refinement of `V9` into a dedicated public-listen token/link model

Behavioral validation through the dedicated validation harness remains pending even though compile/test validation is green.

Additional tranche 2 outcomes:

- `T1` backend share playlist/share route no longer 500s when local storage context is missing; the HLS contract test now requires `200/409` instead of tolerating `500`.
- `V3` reveal now behaves like a route instead of a bounce point:
  - `Listen with lyrics` opens `TrackPlayerFullView`
  - `Save to library` is acknowledged in place
  - share returns to reveal instead of dismissing to Songs
  - explicit exit is on the reveal close action
- `V9` now preserves public browser listening after claim when `web_stream_allowed` remains true:
  - claimed `/share/:id` responses can include `web_stream_url`
  - claimed `/share/:id/stream` can serve public preview playback for browser listeners
  - wrong-device app/device-token access still returns access denial

## Context and Orientation

The implementation target is documented in `docs/design/yc-design-violations-2026-04-13.md`. The iOS app entry flow starts in `PorizoApp/PorizoApp/RootView.swift`, which routes between onboarding, name entry, authentication, and the main tabs. `PorizoApp/PorizoApp/MainTabView.swift` owns create-flow launching via `CreateFlowLaunch` in `PorizoApp/PorizoApp/Flows/CreateFlowContracts.swift`.

The reveal and share path for song creation lives in `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift`. The share message content is centralized in `PorizoApp/PorizoApp/Controllers/ShareController.swift`.

The recipient share link metadata is generated by the backend route in `src/routes/sharing.js`.

The violations in scope for the full implementation pass are:

- `V1`: pre-auth personalization is lost after auth.
- `V2`: share link is generated lazily instead of being ready at reveal.
- `V4`: wait-state copy says “2 minutes” instead of reinforcing “90 seconds”.
- `V5`: dead Explore chrome and explicit progress percent.
- `V6`: onboarding secondary CTA label mismatch.
- `V7`: social preview metadata is too generic.
- `V8`: outbound share-sheet message is too generic.
- `V9`: claiming should not kill the browser listening surface.
- `T1`: share playlist/share route can 500 on missing local path context.

## Plan of Work

First, inspect the exact data flow for pre-auth values and create-flow launch to determine the smallest state-carrying change that survives auth without introducing stale data. That means extending `CreateFlowLaunch` and `StorySetup` input wiring only as far as necessary, and clearing the pending values after they are consumed.

Second, wire eager share-link generation into the reveal transition path in `WarmCanvasFlowView.swift`. The change must be idempotent so repeat reveal transitions or resume flows do not trigger unnecessary duplicate work.

Third, clean up the copy and chrome issues in the existing UI files while preserving the already-added accessibility identifiers used by the validation harness.

Fourth, improve distribution copy in two places: backend OG metadata for recipient links and the iOS share-sheet message template.

Finally, run lint, backend tests, and relevant iOS validation and update the violation document to reflect what the implementation pass actually shipped.

## Concrete Steps

Work from `/Users/ao/Documents/projects/porizo`.

1. Inspect the current implementations:
   - `RootView.swift`
   - `MainTabView.swift`
   - `CreateFlowContracts.swift`
   - `WarmCanvasFlowView.swift`
   - `WaitPulseView.swift`
   - `ExploreTabView.swift`
   - `InlineCreatingCard.swift`
   - `OnboardingView.swift`
   - `ShareController.swift`
   - `src/routes/sharing.js`

2. Edit the smallest set of files needed with `apply_patch`.

3. Run:

   `npm run lint`

   `npm test`

   If the iOS files changed in the final patch set, also run the simulator build/test using the already-discovered `PorizoApp/PorizoApp.xcodeproj` project and `PorizoApp` scheme.

4. Record short evidence snippets in this plan and update the violation checklist document.

## Validation and Acceptance

Acceptance is user-visible:

- A user who enters `Sarah` and `Birthday` before auth sees those values preserved when they continue creating after auth.
- A reveal state has share prepared before the first share tap.
- The wait state reinforces `90 seconds`.
- Explore no longer exposes dead placeholder actions.
- Creating state no longer shows an explicit `%` progress label.
- The onboarding secondary CTA no longer lies about routing to sign-in.
- Shared links present more specific recipient/sender framing.
- The share sheet message reads like a human gift message rather than generic product copy.

Validation commands:

- `npm run lint`
- `npm test`
- iOS build/test after patch set completion

## Idempotence and Recovery

These edits are safe to reapply by rerunning this plan’s file inspections and `apply_patch` hunks. If a particular change causes UX or test regressions, revert only the affected hunk rather than resetting the worktree, because this repository contains many unrelated local modifications.

For backend/share-copy changes, recovery is straightforward because they are isolated string and metadata-generation edits. For pre-auth carry-through and reveal eager-sharing, recovery means reverting the specific state-passing fields and callbacks if a regression appears.

## Artifacts and Notes

- Code changes:
  - `PorizoApp/PorizoApp/RootView.swift`
  - `PorizoApp/PorizoApp/MainTabView.swift`
  - `PorizoApp/PorizoApp/Flows/CreateFlowContracts.swift`
  - `PorizoApp/PorizoApp/Flows/CreateFlowTypes.swift`
  - `PorizoApp/PorizoApp/Flows/RevealBloomView.swift`
  - `PorizoApp/PorizoApp/Flows/WarmCanvasFlowView.swift`
  - `PorizoApp/PorizoApp/Flows/WaitPulseView.swift`
  - `PorizoApp/PorizoApp/Tabs/ExploreTabView.swift`
  - `PorizoApp/PorizoApp/Flows/InlineCards/InlineCreatingCard.swift`
  - `PorizoApp/PorizoApp/OnboardingView.swift`
  - `PorizoApp/PorizoApp/Controllers/ShareController.swift`
  - `PorizoApp/PorizoApp/MySongsView.swift`
  - `PorizoApp/PorizoApp/TrackPlayerFullView.swift`
  - `PorizoApp/PorizoAppTests/WarmCanvasFlowRobustnessTests.swift`
  - `src/server.js`
  - `src/routes/sharing.js`
  - `web-player/player.js`
  - `test/streaming/hls-cloudfront.test.js`
  - `test/share-flow.test.js`
  - `test/share-embed.test.js`
- Updated audit:
  - `docs/design/yc-design-violations-2026-04-13.md`

## Interfaces and Dependencies

The key interface change in this tranche is likely `CreateFlowLaunch` gaining recipient-context fields so `MainTabView` can start a create flow with values captured before auth. The reveal path in `WarmCanvasFlowView.swift` must continue to use `ShareController.generateShareLink(trackId:versionNum:)` rather than inventing a second sharing API path.

The backend OG metadata work must stay inside `src/routes/sharing.js` because that route already owns injected HTML metadata for recipient links. The share-sheet copy work must stay inside `ShareMessageContent` so all iOS sharing surfaces inherit the same improved wording.
