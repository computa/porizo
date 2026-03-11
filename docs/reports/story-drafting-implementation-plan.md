# Story Drafting Implementation Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows `~/.codex/PLANS.MD` because the work is multi-stage, touches multiple subsystems, and must preserve the existing user journey while changing core story semantics.

## Purpose / Big Picture

After this work, the repo will still support the same visible story creation journey:
- users start from the same create entry
- users still draft through conversation
- users still reach a review step
- users still continue into song or poem creation

What changes is the correctness of the system underneath:
- the story becomes a canonical server draft
- review and edit become truthful
- resume becomes authoritative
- song and poem generation bind to exact confirmed story versions

The most important visible improvement in the earliest milestone is this:

The app stops pretending that local story state is truth. Review, resume, and confirmation become grounded in canonical server state without breaking the existing song and poem creation flow.

## Progress

- [x] (2026-03-07 00:00Z) Completed current-state review and documented failures in `docs/reports/storycreation`.
- [x] (2026-03-07 00:10Z) Wrote the target design contract in `docs/reports/story-drafting-revision-contract-spec.md`.
- [x] (2026-03-07 00:20Z) Wrote the gap matrix in `docs/reports/story-drafting-gap-matrix.md`.
- [x] (2026-03-07 00:35Z) Wrote the no-break migration spec in `docs/reports/story-drafting-no-break-migration-spec.md`.
- [x] (2026-03-07 00:50Z) Wrote this implementation plan to turn the migration spec into execution order.
- [ ] Implement Milestone 1: canonical story metadata and authoritative restore.
- [ ] Implement Milestone 2: truthful review and edit-entry semantics.
- [ ] Implement Milestone 3: direct draft editing as an additive capability.
- [ ] Implement Milestone 4: confirmed-version downstream provenance.
- [ ] Implement Milestone 5: retire unsafe legacy semantics after validation.

## Surprises & Discoveries

- Observation: The highest leverage early change is not direct editing. It is making review, resume, and confirmation truthful.
  Evidence: The current biggest trust break is local-only completion and fake Edit behavior, not missing draft text fields.

- Observation: The song flow is the main regression risk because it currently rebuilds story context on the client before track creation.
  Evidence: `PorizoApp/PorizoApp/CreatingTrackView.swift` confirms the story and then creates a track from client-built `StoryContext`.

- Observation: The poem flow can be upgraded with lower risk because it already remains closer to story-id based generation.
  Evidence: `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift` confirms and generates from `storyId`.

- Observation: The backend already exposes enough structure to start improving correctness before introducing any new screens.
  Evidence: `src/writer/v3/engine.js` and `src/routes/story.js` already track and return revision-oriented metadata.

## Decision Log

- Decision: Execute the migration in correctness-first order rather than UI-ambition-first order.
  Rationale: Fixing truth, restore, and provenance first reduces the risk of building new editing UI on top of broken semantics.
  Date/Author: 2026-03-07 / Codex

- Decision: Treat direct review editing as Milestone 3, not Milestone 1.
  Rationale: Direct editing is valuable, but without canonical version identity and authoritative restore it would still sit on weak foundations.
  Date/Author: 2026-03-07 / Codex

- Decision: Preserve the existing conversation drafting flow as the baseline drafting modality throughout migration.
  Rationale: This keeps the current user journey and reduces regression surface while the contract underneath changes.
  Date/Author: 2026-03-07 / Codex

- Decision: Make song-flow provenance migration explicitly later than story metadata migration.
  Rationale: Song creation is the most fragile integration boundary and should not be touched until draft/version truth is in place.
  Date/Author: 2026-03-07 / Codex

## Outcomes & Retrospective

At planning stage, the outcome is a build order that is intentionally conservative:

- first make current flow honest
- then make review truthful
- then add editing power
- then bind downstream generation to confirmed versions
- only then remove unsafe legacy semantics

This ordering maximizes the chance of achieving the target without regressing current story-to-song or story-to-poem behavior.

## Context and Orientation

The story pipeline currently spans:

- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`
  Main create-flow state machine that routes story, song, and poem flows.

- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
  Client-side wrapper around story start, continue, restore, and session state.

- `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift`
  Current story drafting UI through conversation.

- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
  Current review step.

- `PorizoApp/PorizoApp/CreatingTrackView.swift`
  Song creation handoff from story into lyrics and track creation.

- `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift`
  Poem creation handoff from story into poem generation.

- `PorizoApp/PorizoApp/APIClient+Story.swift`
  Client calls into story routes.

- `src/routes/story.js`
  Backend HTTP interface for story operations.

- `src/writer/index.js`
  Story route bridge into runtime engine behavior.

- `src/writer/v3/index.js`
- `src/writer/v3/engine.js`
- `src/writer/v3/state.js`
  Runtime story draft logic, integration, and state semantics.

Terms used in this plan:

- "canonical draft" means the authoritative story state stored and mutated on the server.
- "working version" means the currently editable version of the draft.
- "confirmed version" means the exact version the user has explicitly locked for downstream generation.
- "provenance" means metadata proving which story version was used to generate a song or poem.
- "feature flag" means a runtime switch that allows new behavior to be enabled gradually while preserving a fallback.

## Why This Work Exists

The current story flow works end-to-end, but it behaves like a guided questionnaire rather than a reliable writing and editing tool.

The most important current failures are:

- the story is not treated as a canonical draft all the way through review and downstream creation
- the current Edit behavior is not real editing; it is a local presentation toggle
- local completion can diverge from server truth
- local restore behaves as practical authority even though server story state exists
- the song flow rebuilds story context on the client instead of relying on exact canonical confirmed story state
- review is visually present but semantically weak

This is why the product feels brittle. It is not because the story engine lacks sophistication. It is because the product contract around that engine is too weak.

The backend already contains stronger editorial primitives than the product surface exposes. The migration in this plan exists to elevate those primitives into actual product truth without breaking the current working flow.

## Target Contract Summary

This implementation plan is based on a target contract with these non-negotiable properties:

1. The server owns a canonical story draft.
2. The draft has an explicit working version.
3. Confirmation locks an exact visible confirmed version.
4. Review is an editable stage, not only a summary.
5. Resume reconstructs from authoritative server state.
6. Conversation remains a supported drafting modality, but it is not the sole domain model.
7. Song and poem generation consume the canonical confirmed story version.
8. Reopening after confirmation creates a new mutable working version, not a silent mutation of the historical confirmed one.

This plan preserves the visible flow while moving the codebase toward that contract in stages.

## Current-State Gap Summary

The repo currently has the following gap profile.

### Story State Gaps

- `story_id` exists, but version identity is not the product truth yet.
- the client does not fully model backend revision metadata already available from the V3 runtime
- local persistence is used as practical authority during resume

### Review And Edit Gaps

- the review step exists, but the current Edit path is not a true canonical mutation flow
- the product does not yet support first-class direct draft edits
- the product does not clearly surface save state or revision deltas

### Downstream Handoff Gaps

- poem creation is closer to the target because it remains story-id based
- song creation is farther from the target because it rebuilds story context on the client before track creation
- confirmed-version provenance is not yet the controlling downstream contract

### Compatibility Implication

These gaps do not require replacing the current user journey.

They do require changing the story contract beneath that journey.

## No-Break Migration Rules

This plan assumes the following compatibility rules are mandatory.

### Visible Flow Must Stay Familiar

The user must still be able to:
- enter from the same create points
- draft through conversation
- reach a review step
- continue into song creation
- continue into poem creation

### Existing Creation Flows Must Not Regress

At every milestone:
- story-to-song must still produce lyrics and a track/version pair
- story-to-poem must still produce a poem or a detail-gap path
- lyrics review must remain reachable for the song flow

### Additive Before Disruptive

New metadata fields, new endpoints, and new review-edit capabilities should be introduced additively first.

Old semantics should only be retired after the replacement contract has been validated against the current flow.

### Preserve Flow Shape, Not Broken Semantics

This plan preserves:
- the current user journey
- the current conversation drafting path
- the current review location in the flow
- the current continue-into-song and continue-into-poem behavior

This plan does not preserve:
- fake Edit behavior
- local-only completion as practical truth
- client-rebuilt story authority as the long-term downstream contract

## Contract-To-Code Mapping Summary

The key code responsibilities for the migration are:

### iOS Flow Orchestration

Primary file:
- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`

