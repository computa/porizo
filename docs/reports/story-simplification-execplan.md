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
- [x] (2026-03-08 22:55 AWST) Delegated resume setup, story completion handoff, and the remaining simple song/poem transition helpers from `CreateFlowView.swift` into `SongFlowCoordinator` and `PoemFlowCoordinator`.
- [x] (2026-03-08 23:20 AWST) Introduced `StorySyncService` so `V2StoryEngine` no longer owns raw story API calls or persisted-session I/O directly.
- [x] (2026-03-08 23:30 AWST) Split `V2StoryEngine` storage into explicit `StoryDraftStore` and `StoryConversationStore` backings while preserving the current engine API for callers.
- [x] (2026-03-08 23:42 AWST) Moved session snapshotting, draft metadata application, reset/restore logic, and prompt/resume-note helpers onto the draft and conversation stores.
- [x] (2026-03-08 23:46 AWST) Moved create-flow setup hydration from sessions, engine state, and variation sources into `StorySetup` so `CreateFlowView.swift` no longer manually reconstructs those values.
- [x] (2026-03-08 23:52 AWST) Collapsed create-flow bootstrap and resume branching into a pure `CreateFlowBootstrapAction` resolver and typed story-conversation resume state constructor.
- [x] (2026-03-09 00:31 AWST) Extracted `CreateFlowAsyncService` so `CreateFlowView.swift` no longer directly owns raw background-task-wrapped calls for story start, voice-mode updates, or poem-gap detail submission.
- [x] (2026-03-09 00:34 AWST) Fixed the full-suite PostgreSQL migration-runner flake by making the pool connection timeout configurable and raising the migration-runner harness timeout under load.
- [x] (2026-03-09 00:42 AWST) Moved `StoryContext` assembly and transcript-to-`MemoryAnswer` parsing out of `SongFlowCoordinator` so the story layer now owns downstream handoff construction.
- [x] (2026-03-09 01:00 AWST) Extracted `CreateFlowResumeCoordinator` so resume persistence, restored-story hydration, and restored-story refresh are no longer implemented inline in `CreateFlowView.swift`.
- [x] (2026-03-09 01:12 AWST) Extracted `StoryFlowCoordinator` and pushed voice-selection / poem-gap async step transitions onto the song and poem coordinators so `CreateFlowView.swift` no longer directly implements those live transition branches.
- [x] (2026-03-09 09:48 AWST) Extracted `CreateFlowLifecycleCoordinator` so retry/start-over, reset, unwind, and dismissal cleanup no longer live inline in `CreateFlowView.swift`.
- [x] (2026-03-09 10:06 AWST) Moved merged-setup continue, custom-create cancel, lyrics approval/back, and reroll version bookkeeping decisions behind the song coordinator so `CreateFlowView.swift` no longer owns those downstream branch rules directly.
- [x] (2026-03-09 10:13 AWST) Reduced `CreateFlowView.swift` to switch-level composition by extracting the story/song/poem downstream cases into dedicated content builders instead of embedding every branch inline in `flowContent`.
- [x] (2026-03-09 10:24 AWST) Moved draft-derivation helpers (`currentNarrative`, `currentBeats`, `draft` snapshot, `StoryContext` assembly) and transcript mutation primitives onto the draft/conversation stores, leaving `V2StoryEngine` with less cross-domain ownership.
- [x] (2026-03-09 11:08 AWST) Moved the local story/song/poem content builders out of `CreateFlowView.swift` into dedicated composition views so the flow container remains the router instead of carrying every downstream branch body inline.
- [x] (2026-03-09 11:10 AWST) Final cleanup pass completed for this simplification phase.

## Remaining Tasks

1. Extract create-flow lifecycle/reset/unwind policy out of `CreateFlowView.swift`.
   Status: complete.
2. Extract the remaining downstream callback and branch policy into the song/poem/story coordinators.
   Scope: lyrics approval/back, post-render actions, poem-ready/gap/regenerate routing, and any remaining flow-state decisions that are still view-owned.
3. Reduce `CreateFlowView.swift` to composition and simple dispatch only.
   Scope: keep rendering, wiring, and local UI state; remove coordinator-shaped branching and setup/control helpers.
4. Run final validation, install on device, and commit the completed simplification slice.

## Surprises & Discoveries

- Observation: `MainTabView.swift` already uses `.fullScreenCover(item:)` with a launch payload, which is the right presentation pattern and should be preserved.
  Evidence: `PorizoApp/PorizoApp/MainTabView.swift` has a private `CreateFlowLaunch` item and presents `CreateFlowView` from that payload.

- Observation: `CreateFlowView.swift` is not just a large view. It is also the current coordinator, setup store, resume controller, and part of the business layer.
  Evidence: The file owns setup state, story engine access, resume restoration, `buildMemoryAnswers()`, and downstream song/poem routing.

