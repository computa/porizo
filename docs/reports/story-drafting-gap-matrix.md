# Story Drafting Contract Gap Matrix

Date: 2026-03-07
Status: Proposed
Related:
- `docs/reports/storycreation`
- `docs/reports/story-drafting-revision-contract-spec.md`

## Purpose

This document maps the formal Story Drafting And Revision Contract against the current implementation.

It answers two questions:

1. Where does the current implementation fall short of the target contract?
2. Can the repo get to the target contract without breaking the current working flow?

Short answer: yes, this is achievable, but only through an additive, compatibility-preserving migration.

The current working flow should be preserved as:
- the default conversational drafting path
- a supported way to create a story
- a compatibility mode during migration

The redesign should not be a rip-and-replace. It should be a contract upgrade around the existing flow.

## Compatibility Position

The target contract is achievable without breaking the current working flow if these constraints are followed:

1. Keep the current `start -> continue -> review -> confirm -> downstream` shape alive during migration.
2. Treat the current conversation flow as one editing modality, not as the entire domain model.
3. Add new draft/version/reopen semantics in a backward-compatible way first.
4. Preserve existing endpoints while expanding their returned state.
5. Introduce new endpoints only for capabilities the current flow fundamentally cannot express, such as direct draft edits and reopen-from-confirmed.
6. Avoid changing downstream generation entrypoints until canonical confirmed-version provenance is in place.
7. Do not let the client remain the primary source of truth once version semantics are added.

If those conditions are respected, the repo can improve the system without breaking the currently working flow.

## Migration Risk Classes

This matrix uses the following compatibility classes:

- `Additive`: can be introduced without breaking existing clients or flow shape.
- `Guarded Tightening`: can preserve flow shape, but behavior changes must be feature-flagged or phased because they alter semantics.
- `New Capability`: requires new endpoint or new UI path, but can coexist with current flow.
- `Unsafe If Replaced`: replacing the current flow directly here would risk regressions.

## Gap Matrix

| Area | Contract Requirement | Current Implementation | Gap | Severity | Compatibility Class | No-Break Path |
|---|---|---|---|---|---|---|
| Canonical draft identity | Server-side canonical story draft with stable lifecycle and version semantics | `story_id` exists, but client treats conversation session and local `V2Session` as practical authority in several places | Draft exists, but version identity and lock semantics are not exposed as product truth | P0 | Additive | Keep `story_id`; add `working_version`, `confirmed_version`, and lifecycle metadata to existing story responses |
| Editing semantics | Explicit operations for append, revise, remove, rewrite, resolve conflict, reopen | Only conversational answer submission and add-details exist; both are additive in practice | No first-class revision model | P0 | New Capability | Preserve `continue` for Q&A; add direct-edit operations as a parallel capability |
| Review editability | Review mode must support direct edits and show saved state | `StoryConfirmationView` is read-only apart from a misleading Edit route | Review exists visually but not semantically | P0 | Guarded Tightening | Keep current review screen shape initially; add editable review payload and save-state before changing routing |
| Edit button correctness | Edit must reopen an editable draft state | Current Edit only flips `isComplete = false` locally | UI promise is false | P0 | Guarded Tightening | Make Edit reopen a mutable draft version server-side while keeping navigation pattern similar |
| Completion truth | Local completion and server completion must match | `finishEarly()` completes locally only; later confirm happens elsewhere | User can review a story that is not canonically finalized | P0 | Guarded Tightening | Preserve current button, but route it through canonical draft transition rather than local-only completion |
| Confirmation semantics | Confirm locks exact visible draft version | `confirmStoryV2` confirms story, but version identity is not surfaced; local review and server confirmation can drift | No exact visible version lock contract | P0 | Additive | Extend confirm response to return version identity and use that version downstream |
| Final review adjustments | Confirm endpoint must accept and honor last-minute notes | `additional_notes` accepted at route boundary but ignored in writer layer | Final review edits are dropped | P1 | Additive | Wire current field through without changing endpoint shape |
| Resume authority | Resume must hydrate from server truth first | App restores local `V2Session`; `refreshSessionFromServer()` exists but is unused | Local cache can mislead draft state | P1 | Guarded Tightening | Keep local resume for fast paint, then reconcile immediately with server |
| Save-state visibility | Draft must expose clean/dirty/saving/save_failed/stale | No explicit save-state contract in story UI | Users cannot tell whether edits are actually persisted | P1 | Additive | Add save-state fields to client state and existing story responses without changing flow |
| Revision history | Product should expose revision/version lineage and integration deltas | Backend tracks `narrative_version`, `narrative_revisions`, `last_integration_delta`; client largely ignores them | Available backend capability is not surfaced | P1 | Additive | Start by returning and modeling revision metadata in current flow before adding richer UX |
| Conflict handling | Contradictions must be recorded and resolvable | Backend has integration/conflict concepts internally; client has no explicit conflict model | Conflict resolution is not a product feature | P1 | New Capability | Surface conflicts as read-only first, then add resolution operations |
| Conversation role | Conversation should support drafting, not define canonical truth | Client architecture is message-first | Draft is derived from conversation instead of primary | P1 | Unsafe If Replaced | Keep current conversation UI, but progressively make canonical draft the primary model under it |
| Downstream song handoff | Song creation must consume canonical confirmed draft version | App confirms story, generates lyrics, then builds a separate client `StoryContext` and creates track | Split-brain handoff risks drift | P0 | Guarded Tightening | Preserve current flow order temporarily, but shift handoff toward story-native provenance without changing visible flow first |
| Story-to-track bridge | Confirmed story should bridge directly into track creation | `/story/:id/to-track` exists but app does not use it | Existing backend bridge is bypassed | P1 | Additive | Introduce bridge use behind current create flow once provenance fields are ready |
| Downstream poem handoff | Poem generation must use canonical confirmed story | Poem flow confirms then generates from story id, which is closer to target | Better aligned than song flow, but lacks explicit confirmed-version provenance | P2 | Additive | Add confirmed-version provenance without changing visible poem flow |
| Review delta visibility | User should see what changed after last input | Backend returns `integration_delta`; current iOS flow ignores it | Draft changes are opaque | P1 | Additive | Surface delta info in current review and conversation cards without altering endpoint names |
| Direct narrative editing | User should be able to edit summary/draft text directly | No direct draft edit path | Review cannot function as a writing surface | P0 | New Capability | Add a dedicated edit endpoint and make it optional alongside Q&A |
| Reopen after confirm | Confirmed story must be reopenable into a new working version | No dedicated reopen concept | Editing after confirm is faked instead of versioned | P0 | New Capability | Add reopen endpoint and preserve current confirmed story lineage |
| Error visibility | Drafting and editing failures must be explicit | `engine.error` is often stored but not surfaced | Failures feel like dead UI | P1 | Additive | Surface current errors before any deeper contract migration |
| Downstream provenance | Generated artifacts must reference exact confirmed story version | Story id flows through; exact confirmed-version provenance does not | Provenance is incomplete for trust and audit | P1 | Additive | Add confirmed-version metadata to downstream payloads without changing visible flow |
| Local cache semantics | Local persistence should be a cache, not authority | Current local persistence behaves as practical authority on resume | Risk of stale or incorrect draft restoration | P1 | Guarded Tightening | Treat local state as optimistic cache layered under server refresh |

