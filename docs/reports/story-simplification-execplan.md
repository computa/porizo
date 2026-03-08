# Story Simplification Refactor

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows the global ExecPlan standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

This refactor simplifies the story creation pipeline without changing the working product flow. After the change, the app should still let a user enter the same create flow, draft through conversation, review the story, continue into song or poem creation, and resume interrupted work. The difference is that the flow logic will be easier to reason about because it will rely on one canonical readiness contract, one canonical draft contract, and one explicit coordinator per product flow.

The first visible sign that this is working is that the app keeps the same behavior while the underlying code stops duplicating readiness decisions and stops centralizing orchestration inside `CreateFlowView.swift`.

## Progress

- [x] (2026-03-08 12:25 AWST) Committed the first simplification slice as `f7eaab8` to add a canonical story readiness contract across the backend and iOS story engine.
- [x] (2026-03-08 22:26 AWST) Introduced shared flow contracts for launch, setup, resume target, and typed resume state persistence.
- [x] (2026-03-08 22:26 AWST) Moved song-specific and poem-specific downstream state out of `CreateFlowView.swift` into dedicated flow structs and updated launch callers to use the shared contracts.
- [x] (2026-03-08 22:34 AWST) Added a canonical `StoryDraftSnapshot` on iOS and refactored the main story surfaces to consume it instead of re-deriving narrative/readiness fallback logic in each view.
- [ ] Extract song and poem coordinators so `CreateFlowView.swift` becomes composition instead of orchestration. Completed: flow state ownership and helpers moved; remaining: transition graph and async orchestration still live in `CreateFlowView.swift`.
- [ ] Split story engine responsibilities into draft, conversation, and sync layers.
- [ ] Remove legacy compatibility code after each migrated slice proves stable.

## Surprises & Discoveries

- Observation: `MainTabView.swift` already uses `.fullScreenCover(item:)` with a launch payload, which is the right presentation pattern and should be preserved.
  Evidence: `PorizoApp/PorizoApp/MainTabView.swift` has a private `CreateFlowLaunch` item and presents `CreateFlowView` from that payload.

- Observation: `CreateFlowView.swift` is not just a large view. It is also the current coordinator, setup store, resume controller, and part of the business layer.
  Evidence: The file owns setup state, story engine access, resume restoration, `buildMemoryAnswers()`, and downstream song/poem routing.

- Observation: the resume path is already typed enough to migrate safely.
  Evidence: `resumeTrackId`, `resumeVersionNum`, and `resumeTarget` already exist and can be lifted into shared launch contracts instead of being reinvented.

- Observation: extracting state is much easier than extracting transitions.
  Evidence: `CreateFlowView.swift` now delegates setup/song/poem state to dedicated types, but async transition decisions like `startStoryConversation()`, `completeStoryFlow()`, and resume restoration are still view-owned.

- Observation: story views were re-deriving the same fallback narrative and reviewability rules in more than one place.
  Evidence: both `AdaptiveConversationView.swift` and `StoryConfirmationView.swift` had their own `storyNarrative` logic before the draft snapshot was introduced.

## Decision Log

- Decision: Start the refactor by settling contracts before splitting implementations.
  Rationale: Splitting `CreateFlowView` first would preserve the same ambiguous semantics in cleaner files. The readiness contract had to land first.
  Date/Author: 2026-03-08 / Codex

- Decision: Keep the visible product flow unchanged while refactoring internal ownership.
  Rationale: The app is in active use and already has working song and poem paths. This refactor should reduce complexity, not force a migration of UX.
  Date/Author: 2026-03-08 / Codex

- Decision: Treat song and poem as separate coordinators after the shared setup step.
  Rationale: They share initial setup fields but diverge after story review. Forcing them into one coordinator would recreate the current coupling.
  Date/Author: 2026-03-08 / Codex

- Decision: Keep `StorySetup` plain and limited to shared gift inputs, while leaving story prompt drafts and downstream track state in the song flow type.
  Rationale: Prompt drafts, render policy state, and track/version references are not truly shared setup. Putting them into `StorySetup` would just rebuild the god-state object under a cleaner name.
  Date/Author: 2026-03-08 / Codex

- Decision: Type the persisted flow step as `CreateFlowState` instead of an untyped string.
  Rationale: The launch/resume contract should stay typed all the way through persistence, not just at the view entry point.
  Date/Author: 2026-03-08 / Codex

- Decision: Introduce `StoryDraftSnapshot` before the full engine split.
  Rationale: The story views were already paying a complexity tax for duplicated derivation logic. A canonical snapshot reduces that duplication immediately and gives the later draft/conversation store split a concrete client-side target shape.
  Date/Author: 2026-03-08 / Codex

## Outcomes & Retrospective

At the current checkpoint, the refactor has established the first critical contract: canonical readiness, removed `CreateFlowView` nested public launch types from the surrounding app surfaces, and introduced a canonical iOS draft snapshot for the main story views. The next outcome must be to move the transition graph itself out of `CreateFlowView.swift` so the new flow types stop being passive state holders and become actual coordinators.

