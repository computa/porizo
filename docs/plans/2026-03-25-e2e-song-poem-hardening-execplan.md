# E2E Song And Poem Flow Hardening

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not contain its own `PLANS.MD`, so this plan follows [`~/.codex/PLANS.MD`](/Users/ao/.codex/PLANS.MD).

## Purpose / Big Picture

After this change, the active song and poem creation flows should never leave a user stuck behind a dead player, a fake spinner, a blank poem, or a silent error. Every failure path in the active flow must end in a clear next action: retry, edit, return to chat, or exit. The way to see this working is to run the existing automated tests, then manually exercise the main song and poem flows and verify that each failure state has visible recovery.

## Progress

- [x] (2026-03-25 15:58 AWST) Audited active create-flow call sites and identified the remaining robustness gaps in error plumbing, poem task lifecycle, inline playback recovery, and poem output guards.
- [x] (2026-03-25 16:02 AWST) Created this ExecPlan/checklist before implementation so the remaining work is explicit and can be validated against the original hardening goal.
- [x] (2026-03-25 16:07 AWST) Implemented a pure friendly-message API in `ErrorHandler` and routed active unified-flow user-facing errors through it, including the coordinators that feed song and poem creation state.
- [x] (2026-03-25 16:08 AWST) Fixed `PoemCreatingView` cancellation semantics so backgrounding preserves work but explicit cancel stops work without late callbacks.
- [x] (2026-03-25 16:08 AWST) Added inline player playback error UI and made retry actually resume playback.
- [x] (2026-03-25 16:09 AWST) Added empty-poem fallback and deduplicated poem-audio error messaging.
- [x] (2026-03-25 16:09 AWST) Added focused regression tests for friendly error mapping and the empty-poem guard.
- [x] (2026-03-25 16:12 AWST) Ran `npm run lint`, `npm test`, iOS build, and iOS tests via XcodeBuildMCP after plain `xcodebuild test` hit a simulator-launch failure unrelated to app logic.

## Surprises & Discoveries

- Observation: The most important logical bug in the earlier plans was assuming `ErrorHandler` affected `error.localizedDescription`.
  Evidence: `APIClientError.errorDescription` in `PorizoApp/PorizoApp/APIClient.swift` directly returns the raw server message for `.serverError`.

- Observation: `PlaybackController.retryPlayback()` already exists, but it only reloads the URL and does not auto-play afterward.
  Evidence: `PorizoApp/PorizoApp/Controllers/PlaybackController.swift` calls `setupPlayer(url:)` but not `play()`.

- Observation: `PoemCreatingView` currently cancels work on every disappear, which treats backgrounding the same as explicit user cancel.
  Evidence: `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift` cancels `createTask` in `.onDisappear`.

## Decision Log

- Decision: Keep `ErrorHandler` as the single error categorization system and do not add a parallel `ServerErrorMapper`.
  Rationale: Two competing systems would drift and undermine the “friendly errors everywhere” goal.
  Date/Author: 2026-03-25 / Codex

- Decision: Fall back from resume failures to a safe editable state rather than a fake render state.
  Rationale: A wrong spinner is worse than a conservative fallback because it lies about attached work.
  Date/Author: 2026-03-25 / Codex

- Decision: Separate poem backgrounding from explicit cancel by removing disappear-cancel and moving cancel into the actual cancel action.
  Rationale: Backgrounding should preserve work; explicit cancel should stop work deterministically.
  Date/Author: 2026-03-25 / Codex

## Outcomes & Retrospective

Implemented and validated.

- Outcome: Active create-flow alerts now use `ErrorHandler` friendly messages instead of leaking raw `localizedDescription` in the main song and poem paths.
  Evidence: `UnifiedCreateFlowView.swift`, `StoryFlowCoordinator.swift`, `SongFlowCoordinator.swift`, and `PoemFlowCoordinator.swift` now route through `ErrorHandler.friendlyMessage(for:)`.

- Outcome: Poem creation now distinguishes backgrounding from explicit cancel, and canceled tasks cannot later re-enter the flow.
  Evidence: `PoemCreatingView.swift` removed disappear-cancel, added explicit cancel behavior, callback cancellation guards, and terminal task cleanup via `defer`.

- Outcome: Inline playback failures are visible and recoverable rather than looking like a dead player.
  Evidence: `InlinePlayerCard.swift` renders a playback error state with retry, and `PlaybackController.retryPlayback()` now resumes playback after reloading.

- Outcome: Blank poem output no longer renders as an empty card.
  Evidence: `PoemFullView.swift` now renders an explicit empty-content state when all verses are blank/whitespace.

- Outcome: Poem audio error copy is now consistent across preview and library surfaces.
  Evidence: `PoemPreviewView.swift` and `PoemsTabView.swift` both call `ErrorHandler.poemAudioErrorMessage(_:)`.

- Outcome: Focused regression tests back the new behavior.
  Evidence: `UnifiedCreateFlowTests.swift` now asserts friendly message mapping and `PoemFullView.hasRenderableVerses(_:)`.

- Validation evidence:
  - `npm run lint`: passed
  - `npm test`: passed (`278 passed`, `0 failed`, `7 skipped`)
  - `xcodebuild ... build`: passed (`** BUILD SUCCEEDED **`)
  - `xcodebuild ... test`: failed due to simulator launch flake (`No such process` while launching `porizo.ios.app.PorizoApp`)
  - `XcodeBuildMCP test_sim`: passed (`103 passed`, `0 failed`, `2 skipped`)

## Context and Orientation