## Endpoint Gap Matrix

## `POST /story/start`

Current role:
- Starts a story session.
- Returns `story_id`, question, narrative, readiness-style metadata.

Fit against target contract:
- Strong starting point.
- Missing explicit working-version and save-state semantics.

Gap class:
- Additive.

No-break path:
- Preserve route and request shape.
- Expand response to include canonical draft metadata.

## `GET /story/:story_id`

Current role:
- Returns resumable story session state.

Fit against target contract:
- Correct endpoint for authoritative restore.
- Underused by iOS resume flow.
- Does not yet act as the center of restore semantics in the client.

Gap class:
- Additive plus client tightening.

No-break path:
- Keep route.
- Treat it as authoritative in the client after initial local restore.

## `POST /story/:story_id/continue`

Current role:
- Accepts an answer and advances the conversation.

Fit against target contract:
- Valid as the conversational mutation path.
- Insufficient as the only editing path.

Gap class:
- Keep as-is for compatibility.
- Add parallel edit operations instead of overloading it beyond clarity.

No-break path:
- Preserve current conversational behavior.
- Continue to return richer draft metadata.

## `GET /story/:story_id/summary`

Current role:
- Returns story summary for review.

Fit against target contract:
- Acceptable as a review projection if it remains tied to canonical draft state.
- Not sufficient if used as a parallel summary object.

Gap class:
- Additive clarification.

No-break path:
- Keep route if useful, but ensure it projects from exact working version.

## `POST /story/:story_id/confirm`

Current role:
- Confirms story.
- Accepts `additional_notes` but current writer layer ignores them.

Fit against target contract:
- Right place for version lock.
- Wrongly incomplete because exact confirmed version is not surfaced and notes are dropped.

Gap class:
- Additive plus guarded semantic tightening.

No-break path:
- Preserve route.
- Start honoring `additional_notes`.
- Return `confirmed_version`.

## `POST /story/:story_id/add-details`

Current role:
- Adds more detail after review.

Fit against target contract:
- Only supports additive revision.
- Not sufficient as the editing contract.

Gap class:
- Compatibility-only legacy helper.