## Context and Orientation

The current story creation flow is centered in `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`. That file currently owns:

- type selection between song and poem
- shared setup fields such as recipient, occasion, style, tone, and flags
- story engine integration via `V2StoryEngine`
- resume restoration through `CreateFlowStore`
- downstream state for songs and poems

The backend story reasoning lives in:

- `src/writer/v3/index.js`
- `src/writer/index.js`
- `src/routes/story.js`

The first simplification slice already added a canonical readiness block that now travels through:

- backend writer and route adapters
- iOS story response models
- `V2StoryEngine`

The next terms used in this plan mean:

- "launch contract": the typed payload used to open the create flow.
- "setup": the plain user inputs that describe the intended gift before story drafting begins.
- "coordinator": the object that decides which step comes next and owns flow-specific state transitions.

## Plan of Work

The next slice starts at the flow boundary. A new shared contracts file will define the setup and launch types currently hidden inside `CreateFlowView` and `MainTabView`. That includes the creation kind, resume target, and launch payload. `MainTabView`, the songs library, and the gift flow will adopt those shared types so `CreateFlowView` stops exporting nested enums as a public API.

After that contract extraction, `CreateFlowView` will stop owning raw setup fields directly. A plain `StorySetup` value will hold recipient, occasion, style, tone, and the lightweight song options. Song-specific and poem-specific state will move into dedicated coordinators so the view is reduced to rendering and dispatching.

The coordinators should be introduced without changing route signatures or render APIs. The song coordinator will own story completion to track-player handoff state. The poem coordinator will own story-to-poem handoff state. The resume store will continue to persist the same information, but its type model should align with the shared launch contracts instead of duplicating song/poem enums.

Cleanup must happen in the same slice. Once shared contracts exist, nested public enums inside `CreateFlowView` should be removed. Once the coordinators own state, dead helpers and duplicated state in `CreateFlowView` must be deleted instead of left behind as compatibility glue.

## Concrete Steps

From `/Users/ao/Documents/projects/porizo`:

1. Create a shared flow contracts file under `PorizoApp/PorizoApp/Flows/` with the setup, creation kind, resume target, and launch payload types.
2. Update `MainTabView.swift`, `SongsTabView.swift`, `MySongsView.swift`, and `GiftSendFlowView.swift` to use the shared contracts instead of `CreateFlowView` nested types.
3. Introduce separate song and poem coordinator files under `PorizoApp/PorizoApp/Flows/`.
4. Update `CreateFlowView.swift` to consume `StorySetup` plus the coordinators and remove duplicated public enum definitions and orphaned helpers.
5. Run:
   `npm run lint`
   `npm test`
   device build via XcodeBuildMCP

Expected evidence after this slice:

    git show --stat --oneline HEAD
    npm test
    ✅ iOS Device Build build succeeded for scheme PorizoApp.

## Validation and Acceptance

Acceptance for this slice is behavioral and structural.

Behaviorally:

- Starting create flow from home still opens the same song/poem flow.
- Resuming from My Songs still opens the correct stage.
- Gift flow can still launch song or poem creation.
- Story review still continues into song or poem creation.

Structurally:

- `MainTabView.swift`, `MySongsView.swift`, and `GiftSendFlowView.swift` no longer depend on nested `CreateFlowView` enum types.
- `CreateFlowView.swift` no longer exposes public nested launch/setup types.
- Song-specific and poem-specific downstream state are not mixed together inside the main view as raw fields.

## Idempotence and Recovery

The code changes in this plan are incremental and should compile after each sub-slice. The safe rollback point before this slice is commit `f7eaab8` for readiness and `2b4a4ca` for the last broader working product checkpoint. If the coordinator extraction introduces unexpected flow breakage, revert only the new refactor commit rather than resetting unrelated working tree changes.

## Artifacts and Notes

Current checkpoint before coordinator extraction:

    f7eaab8 Add canonical story readiness contract

Working target files for the next slice:

- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`
- `PorizoApp/PorizoApp/MainTabView.swift`
- `PorizoApp/PorizoApp/MySongsView.swift`
- `PorizoApp/PorizoApp/Tabs/SongsTabView.swift`
- `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift`
- `PorizoApp/PorizoApp/Services/CreateFlowStore.swift`
- `PorizoApp/PorizoApp/Flows/CreateFlowContracts.swift`
- `PorizoApp/PorizoApp/Flows/SongFlowCoordinator.swift`
- `PorizoApp/PorizoApp/Flows/PoemFlowCoordinator.swift`

## Interfaces and Dependencies

The shared contracts introduced by this slice must exist as first-class types rather than nested view implementation details.

Required end-state interfaces for this slice:

- `StorySetup`
- `CreateFlowKind`
- `CreateFlowResumeTarget`
- `CreateFlowLaunch`
- `SongFlowCoordinator`
- `PoemFlowCoordinator`

The coordinators may use Swift Observation or plain Swift value types, but they must not own API clients directly. Network and persistence should remain delegated to existing services for this slice.
