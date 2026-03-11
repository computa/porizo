# Story Drafting No-Break Migration Spec

This migration spec is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows `~/.codex/PLANS.MD` because the migration is multi-stage and must remain safe for the existing product flow.

## Purpose / Big Picture

After this migration, the story creator will support canonical server-side draft semantics, real review/edit behavior, authoritative resume, and confirmed-version downstream provenance without breaking the current working user flow.

What must continue to work throughout the migration:
- users start from the same create entry points
- users can still draft through conversation
- users still reach a review step
- users still continue into song or poem creation
- current song creation still results in lyrics and a track
- current poem creation still results in a poem or a detail-gap prompt

What improves:
- the story becomes a real draft rather than a local conversational approximation
- review/edit becomes truthful
- downstream generation becomes tied to an exact confirmed story version
- the system gains safe reopen, save, and resume semantics

The goal is not to replace the current flow. The goal is to preserve the visible flow and upgrade the contract underneath it.

## Progress

- [x] (2026-03-07 00:00Z) Reviewed the current story pipeline and documented current failures in `docs/reports/storycreation`.
- [x] (2026-03-07 00:10Z) Wrote the target contract in `docs/reports/story-drafting-revision-contract-spec.md`.
- [x] (2026-03-07 00:20Z) Mapped current implementation gaps and compatibility posture in `docs/reports/story-drafting-gap-matrix.md`.
- [x] (2026-03-07 00:35Z) Authored this no-break migration spec focused on preserving the current song and poem creation flow.
- [ ] Execute migration milestones in code.
- [ ] Validate that current story, song, and poem flows remain functional at each compatibility checkpoint.

## Surprises & Discoveries

- Observation: The backend already tracks narrative revision metadata such as `narrative_version`, `narrative_revisions`, and `last_integration_delta`.
  Evidence: `src/writer/v3/engine.js` already maintains these fields, but the iOS story flow does not surface them.

- Observation: The repo already has a story-native bridge endpoint for track creation, but the app song flow bypasses it.
  Evidence: `POST /story/:story_id/to-track` exists in `src/routes/story.js`, while `PorizoApp/PorizoApp/CreatingTrackView.swift` creates the track through a client-rebuilt `StoryContext`.

- Observation: The poem flow is closer to the target architecture than the song flow because it remains story-id based.
  Evidence: `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift` confirms and generates from `storyId` directly.

- Observation: The biggest trust break is not missing prompt quality; it is that the current Edit behavior is only a local view-state toggle.
  Evidence: `PorizoApp/PorizoApp/Flows/CreateFlowView.swift` sets `storyEngine.session.isComplete = false` without reopening the draft canonically.

## Decision Log

- Decision: Preserve the current visible user flow and upgrade the contract beneath it rather than replacing the flow wholesale.
  Rationale: The existing flow already works end-to-end for story to song/poem creation, so replacing it would create unnecessary regression risk.
  Date/Author: 2026-03-07 / Codex

- Decision: Treat the conversation flow as a supported drafting modality, not the entire story domain model.
  Rationale: This keeps current user behavior intact while allowing the story draft to become the canonical object.
  Date/Author: 2026-03-07 / Codex

- Decision: Sequence migration by compatibility milestones with rollback boundaries after each milestone.
  Rationale: This is the safest way to preserve current song and poem creation behavior.
  Date/Author: 2026-03-07 / Codex

- Decision: Make downstream provenance a late migration milestone, but define it early.
  Rationale: It is crucial to the target contract, but the current user flow should not be disrupted before canonical draft/version state is in place.
  Date/Author: 2026-03-07 / Codex

## Outcomes & Retrospective

At the design stage, the main outcome is clear:

The migration is feasible without breaking the current flow, but only if the repo explicitly separates:
- user-visible flow compatibility
- internal story draft contract migration

If the team confuses those two things, the migration will either stall or break working behavior.

## Context and Orientation

The current story pipeline spans these main areas:

- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`
  This is the main flow container for story, song, and poem creation from the app.

- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
  This is the client-side story engine wrapper that starts sessions, submits answers, restores local state, and exposes the current story session to the UI.

- `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift`
  This is the current conversation drafting UI.

- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
  This is the current review screen.

- `PorizoApp/PorizoApp/CreatingTrackView.swift`
  This is the current song creation handoff after story review.

- `PorizoApp/PorizoApp/Flows/PoemCreatingView.swift`
  This is the current poem creation handoff after story review.

- `PorizoApp/PorizoApp/APIClient+Story.swift`
  This holds the client-side story route calls.

- `src/routes/story.js`
  This is the main backend API surface for story operations.

- `src/writer/index.js`
  This is the writer-level bridge from routes into the V3 story engine.

- `src/writer/v3/*`
  This is the runtime story engine that owns the canonical narrative integration logic.

The current visible flow is:

1. User enters create flow.
2. User drafts through conversation.
3. User reaches a review step.
4. User continues into song or poem creation.
5. Song or poem generation proceeds from the story.

The migration must keep that visible shape intact.

The main semantic defect to fix is that the story is not yet treated as a canonical, versioned draft all the way through review and downstream generation.

## Non-Negotiable Migration Invariants

These invariants must remain true throughout the migration.

### User Journey Invariants

1. The user must still be able to start from the same create entry points.
2. The user must still be able to draft through conversation.
3. The user must still reach a review step before downstream creation.
4. The user must still be able to continue into song creation from story review.
5. The user must still be able to continue into poem creation from story review.

### Song Flow Invariants

1. Story-based song creation must continue producing lyrics.
2. Story-based song creation must continue producing a track/version pair.
3. Lyrics review must remain reachable.
4. Existing track creation behavior must not regress during early migration phases.

### Poem Flow Invariants

1. Story-based poem creation must continue producing a poem when sufficient details exist.
2. Story-based poem creation must continue surfacing a detail-gap path when the story is incomplete.
3. The current poem flow shape must remain usable while provenance and version semantics are upgraded.

### Compatibility Invariants

1. Existing `start`, `continue`, `summary`, and `confirm` story routes must keep working while new capabilities are introduced.
2. New draft/version fields may be added, but existing clients must not be broken by response changes.
3. New edit or reopen routes must be additive, not disruptive.

## Plan of Work

The migration should be executed in five compatibility milestones.

Milestone 1 establishes canonical metadata without changing the visible flow. The story remains drafted through conversation, but all story routes and client models begin carrying authoritative version and save-state information.

Milestone 2 makes review truthful. The existing review screen remains in the flow, but its state becomes canonically tied to the server-side draft instead of local booleans.

Milestone 3 introduces real editing capability while keeping the current conversational drafting path alive. The review step becomes an actual editing surface rather than a passive summary.

Milestone 4 upgrades downstream handoff so song and poem creation bind to an exact confirmed story version instead of loosely derived or client-rebuilt state.

Milestone 5 retires unsafe legacy semantics only after compatibility validation proves the replacement contract is stable.

## Migration Milestones

## Milestone 1: Canonical Metadata Without Flow Change

### Goal

Add the draft/version semantics required by the target contract without changing how the user moves through the current flow.

### Work

The story routes should begin returning enough information for the client to understand:
- working draft version
- confirmed version if present
- canonical lifecycle state
- save-state compatible timestamps
- revision metadata already available in the backend

The client should model these fields but not yet require a new UI interaction model.

### Result

The current conversation and review flow still looks the same, but the draft is no longer opaque. The app can now tell what version it is showing.

### Proof

The story start, continue, fetch, and confirm endpoints all return canonical version-aware payloads while the current app flow still works.

### Rollback Boundary

If any client compatibility issue appears, the new fields can be ignored by older clients because this milestone is additive.

## Milestone 2: Truthful Review And Resume

### Goal

Make review and resume authoritative without changing the visible create journey.

### Work

The review screen must become tied to the canonical server draft state. The app should still navigate to a review step, but that step must render a server-truthful working version.

Resume behavior should become:
- local restore for fast paint
- immediate authoritative fetch
- reconciliation

The current local-only completion behavior must stop pretending to be final truth.

### Result

The user still sees the same review step, but the story they review is now the canonical draft rather than a local approximation.

### Proof

Restarting the app during story flow restores the same story state from the server without drift.

### Rollback Boundary

The repo can keep local resume as a fallback while the authoritative fetch is feature-flagged if necessary.

## Milestone 3: Real Edit Capability Without Removing Conversation Drafting

### Goal

Introduce actual review-stage editing while preserving conversation as a supported drafting modality.

### Work

Add direct draft edit capability as a new path. The existing conversation drafting flow remains intact.

The review screen can initially support a limited direct-edit path, as long as it is real:
- edit draft text
- save changes
- receive updated canonical version and integration feedback

The old fake Edit behavior must be replaced with a canonical reopen/edit transition.

### Result

Users can still draft through conversation, but they are no longer trapped in a forward-only wizard after reaching review.

### Proof

The same story can be:
- drafted conversationally
- reviewed
- edited from review
- saved
- confirmed

without leaving the current overall story-to-song or story-to-poem journey.

### Rollback Boundary

If direct review editing causes issues, conversation drafting remains available as the safe drafting path while the new edit surface is hidden behind a feature flag.

## Milestone 4: Downstream Confirmed-Version Provenance

### Goal

Preserve the current song and poem creation flow while making downstream generation consume the exact confirmed story version.

### Work

The current continue buttons remain where they are in the user flow.

Internally, the downstream generation paths must bind to:
- `story_id`
- exact `confirmed_version`

The song flow is the highest-risk area because it currently reconstructs story context on the client before track creation. That needs to be migrated carefully toward canonical story-native handoff.

The poem flow already operates closer to the target and can adopt confirmed-version provenance more easily.

### Result

From the user's perspective, story review still leads into song or poem creation in the same place. Under the hood, the generated artifact now references the exact confirmed story version.

### Proof

Generated tracks and poems can be traced back to the exact confirmed version of the story the user approved.

### Rollback Boundary

If canonical track-bridge handoff causes regressions, the repo can temporarily preserve the current track creation code path while continuing to record confirmed-version provenance in parallel.

## Milestone 5: Legacy Semantic Retirement

### Goal

Retire the unsafe old semantics only after the upgraded contract is validated.

### Work

Remove or deprecate:
- local-only completion semantics
- fake edit toggles
- any remaining story-to-generation path that does not preserve canonical confirmed-version provenance

Conversation drafting remains. The legacy misleading semantics do not.

### Result

The story flow still feels familiar to users, but the underlying contract is now correct and trustworthy.

### Proof

The repo no longer depends on local booleans or client-rebuilt story authority for core story lifecycle correctness.

### Rollback Boundary

Do not cross this milestone until the earlier milestones are stable in production-like validation.

## Concrete Steps

This section describes what should be done when implementation begins.

All commands should be run from:

    /Users/ao/Documents/projects/porizo

Initial inspection commands:

    rg -n "story_id|confirmStoryV2|addStoryDetails|to-track|to-poem" PorizoApp/PorizoApp src

Expected outcome:
- identify all story route usages
- identify all downstream story-to-song and story-to-poem handoffs

Current-flow validation commands before any implementation:

    npm test

Expected outcome:
- existing test suite result captured before migration

If iOS-specific validation is performed later, it should include:
- draft through conversation
- review story
- continue to song creation
- continue to poem creation
- restart during story flow and resume

## Validation and Acceptance

This migration is accepted only if all of the following remain true at each milestone.

### Story Flow Acceptance

1. A user can start story creation from the same create entry.
2. A user can draft conversationally.
3. A user reaches a review step.
4. The review step displays the canonical current draft.

### Song Flow Acceptance

1. From story review, the user can continue into song creation.
2. Lyrics are still generated.
3. A track and version are still created.
4. Lyrics review still works.
5. No regression appears in the existing track creation flow during earlier milestones.

### Poem Flow Acceptance

1. From story review, the user can continue into poem creation.
2. If story details are sufficient, a poem is produced.
3. If story details are insufficient, the gap path still works.

### Trust Acceptance

1. The story shown in review matches canonical server state.
2. The system can identify the exact version the user confirmed.
3. Resume restores authoritative state rather than stale local fiction.
4. Editing from review results in a persisted canonical change.

## Idempotence and Recovery

The migration should be designed so that each milestone can be rolled forward or rolled back independently.

### Safe Repeatability

- additive response fields are safe to deploy before they are used
- client parsing of new fields should be tolerant
- new endpoints should be additive and feature-gated

### Recovery Rules

- if direct review editing proves unstable, keep conversation drafting as the fallback editing path
- if canonical downstream handoff proves unstable in song creation, preserve existing track creation sequencing temporarily while continuing to attach provenance in parallel
- do not remove legacy behavior until the replacement has passed validation

## Interfaces and Dependencies

The migration depends on these major interfaces:

### Story API surface

Current routes:
- `POST /story/start`
- `GET /story/:story_id`
- `POST /story/:story_id/continue`
- `GET /story/:story_id/summary`
- `POST /story/:story_id/confirm`
- `POST /story/:story_id/add-details`
- `POST /story/:story_id/to-track`
- `POST /story/:story_id/to-poem`

Target migration requirement:
- preserve these routes where they are already part of the current working flow
- expand them additively where needed
- add new routes only for truly new capabilities like direct draft editing and reopen-after-confirm

### iOS flow container

Primary file:
- `PorizoApp/PorizoApp/Flows/CreateFlowView.swift`

Migration responsibility:
- preserve current visible story-to-song and story-to-poem flow shape
- stop relying on local-only truth for completion and edit state

### Story runtime

Primary files:
- `src/writer/index.js`
- `src/writer/v3/index.js`
- `src/writer/v3/engine.js`
- `src/writer/v3/state.js`

Migration responsibility:
- become the full source of truth for draft/version/reopen semantics
- expose revision metadata to the client contract

## Feature Flag Recommendations

The following flags or compatibility toggles are recommended for safe rollout:

1. `story_authoritative_resume`
   Purpose: turn on server-first restore without changing visible flow.

2. `story_review_real_edit`
   Purpose: turn on canonical review editing while preserving conversation drafting.

3. `story_confirmed_version_provenance`
   Purpose: attach confirmed-version identity to downstream generation.

4. `story_track_bridge_canonical`
   Purpose: migrate song handoff toward canonical story-native track creation while preserving the current user flow.

These names are conceptual. Exact flag wiring is implementation work.

## Cutover Rules

The repo must not cut over to the final contract unless all of the following are true:

1. Current story-to-song flow still works end-to-end.
2. Current story-to-poem flow still works end-to-end.
3. Review edits persist canonically.
4. Resume restores authoritative state.
5. Confirmed-version provenance exists and is verifiable.
6. Legacy local-only completion semantics are no longer required for correctness.

## Artifacts and Notes

This document should be read together with:
- `docs/reports/storycreation`
- `docs/reports/story-drafting-revision-contract-spec.md`
- `docs/reports/story-drafting-gap-matrix.md`

They form the full design packet:
- critique
- target contract
- current-state gaps
- no-break migration plan

## Final Position

The migration is achievable without breaking the current story, song, and poem creation flow.

The condition is discipline:
- preserve the visible flow
- add truth first
- add edit semantics second
- tighten downstream provenance third
- retire unsafe legacy behavior last

If the repo follows that sequence, the product can become a real story drafting system without sacrificing the working creation journey users already have.