- Observation: the resume path is already typed enough to migrate safely.
  Evidence: `resumeTrackId`, `resumeVersionNum`, and `resumeTarget` already exist and can be lifted into shared launch contracts instead of being reinvented.

- Observation: extracting state is much easier than extracting transitions.
  Evidence: `CreateFlowView.swift` now delegates setup/song/poem state to dedicated types, but async transition decisions like `startStoryConversation()`, `completeStoryFlow()`, and resume restoration are still view-owned.

- Observation: once the coordinators own plain transition helpers, the remaining debt becomes more obvious.
  Evidence: the remaining `CreateFlowView.swift` orchestration is now concentrated in async API lifecycles and cancellation/error routing rather than scattered one-line state changes.

- Observation: the first meaningful engine split boundary is infrastructure, not draft logic.
  Evidence: `V2StoryEngine` was still directly owning background-task-wrapped API calls and persisted session storage, which can be extracted without changing any draft semantics.

- Observation: state extraction is safe before logic extraction if the engine API stays stable.
  Evidence: `V2StoryEngine` now stores draft and conversation data in separate backing stores, but the existing view and flow code still compiles against the same public engine properties.

- Observation: the next valuable engine cleanup is moving logic clusters, not more raw fields.
  Evidence: after the latest slice, `V2StoryEngine` still owns high-level turn orchestration and response mapping, but the low-level draft/conversation bookkeeping has been pushed into the stores.

- Observation: `CreateFlowView.swift` still has real orchestration debt, but some of its remaining verbosity was just repeated setup hydration.
  Evidence: session restore, variation-source launch, preselected occasion handling, and server-refresh sync were each rebuilding `StorySetup` inline before the new helper methods moved that logic to the setup contract.

- Observation: launch/resume branching is much easier to simplify than the async flow graph because it is pure decision logic.
  Evidence: resume-track, variation-source, restored-story, restored-poem, and fresh-start routing now sit behind a single pure resolver with no API calls or UI side effects.

- Observation: after the pure bootstrap routing is extracted, the next low-risk cleanup is infrastructure ownership, not transition ownership.
  Evidence: `CreateFlowView.swift` was still directly wrapping `BackgroundTaskManager` around story-start, voice-mode update, and poem-gap detail calls even though those are service concerns, not view concerns.

- Observation: the PostgreSQL migration-runner suite is still load-sensitive in the full repo run unless its pool connection timeout is allowed to exceed the default five seconds.
  Evidence: `npm test` failed in `test/database/migration-runner.test.js` on `DROP TABLE IF EXISTS ...` with `Connection terminated due to connection timeout`, then passed after the test harness opted into a longer timeout via `createPool({ connectionTimeoutMillis: 15000 })`.

- Observation: `SongFlowCoordinator` was still violating the intended boundaries even after the earlier coordinator extractions.
  Evidence: it was parsing `V2Message` history into `MemoryAnswer` objects and reading multiple engine fields to assemble `StoryContext`, which is story-domain logic rather than downstream flow state.

- Observation: restored-story resume behavior was still split across pure bootstrap resolution and view-owned side effects.
  Evidence: `CreateFlowView.swift` was still directly saving resume state, restoring `V2Session` into the engine, rebuilding setup/song prompt state, and handling the follow-up server refresh, even after launch routing had already been extracted.

- Observation: the remaining active transition graph was narrower than it first looked after the earlier slices.
  Evidence: once resume, setup hydration, bootstrap routing, async services, and story-context assembly were extracted, the remaining live branches clustered around story start, story completion, voice selection, and poem-gap submission.

- Observation: after the lifecycle cut, the remaining `CreateFlowView.swift` debt is no longer reset/unwind policy. It is callback routing and branch ownership.
  Evidence: retry/start-over, poem cancel/done, and create-flow dismissal now pass through `CreateFlowLifecycleCoordinator`, leaving the remaining inline work concentrated in screen callbacks.

- Observation: `CreateFlowView.swift` is now more of a composition root than a coordinator, but it is still large because the content builders remain local to the file.
  Evidence: this was true after the first composition pass; the downstream content builders now live in separate composition views, so the remaining size is mostly the setup UI and flow wiring.

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

- Decision: Move simple transition helpers into the coordinators before attempting the full async orchestration split.
  Rationale: This trims low-value state policy out of `CreateFlowView.swift` immediately and isolates the next slice to the genuinely hard part: async flow control and side effects.
  Date/Author: 2026-03-08 / Codex

- Decision: Extract `StorySyncService` before drafting the full conversation/draft store split.
  Rationale: Sync and persistence were the cleanest separable responsibilities inside `V2StoryEngine`. Pulling them first reduces engine surface area without forcing a premature redesign of draft/conversation ownership.
  Date/Author: 2026-03-08 / Codex