Required evolution:
- continue to orchestrate the same visible story flow
- stop relying on local-only booleans for truth
- become version-aware and restore-aware

### iOS Story Engine And Models

Primary files:
- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- `PorizoApp/PorizoApp/Models/StoryModels.swift`
- `PorizoApp/PorizoApp/V2Story/V2StoryTypes.swift`

Required evolution:
- model canonical version metadata
- model review/edit state more truthfully
- reconcile local cached state with server truth

### iOS Review And Drafting UI

Primary files:
- `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift`
- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`

Required evolution:
- keep conversation drafting alive
- make review honest
- add direct review editing later as an additive capability

### Backend Story API

Primary file:
- `src/routes/story.js`

Required evolution:
- return canonical version-aware state
- support truthful confirm semantics
- eventually support direct edit and reopen semantics without breaking existing routes

### Writer Runtime

Primary files:
- `src/writer/index.js`
- `src/writer/v3/index.js`
- `src/writer/v3/engine.js`
- `src/writer/v3/state.js`

Required evolution:
- become the full source of truth for draft versioning, revision lineage, and reopen semantics
- expose that truth to the API layer in a stable contract

### Downstream Song And Poem Creation

Primary files:
- `PorizoApp/PorizoApp/CreatingTrackView.swift`
- `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift`

Required evolution:
- preserve current visible continuation into song and poem creation
- gradually move underlying provenance to exact confirmed story version identity

## Plan of Work

The work should be implemented in five milestones. Each milestone has a narrow objective, low-regression behavior, and a clear validation boundary.

Milestone 1 changes data truth but not user flow. The story routes and iOS models learn to carry canonical version identity, authoritative timestamps, and enough metadata to support truthful restore and review.

Milestone 2 changes review semantics without changing the visible step sequence. The user still enters a review step, but the system stops using local-only completion and fake edit toggles as truth.

Milestone 3 adds actual direct editing from review as a new capability. Conversation drafting remains fully supported.

Milestone 4 upgrades downstream song and poem creation to consume exact confirmed-version provenance without changing the user's continue-into-song or continue-into-poem journey.

Milestone 5 removes the remaining unsafe legacy semantics once earlier milestones are stable.

## Milestone 1: Canonical Metadata And Authoritative Restore

### Goal

Make the existing flow truthful about what story version it is showing and restore from authoritative server state without changing the visible create journey.

### Files In Scope

- `src/routes/story.js`
- `src/writer/index.js`
- `src/writer/v3/index.js`
- `PorizoApp/PorizoApp/Models/StoryModels.swift`
- `PorizoApp/PorizoApp/V2Story/V2StoryTypes.swift`
- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`

### Required Changes

On the backend:
- return explicit working-version metadata from story start, continue, fetch, and confirm paths
- return confirmed-version metadata where applicable
- return enough updated-at and revision metadata for authoritative restore and review

On iOS:
- add version-aware fields to story models
- preserve local session storage, but treat it as cached state
- on restore, fetch server state and reconcile immediately

### Why This Goes First

Without canonical version identity and authoritative restore, every later editing change will still sit on untrustworthy state.

### Acceptance

1. The user flow still starts the same way.
2. Conversation drafting still works.
3. Review still appears where expected.
4. Restarting the app during story flow restores canonical server state rather than stale local fiction.
5. No break occurs in song or poem continuation from the story flow.

### Validation

Behavior to verify manually:
- start story
- answer several questions
- kill and reopen app
- confirm that restored story matches backend state
- continue to song creation
- continue to poem creation

Tests to run:
- existing repo test suite
- any story route tests touching start, continue, fetch, confirm, and poem/song generation preconditions

### Risk Level

Low to medium. This is mostly additive, but restore behavior changes can surface previously hidden inconsistencies.

## Milestone 2: Truthful Review And Edit Entry

### Goal

Keep the current review step in the flow, but make it truthful and canonical.

### Files In Scope

- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`
- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- `src/routes/story.js`
- `src/writer/index.js`

### Required Changes

- remove reliance on local-only completion as practical truth
- stop using `isComplete = false` as the edit mechanism
- make "Edit" reopen an actually editable server draft state or canonical mutable review state
- make review represent the canonical working version

### Why This Comes Before Direct Editing

The system must stop lying about Edit before it becomes more powerful.

### Acceptance

1. The review step still exists in the same story flow.
2. Pressing Edit no longer dead-ends the user in a logically locked story state.
3. The user can still continue from review to song or poem creation.
4. No regression occurs in current review-to-song or review-to-poem transitions.

### Validation

Manual:
- reach review
- press Edit
- confirm the draft becomes actually mutable
- continue to song
- continue to poem

Route-level:
- confirm story state transitions match expected review/edit semantics

### Risk Level

Medium. This changes semantics at a central trust boundary, but visible flow shape can remain the same.

## Milestone 3: Direct Draft Editing As An Additive Capability

### Goal

Allow direct story editing from review without removing conversation drafting.

### Files In Scope

- new or expanded story edit route(s) in `src/routes/story.js`
- writer runtime edit operations in `src/writer/index.js` and `src/writer/v3/*`
- iOS review UI in `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
- story engine model and mutation handling in `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`

### Required Changes

- add first-class direct draft edit capability
- support real save semantics in review
- surface integration delta, conflict state, or unsupported edit warnings where available
- keep conversation drafting fully functional as a parallel path

### Why This Is Milestone 3

Editing power should be built only after the draft and review state are trustworthy.

### Acceptance

1. A user can still draft through conversation only.
2. A user can also directly edit from review.
3. Edits persist canonically.
4. The user can still continue into song or poem creation from the same visible review area.

### Validation

Manual:
- draft via conversation
- reach review
- change draft text directly
- save
- verify persisted draft after app restart
- continue to song
- continue to poem

Regression:
- ensure the pure conversation-only path still works for users who never use direct editing

### Risk Level

Medium to high. This introduces new capability, so feature-flagging is strongly recommended.

## Milestone 4: Confirmed-Version Downstream Provenance

### Goal

Ensure song and poem creation use the exact confirmed story version without changing the visible continue actions in the user flow.

### Files In Scope

- `PorizoApp/PorizoApp/CreatingTrackView.swift`
- `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift`
- `PorizoApp/PorizoApp/APIClient+Story.swift`
- `src/routes/story.js`
- `src/writer/index.js`
- any downstream track or poem route models that need story provenance fields

### Required Changes

- attach confirmed-version metadata to the story confirm result
- ensure downstream calls bind to that exact version
- migrate song flow away from client-rebuilt story authority toward canonical story-native provenance
- preserve visible continue-to-song and continue-to-poem behavior

### Why This Is Not Milestone 1

This is the highest integration-risk area, especially in the song path. It should wait until draft/version truth is already stable.

### Acceptance

1. The user still taps continue from review and reaches song or poem creation as before.
2. Song creation still generates lyrics and creates a track.
3. Poem creation still generates a poem or a gap prompt.
4. Generated artifacts can be traced to an exact confirmed story version.

### Validation

Manual:
- story to song happy path
- story to poem happy path
- story to poem gap path

Backend:
- inspect generated provenance records or payloads to confirm exact story version identity

### Risk Level

High for song flow, medium for poem flow.

## Milestone 5: Legacy Semantic Retirement

### Goal

Remove the remaining unsafe old semantics after the replacement contract has been validated.

### Files In Scope

Likely all story-flow files touched in earlier milestones.

### Required Changes

- retire local-only completion behavior
- remove fake edit semantics
- remove any remaining dependence on client-rebuilt story authority for correctness

### Acceptance

1. The visible story flow still works.
2. Song and poem creation still work.
3. No correctness-critical story lifecycle behavior depends on local-only state.

### Validation

Repeat all story, song, poem, restore, edit, and confirm validations from previous milestones.

### Risk Level

Medium, but only if attempted too early. Low if delayed until after milestone validation.

## Build Order Summary

The correct implementation order is:

1. canonical metadata and authoritative restore
2. truthful review and edit-entry semantics
3. direct draft editing
4. confirmed-version downstream provenance
5. legacy semantic retirement

Anything else increases regression risk.

## Feature Flag Plan

These flags are recommended to keep the migration safe:

- `story_authoritative_restore`
  Enables server-truth restore after local cache paint.

- `story_review_truthful_edit_entry`
  Replaces fake Edit behavior with canonical mutable draft semantics.

- `story_review_direct_edit`
  Enables direct draft editing from review.

- `story_confirmed_version_provenance`
  Enables exact confirmed-version tracking through downstream generation.

- `story_song_canonical_handoff`
  Enables story-native song handoff when safe.

The flag names are conceptual. Exact naming is implementation detail.

## Concrete Steps

When implementation begins, use this sequence.

### Step 1: Baseline current behavior

Run from repo root:

    npm test

Record:
- existing failures
- story-related tests
- any failures already in scope under repo instructions

### Step 2: Inventory story route consumers

Run:

    rg -n "startStoryV2|continueStoryV2|confirmStoryV2|addStoryDetails|getStorySession|storyToTrack|createPoemFromStory" PorizoApp/PorizoApp src

Expected:
- list every place the current story contract is consumed

### Step 3: Implement Milestone 1 and validate before proceeding

Do not start Milestone 2 before:
- current story conversation still works
- current song creation still works
- current poem creation still works

### Step 4: Add feature-flagged Milestone 2 behavior

Do not remove old edit entry until:
- canonical review/edit transition is proven

### Step 5: Add Milestone 3 as optional capability

Keep conversation drafting available as fallback during rollout.

### Step 6: Upgrade downstream provenance

Start with poem if needed because it is lower-risk, but do not declare success until song flow is also canonical.

## Validation and Acceptance

This implementation plan is accepted only if each milestone can be validated independently.

### Baseline Acceptance For Every Milestone

1. Story conversation drafting still works.
2. Story review still appears.
3. Story can still continue into song creation.
4. Story can still continue into poem creation.
5. Existing test suite still passes or only shows pre-existing failures that are documented and then fixed if in scope.

### Milestone-Specific Acceptance

Milestone 1:
- restore is authoritative

Milestone 2:
- Edit is truthful and no longer a dead local toggle

Milestone 3:
- direct review edits persist canonically

Milestone 4:
- downstream artifacts reference exact confirmed story version

Milestone 5:
- no correctness-critical legacy semantics remain

## Idempotence and Recovery

Each milestone should be independently reversible.

### Recovery Rules

- If Milestone 1 restore changes cause regressions, keep local restore but feature-flag the authoritative fetch path.
- If Milestone 2 edit-entry changes cause regressions, keep review read-only temporarily but do not ship the fake Edit affordance as if it were functional.
- If Milestone 3 direct editing regresses, disable the new edit UI and keep conversation drafting available.
- If Milestone 4 canonical song handoff regresses, preserve the current song generation sequencing while continuing to attach provenance data in parallel until the bridge is stable.

## Artifacts and Notes

This plan should be executed with these documents open:

- `docs/reports/storycreation`
- `docs/reports/story-drafting-revision-contract-spec.md`
- `docs/reports/story-drafting-gap-matrix.md`
- `docs/reports/story-drafting-no-break-migration-spec.md`

Together they define:
- why the change is needed
- what the target contract is
- where the current code falls short
- how to migrate without breaking the current flow
- in what order to build

## Interfaces and Dependencies

Primary code interfaces affected:

- iOS flow orchestration in `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`
- story client models in `PorizoApp/PorizoApp/Models/StoryModels.swift`
- client session engine in `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- review UI in `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
- story routes in `src/routes/story.js`
- story writer bridge in `src/writer/index.js`
- story runtime in `src/writer/v3/index.js`, `src/writer/v3/engine.js`, and `src/writer/v3/state.js`
- story-to-song handoff in `PorizoApp/PorizoApp/CreatingTrackView.swift`
- story-to-poem handoff in `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift`

The plan depends on preserving current endpoint compatibility while introducing:
- richer story route payloads
- new edit semantics
- version-aware confirmation
- version-aware downstream generation provenance