The active end-to-end create flow lives in `PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift`. This SwiftUI view drives both the song path and the poem path. A “path” here means the full sequence a user experiences from creation through completion or failure recovery.

The inline song player used by the unified flow is `PorizoApp/PorizoApp/Flows/InlineCards/InlinePlayerCard.swift`. Its playback state comes from `PorizoApp/PorizoApp/Controllers/PlaybackController.swift`.

The poem generation loading screen is `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift`. Its completion surfaces are `PorizoApp/PorizoApp/PoemFullView.swift` and `PorizoApp/PorizoApp/Flows/PoemPreviewView.swift`. The poems library surface is `PorizoApp/PorizoApp/Tabs/PoemsTabView.swift`.

`PorizoApp/PorizoApp/Services/ErrorHandler.swift` is the shared service for turning raw errors into user-facing app errors. `PorizoApp/PorizoApp/Controllers/RenderController.swift` has its own specialized render-failure mapping that must remain intact.

The key rule for this work is simple: if a user cannot tell what to do next after something goes wrong, the flow is still broken.

## Plan of Work

First, extend `ErrorHandler` with a pure, reusable helper that returns friendly messages from any `Error` without needing to show a global alert. Then update `UnifiedCreateFlowView` so the active create flow uses that helper consistently instead of sprinkling `error.localizedDescription` into alerts.

Next, harden the poem creation lifecycle. `PoemCreatingView` must preserve work when the app disappears, but cancel immediately when the user explicitly exits. This requires moving cancellation into the cancel action, using `defer` to clear the task handle, and guarding every callback against a canceled task.

Then fix the inline song player so playback failures are visible and recoverable. The player should show an error state with retry instead of leaving dead controls on screen, and retry should actually reload and start playback.

After that, add an empty-poem fallback in the shared poem renderer and move duplicated poem-audio error mapping into `ErrorHandler` so the preview screen and poems tab stay consistent.

Finally, add focused regression tests for the new hardening behavior and run the full validation suite for both Node and iOS.

## Concrete Steps

Work from `/Users/ao/Documents/projects/porizo`.

1. Edit `PorizoApp/PorizoApp/Services/ErrorHandler.swift` to:
   - add code-aware mapping for key `APIClientError.serverError(code:)` values
   - add a pure `friendlyMessage(for:)` helper
   - add a shared `poemAudioErrorMessage(_:)` helper

2. Edit `PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift` to:
   - add helper methods for presenting friendly flow errors
   - replace active-flow raw `localizedDescription` alert assignments with those helpers
   - change resume failure to a safe, explicit fallback state
   - return poem creation failures to chat

3. Edit `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift` to:
   - remove automatic cancel-on-disappear
   - explicitly cancel and clear the task on user cancel
   - use `defer { createTask = nil }`
   - route user-facing errors through `ErrorHandler.friendlyMessage(for:)`

4. Edit `PorizoApp/PorizoApp/Controllers/PlaybackController.swift` and `PorizoApp/PorizoApp/Flows/InlineCards/InlinePlayerCard.swift` to:
   - make retry auto-play
   - render a visible playback error state with retry
   - disable or replace controls while in error state

5. Edit `PorizoApp/PorizoApp/PoemFullView.swift`, `PorizoApp/PorizoApp/Flows/PoemPreviewView.swift`, and `PorizoApp/PorizoApp/Tabs/PoemsTabView.swift` to:
   - add empty-poem fallback
   - remove duplicated poem-audio error mappers

6. Add or update regression tests in `PorizoApp/PorizoAppTests` for:
   - `ErrorHandler.friendlyMessage(for:)`
   - `PlaybackController.retryPlayback()` semantics
   - `PoemFullView` empty state

7. Run validation commands and capture evidence in this plan.

## Validation and Acceptance

Acceptance means a user can recover from every major failure in the active create flows without guessing.

Run:

    npm run lint
    npm test
    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test -only-testing:PorizoAppTests

Then manually verify:

    1. Fresh song create -> lyrics review -> Create Song -> full render -> player works.
    2. Playback error in inline player shows retry and no dead controls.
    3. Resume while offline shows an explicit reconnect error and does not show a fake spinner.
    4. Explicit cancel during poem generation does not later reopen poem state.
    5. Background during poem generation still lets work complete.
    6. Empty poem content renders an explicit message, not a blank card.
    7. Poem audio failures show the same message from preview and poems tab.

## Idempotence and Recovery

The code changes are safe to reapply because they are localized to create-flow surfaces and helpers. If one validation step fails, rerun it after fixing the cause; there is no destructive migration in this plan. If an iOS test flakes due to simulator state, rerun via the existing Xcode build tools rather than changing the logic blindly.

## Artifacts and Notes

Expected evidence to capture after implementation:

    - `npm test` exits 0 with the repository’s full test suite passing.
    - iOS build succeeds for `PorizoApp`.
    - iOS tests succeed for `PorizoAppTests`.
    - New targeted tests demonstrate the friendly-message mapping and empty-poem guard.

## Interfaces and Dependencies

`ErrorHandler` must remain the single shared error categorization service. `RenderController` keeps its own specialized render-failure mapping and should not be rewritten in this pass.

`PlaybackController` owns playback lifecycle and retry behavior. `InlinePlayerCard` is only responsible for presenting its state clearly.

`PoemCreatingView` owns the local async task for poem creation. The parent flow owns navigation state. The final implementation must preserve that boundary: the child cancels its own task; the parent decides which phase to show next.

Revision note: created specifically for the active song/poem E2E hardening pass after multiple review iterations exposed gaps in raw error plumbing and cancellation semantics.