- Decision: Preserve the current engine API while splitting storage into draft and conversation stores.
  Rationale: The story screens and flow container still read engine properties directly. Keeping that surface stable lets the refactor remove internal coupling first, then migrate logic ownership in smaller follow-up slices.
  Date/Author: 2026-03-08 / Codex

- Decision: Move session snapshotting and restore/reset helpers onto the stores before touching response-mapping logic.
  Rationale: Those helpers were pure state bookkeeping and could move cleanly without changing the story runtime behavior. That reduces engine size while keeping the trickier API/turn logic centralized for now.
  Date/Author: 2026-03-08 / Codex

- Decision: Push setup hydration rules into `StorySetup` instead of inventing another bootstrap object.
  Rationale: The repeated logic was simple value construction from session, engine, and poem inputs. Adding another coordinator or bootstrap type would have been extra indirection for little gain.
  Date/Author: 2026-03-08 / Codex

- Decision: Introduce a pure `CreateFlowBootstrapAction` resolver for launch/resume routing.
  Rationale: The initialization branches in `CreateFlowView` were coordinator logic but still pure. Moving them behind a typed resolver makes the view smaller and creates a clean boundary before tackling the harder async graph.
  Date/Author: 2026-03-08 / Codex

- Decision: Extract a `CreateFlowAsyncService` before attempting the full async transition-graph split.
  Rationale: Raw API/background-task wrappers were the easiest async concern to remove from `CreateFlowView` without changing any state transition semantics. That keeps the next coordinator slice focused on flow decisions rather than infrastructure plumbing.
  Date/Author: 2026-03-09 / Codex

- Decision: Fix the flaky PostgreSQL migration-runner test by making pool connection timeout configurable instead of inflating the global default.
  Rationale: The failure appeared only under full-suite load. Opting the harness into a longer timeout addresses the real test constraint without silently changing production pool behavior.
  Date/Author: 2026-03-09 / Codex

- Decision: Move `StoryContext` construction into the story layer before attempting another `CreateFlowView` coordinator cut.
  Rationale: That removes a real cross-boundary leak immediately. It also makes the remaining `SongFlowCoordinator` closer to its intended role: downstream flow state and transitions, not transcript parsing or draft interpretation.
  Date/Author: 2026-03-09 / Codex

- Decision: Extract a dedicated `CreateFlowResumeCoordinator` before touching the heavier async transition graph.
  Rationale: Resume persistence and restored-story hydration were already a coherent subproblem with clear boundaries around `CreateFlowStore`, `V2Session`, and the restored engine state. Pulling that out shrinks `CreateFlowView` again without forcing a larger redesign of flow transitions yet.
  Date/Author: 2026-03-09 / Codex

- Decision: Extract a dedicated `StoryFlowCoordinator` for story start/completion before attempting a larger `CreateFlowView` breakup.
  Rationale: Those transitions were the clearest remaining cross-boundary decisions touching setup, the story engine, and downstream flow state. Moving them first reduces orchestration in the view without overfitting a larger coordinator abstraction too early.
  Date/Author: 2026-03-09 / Codex

- Decision: Extract lifecycle/reset/unwind policy before the remaining callback-routing pass.
  Rationale: The callback graph is easier to reason about once retry, dismissal, and poem/song reset behavior no longer exist as competing inline policies inside `CreateFlowView.swift`.
  Date/Author: 2026-03-09 / Codex

- Decision: Stop the engine split at the point where stores own derivation and transcript primitives, instead of force-moving every response-mapping line in one slice.
  Rationale: Draft derivation and transcript mutation were the clean boundaries. Pushing the remaining response mapping out in the same cut would have increased risk without improving the public ownership model enough to justify it.
  Date/Author: 2026-03-09 / Codex

- Decision: Finish the readability cleanup by extracting the local downstream content builders into separate composition views.
  Rationale: The earlier pass made `CreateFlowView.swift` logically cleaner but still physically large because the builder bodies stayed local. Moving them out was low-risk and made the flow container read like a router again.
  Date/Author: 2026-03-09 / Codex

## Outcomes & Retrospective

At the current checkpoint, the refactor has established the first critical contract: canonical readiness, removed `CreateFlowView` nested public launch types from the surrounding app surfaces, introduced a canonical iOS draft snapshot for the main story views, pushed resume/handoff/simple transition rules into the dedicated flow types, extracted a dedicated sync service out of `V2StoryEngine`, split the engine’s stored state into draft and conversation backings, moved the low-level state bookkeeping onto those stores, removed the last direct background-task-wrapped API calls from `CreateFlowView`, pulled `StoryContext` construction back into the story layer, extracted restored-story resume persistence/hydration out of the view, and moved the story-start/story-complete / voice-select / poem-gap transition branches behind dedicated coordinators. The remaining debt in `CreateFlowView` is now more mechanical than architectural: it still wires the screen tree together and holds some downstream one-off callbacks, but the highest-risk live transition logic is no longer implemented inline.

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