No-break path:
- Keep for current poem gap flow.
- Reclassify conceptually as `append_detail`.
- Do not pretend it covers full editing.

## `POST /story/:story_id/to-track`

Current role:
- Story-native track bridge from confirmed story.

Fit against target contract:
- Strongly aligned with target architecture.
- Currently underused by the app.

Gap class:
- Additive adoption.

No-break path:
- Preserve route.
- Migrate song flow toward it behind compatibility checks.

## `POST /story/:story_id/to-poem`

Current role:
- Generates poem from confirmed story.

Fit against target contract:
- Already closer to desired pattern.
- Needs explicit confirmed-version provenance.

Gap class:
- Additive.

No-break path:
- Preserve current flow shape.
- Add provenance.

## Missing Endpoint Responsibilities

The following target responsibilities do not have a clean first-class contract today:

### Direct Draft Edit

Needed for:
- revising the draft directly
- removing or replacing meaning
- direct review editing

Compatibility note:
- can be introduced as a new endpoint without breaking current flow

### Reopen Confirmed Story

Needed for:
- editing after confirmation
- preserving historical confirmed versions

Compatibility note:
- must be additive
- should not replace confirm behavior in one step

### Conflict Resolution

Needed for:
- contradictory facts
- user correction workflow

Compatibility note:
- can start as a surfaced read-only state before interactive resolution is added

## Client Flow Gap Matrix

## Current Visible Flow

Current visible story flow for songs is roughly:

1. Start story from create flow.
2. Enter conversation screen.
3. Reach local completion/review.
4. Continue into creating track.
5. Confirm story during track creation.
6. Generate lyrics.
7. Create track.

This visible flow can be kept.

What must change is the contract underneath it.

## Safe To Preserve

These visible flow characteristics can remain during migration:
- user starts with the same create entrypoints
- user answers assistant questions in a conversation view
- user sees a review screen before generation
- user continues to song or poem after review

## Must Change Under The Hood

These semantics must change even if the screens remain familiar:
- Edit must become a real draft mutation workflow
- review completion must be canonical, not local-only
- resume must be authoritative
- downstream generation must bind to exact confirmed version

## Unsafe To Preserve Literally

These current behaviors should not survive:
- local-only completion through `finishEarly()`
- Edit as a view-state toggle only
- song handoff from client-rebuilt draft authority
- ignored final review notes

## Achievability Assessment

## Achievable Without Breaking Current Working Flow

Yes, if the work is sequenced as a compatibility migration.

The safest path is:

### Phase 1: Expose truth without changing flow shape

Additive changes only:
- return working-version metadata
- return confirmed-version metadata where applicable
- surface save state and error state
- surface integration delta and narrative version in the client
- use server refresh during resume

This improves trust without changing how the user moves through the current flow.

### Phase 2: Make review honest

Guarded changes:
- change Edit from local toggle to canonical draft reopen/edit transition
- preserve the same button and route shape where possible
- keep current conversation screen as the fallback editing modality initially

This preserves familiarity while fixing the most damaging semantic lie.

### Phase 3: Add direct review editing as a new capability

New capability:
- direct draft edit from review screen
- save-state visibility
- conflict surfacing

This adds power without removing the existing Q&A path.

### Phase 4: Move downstream generation to canonical confirmed-version provenance

Guarded tightening:
- preserve current visible continue buttons
- shift internal handoff from client reconstruction to story-native confirmed-version source

This is the point where the architecture becomes substantially more correct while the user-facing flow can remain recognizable.

## Not Achievable Safely If Done As A Big Rewrite

It is not safely achievable if the repo:
- replaces the conversation flow outright
- removes current endpoints before additive replacements exist
- changes confirmation semantics without compatibility scaffolding
- moves all generation to new paths before the current song and poem flows are provenance-safe

That would create unnecessary regressions.

## Recommended Decision

The repo should explicitly choose:

"preserve the visible flow, upgrade the contract underneath it"

That is the only credible path to improve the story creator without breaking the currently working flow.

## Ownership Map

| Concern | Primary Owner | Secondary Owner |
|---|---|---|
| Canonical draft/version semantics | backend story routes + writer runtime | iOS story models |
| Review editability | iOS story UI | backend edit contract |
| Save-state truth | iOS flow container | backend mutation responses |
| Resume authority | iOS flow container | story fetch endpoint |
| Reopen-after-confirm | backend story contract | iOS review UI |
| Downstream story provenance | story routes + track/poem bridges | create flow orchestration |

## Final Answer

Yes, this is achievable without breaking the current working flow.

But it is only achievable if the team treats the current flow as a compatibility shell and upgrades the draft contract beneath it in additive phases.

If the team instead treats the current flow itself as the domain model, the product will keep inheriting the same brittleness no matter how much UI polish is added.
