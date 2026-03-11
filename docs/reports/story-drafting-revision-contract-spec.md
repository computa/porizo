# Story Drafting And Revision Contract Spec

Date: 2026-03-07
Status: Proposed
Audience: Product, iOS, API, writer/runtime
Scope: Story collection, drafting, review, revision, confirmation, resume, and downstream handoff into song or poem generation

## 1. Purpose

This document defines the formal contract for the story creator as a draft-based editing system.

It exists to replace the current implicit wizard behavior with an explicit, robust model that supports:
- iterative drafting
- direct and indirect editing
- canonical persistence
- versioned confirmation
- trustworthy downstream consumption

This is a product and architecture contract. It is not an implementation plan.

## 2. Problem Statement

The current story flow behaves like a guided Q&A wizard with a synthesized summary. That model is insufficient for a writing product because it does not provide durable edit semantics.

The required product promise is:

"The story the user sees, edits, saves, reviews, and confirms is the exact story object the system uses downstream."

Every rule in this spec exists to preserve that promise.

## 3. Goals

### 3.1 Primary Goals

1. Treat the story as a canonical server-side draft, not a transient chat byproduct.
2. Support meaningful revision, not only additive answering.
3. Preserve user trust through visible versions, save semantics, and confirmation semantics.
4. Ensure resume behavior is authoritative and consistent across devices or restarts.
5. Ensure song and poem generation consume the canonical confirmed draft version.

### 3.2 Secondary Goals

1. Preserve conversational collection as a useful drafting modality.
2. Reuse the V3 engine's narrative integration, grounding, and revision metadata.
3. Maintain auditability and provenance for compliance and debugging.

### 3.3 Non-Goals

1. This spec does not define UI styling.
2. This spec does not define prompt wording.
3. This spec does not prescribe database schema details.
4. This spec does not mandate exact endpoint payload field names unless needed for contract clarity.

## 4. Design Principles

### 4.1 Canonical Draft First

The server owns the canonical story draft. The client may cache, stage, and render it, but does not become the authority.

### 4.2 Explicit Editing

The system must model editing as first-class operations. "Answering a question" is only one such operation.

### 4.3 Review Is Editable

Review mode is not a dead-end summary. It is a draft inspection and revision stage.

### 4.4 Confirmation Locks A Version

Confirmation locks a specific visible draft version for downstream use.

### 4.5 Revisions Are Product Data

Narrative revisions, superseded facts, and conflicts are not internal trivia. They are part of the product's trust model.

### 4.6 Resume Must Prefer Truth Over Convenience

Local caches improve UX. Server draft state determines reality.

## 5. Canonical Domain Model

## 5.1 Story Draft

The story draft is the primary domain entity for story creation.

Required conceptual fields:
- `story_id`
- `status`
- `working_version`
- `confirmed_version`
- `canonical_narrative`
- `fact_inventory`
- `revision_log`
- `conversation_history`
- `readiness_state`
- `save_state`
- `updated_at`

The story draft is mutable except when explicitly locked by confirmation semantics.

## 5.2 Draft Version

A draft version is a stable snapshot of the story draft at a meaningful mutation boundary.

Required conceptual properties:
- `version_id` or integer `version_number`
- `created_at`
- `created_by`
- `source_operation`
- `narrative`
- `fact_inventory_snapshot`
- `integration_delta`
- `lock_state`

Rules:
- every confirmed story must reference an exact draft version
- reopening after confirmation must create a new working version lineage
- downstream generation must reference a specific confirmed version

## 5.3 Fact Inventory

The fact inventory is the grounded claim set the engine and UI treat as authoritative support for the draft narrative.

Each fact should conceptually support:
- `fact_id`
- `text`
- `status`: active | superseded | removed | conflicted
- `source`
- `source_turn`
- `introduced_in_version`
- `superseded_in_version`

Rules:
- the narrative may not silently rely on unsupported claims
- removing or revising a fact must be reflected in the fact inventory and revision log

## 5.4 Revision

A revision is any mutation that changes the meaning, facts, or phrasing of the draft.

Revision types:
- `append_detail`
- `revise_detail`
- `remove_detail`
- `rewrite_narrative`
- `resolve_conflict`
- `reopen_from_confirmed`
- `assistant_integration`
- `confirm_version`

Each revision should conceptually record:
- actor
- timestamp
- operation type
- affected facts
- narrative delta
- resulting version

## 5.5 Conversation History

Conversation history is supporting interaction context, not the canonical work product.

Rules:
- raw user turns should remain attributable and durable
- conversation may be trimmed for prompt shaping, but canonical draft state may not depend on trimmed-only memory
- the product must never require conversation reconstruction to determine the canonical confirmed draft

## 6. Source Of Truth Boundaries

### 6.1 Server

The server is authoritative for:
- canonical draft state
- draft versions
- fact inventory
- revision history
- confirmed version identity
- reopen lineage
- readiness state
- downstream provenance

### 6.2 Client

The client is authoritative only for:
- immediate local input before save
- transient composition state
- presentation state
- optimistic UI state pending server acknowledgement

The client is not authoritative for:
- canonical draft contents
- confirmation state
- downstream version selection

### 6.3 Local Persistence

Local persistence is a cache and resume optimization.

Rules:
- local state may restore draft rendering quickly
- local state must be reconciled against server draft state
- if server and local diverge, server wins unless the client has explicit unsynced edits, in which case reconciliation must be explicit and visible

## 7. Lifecycle State Machine

## 7.1 Story Draft Lifecycle States

The canonical draft must support these lifecycle states:

| State | Meaning | Mutable | Downstream Eligible |
|---|---|---:|---:|
| `drafting` | Active drafting through conversation or direct edits | Yes | No |
| `review_ready` | Draft is coherent enough for review but not locked | Yes | No |
| `editing_review` | User is revising after review surfaced | Yes | No |
| `confirmed` | Specific version locked for downstream use | No for locked version | Yes |
| `reopened` | New working revision created from last confirmed version | Yes | No |
| `abandoned` | User stopped without intending to continue | No unless resumed explicitly | No |
| `expired` | Session exceeded allowed lifetime | No unless revived explicitly | No |

### 7.1.1 State Intent

- `drafting` is the normal forward-building state.
- `review_ready` means the system believes the draft is legible enough to inspect.
- `editing_review` means the user is actively modifying from the review surface.
- `confirmed` means a specific version is locked and downstream-safe.
- `reopened` means the confirmed story has been reopened into a new mutable working version.

## 7.2 State Transition Table

| Current State | Event | Preconditions | Next State | Required Effects |
|---|---|---|---|---|
| none | `start_story` | valid user + initial prompt or seeded context | `drafting` | create draft, version 1, initial conversation, initial save |
| `drafting` | `assistant_marks_review_ready` | readiness threshold met | `review_ready` | persist readiness metadata, no lock |
| `drafting` | `user_requests_review` | draft exists | `review_ready` | persist current version as reviewable working version |
| `drafting` | `user_submits_answer` | draft mutable | `drafting` or `review_ready` | integrate answer, create revision, update narrative and fact inventory |
| `drafting` | `user_direct_edit` | draft mutable | `drafting` or `review_ready` | apply explicit revision, create new working version |
| `review_ready` | `user_edits_from_review` | draft mutable | `editing_review` | enter revision workflow, preserve prior reviewable version lineage |
| `editing_review` | `revision_saved` | save success | `editing_review` or `review_ready` | persist revision, update readiness |
| `review_ready` | `confirm_version` | explicit user action | `confirmed` | lock exact version, store confirmation timestamp and actor |
| `editing_review` | `confirm_version` | explicit user action | `confirmed` | lock exact latest visible version |
| `confirmed` | `reopen_story` | explicit user action | `reopened` | create new mutable working version linked to confirmed ancestor |
| `reopened` | `user_submits_edit` | new working version exists | `reopened` or `review_ready` | persist revision under reopened lineage |
| any mutable state | `cancel_story` | user intent to abandon | `abandoned` | preserve draft and history unless deletion requested |
| `abandoned` | `resume_story` | draft still valid | `drafting` or `review_ready` | restore canonical server state |
| any non-confirmed state | `expire_story` | TTL exceeded | `expired` | preserve history, disallow downstream use |

## 7.3 Confirmation State Machine

Confirmation is a separate contract layered over the draft lifecycle.

### Confirmation states

| State | Meaning |
|---|---|
| `not_reviewable` | draft not ready for final inspection |
| `reviewable` | draft can be reviewed and edited |
| `confirmable` | draft meets conditions for explicit lock |
| `locked_confirmed` | a specific draft version is confirmed |
| `reopened_after_confirm` | confirmed story has a new mutable descendant |

### Confirmation rules

1. A story may become `reviewable` automatically or on user request.
2. A story becomes `confirmable` only when the system and user are both satisfied enough for lock.
3. `confirmable` does not imply immutable.
4. `locked_confirmed` must reference one exact version.
5. Reopening must not mutate the historical confirmed version in place.

## 8. Save State Machine

The client and server must maintain an explicit save-state contract.

| Save State | Meaning |
|---|---|
| `clean` | local and server draft match |
| `dirty` | local edits exist that are not yet acknowledged |
| `saving` | mutation request is in flight |
| `save_failed` | mutation failed and requires user-visible recovery |
| `stale` | local representation is older than server-authoritative state |

### Save-state rules

1. The user must never be shown a misleadingly "done" state if the server has not persisted it.
2. `save_failed` must be visible in the drafting or review UI.
3. `stale` must be detectable when resuming from local persistence.
4. Confirmation may only occur from a `clean` state.

## 9. Draft Mutation Operations

## 9.1 Operation Matrix

| Operation | Actor | Description | Draft Version Effect | Fact Inventory Effect |
|---|---|---|---|---|
| `append_detail` | user | adds new story material | increments working version | adds active facts |
| `revise_detail` | user | changes meaning of existing material | increments working version | supersedes or updates prior facts |
| `remove_detail` | user | removes detail from story | increments working version | marks facts removed or superseded |
| `rewrite_narrative` | user | directly edits canonical draft wording | increments working version | may create groundedness or conflict checks |
| `assistant_integration` | assistant/runtime | rewrites draft after new input | increments working version | updates support mapping and integration delta |
| `resolve_conflict` | user/assistant | resolves contradictory facts | increments working version | closes conflict set and updates actives |
| `confirm_version` | user | locks exact visible version | locks version | no fact mutation unless explicitly part of confirm workflow |
| `reopen_from_confirmed` | user | starts new editable branch from confirmed version | creates new working version descendant | inherited then mutable |

## 9.2 Required Semantics Per Operation

### `append_detail`

Must:
- preserve prior accepted facts unless superseded intentionally
- show what new material was integrated

Must not:
- silently replace prior meaning without trace

### `revise_detail`

Must:
- identify target prior meaning or fact cluster
- preserve that a correction occurred
- update the narrative to reflect the correction

Must not:
- behave as a disguised append

### `remove_detail`

Must:
- remove the material from the canonical draft
- preserve revision history

Must not:
- leave removed content in confirmed downstream context

### `rewrite_narrative`

Must:
- update the visible draft text
- run support and conflict checks against the fact inventory
- either accept, soft-flag, or explicitly reject unsupported additions

Must not:
- silently invent new facts into the canonical confirmed draft

### `confirm_version`

Must:
- lock the exact visible version
- make that version downstream-eligible
- preserve provenance

Must not:
- allow later server-side recomputation to change the meaning of what was confirmed

### `reopen_from_confirmed`

Must:
- create a new working version lineage
- preserve the prior confirmed version as historical truth

Must not:
- mutate the already confirmed version in place

## 10. Review Contract

## 10.1 Review Surface Responsibilities

The review surface must allow the user to:
- inspect the canonical narrative
- inspect important facts or story elements
- understand what changed recently
- directly revise the draft
- confirm the exact visible version
- reopen after confirmation

## 10.2 Review Surface Must Not Be

- a read-only summary page with a routing-only Edit button
- a passive display with no save semantics
- a local-only completion illusion

## 10.3 Required Review Behaviors

1. Show current working version identity.
2. Show whether the draft is saved.
3. Show whether the story is review-ready, confirmable, or confirmed.
4. Allow direct edits without forcing the user back into a pure Q&A flow.
5. Show latest integration delta when available.
6. Show conflicts or unsupported edits that need attention.

## 11. Conversation Contract

Conversation remains part of the drafting system, but it is not the system of record.

Conversation is responsible for:
- gathering material
- asking gap-closing questions
- clarifying ambiguities
- explaining editorial changes

Conversation is not responsible for:
- being the only place where the story can be revised
- standing in for canonical draft storage
- determining downstream provenance by itself

## 12. Resume And Sync Contract

## 12.1 Resume Sequence

On resume:

1. Load local cached draft if available for immediate rendering.
2. Fetch canonical server draft state.
3. Compare local and server state.
4. Reconcile into one visible draft state.
5. Surface recovery or conflict UI if unsynced local mutations exist.

## 12.2 Resume Rules

1. Server state is canonical for saved content.
2. Local state may represent unsynced edits only if explicitly tracked.
3. Confirmed versions must remain stable after resume.
4. Reopened drafts must resume as reopened drafts, not as generic active sessions.

## 13. Downstream Generation Contract

## 13.1 Song Or Poem Generation Preconditions

Downstream generation may run only when:
- the story is in `confirmed`
- a concrete confirmed version is present
- that version is server-addressable

## 13.2 Downstream Provenance Requirements

Every generated artifact derived from a story must reference:
- `story_id`
- `confirmed_version`
- `confirmed_at`
- generation request timestamp

## 13.3 Downstream Consumption Rule

Song and poem generation must consume the canonical confirmed story version, not:
- client-rebuilt `StoryContext`
- lossy chat reconstruction
- a local-only narrative approximation

## 14. Endpoint Responsibility Matrix

This section defines which endpoints should own which responsibilities in the target contract.

It does not require exact final route names, but does require the responsibility boundaries to be explicit.

## 14.1 Start Story

### Endpoint

`POST /story/start`

### Responsibility

- create a new canonical story draft
- create initial working version
- persist initial prompt and initial conversation turn
- return canonical draft identity and initial visible state

### Must Return

- `story_id`
- current `status`
- current `working_version`
- visible narrative
- initial assistant response
- readiness metadata
- save metadata

### Must Not Do

- create only a transient wizard session without durable draft identity

## 14.2 Fetch Canonical Story State

### Endpoint

`GET /story/:story_id`

### Responsibility

- return the authoritative canonical story draft state for resume and review

### Must Return

- story lifecycle state
- working version
- confirmed version if any
- canonical narrative
- conversation history
- fact inventory or review-relevant subset
- revision metadata
- save-compatible timestamps

### Must Be

- the source used for authoritative restore

## 14.3 Submit Conversational Turn

### Endpoint

`POST /story/:story_id/continue`

### Responsibility

- accept a conversational answer as a draft mutation
- integrate it into the canonical draft
- create revision metadata
- return resulting draft state

### Must Return

- next visible narrative
- resulting working version
- integration delta
- readiness state
- any assistant follow-up

### Must Not Be

- the only legal path for all editing forever

## 14.4 Direct Draft Edit

### Endpoint

Target responsibility requires a dedicated edit mutation endpoint.

Suggested shape:
- `POST /story/:story_id/edit`
- or `PATCH /story/:story_id/draft`

### Responsibility

- apply a direct user edit to the canonical draft
- distinguish operation type
- update fact inventory and narrative
- return new working version and integration metadata

### Required Operation Types

- append
- revise
- remove
- rewrite
- resolve_conflict

### Reason This Must Exist

Without a dedicated edit contract, the product remains a wizard pretending to be an editor.

## 14.5 Review Summary

### Endpoint

If retained:
- `GET /story/:story_id/summary`

### Responsibility

- return review-oriented representation of the current working version

### Must Not Be

- a separate unversioned approximation disconnected from the canonical draft

The review summary must be a view of the draft, not a parallel object.

## 14.6 Confirm Story

### Endpoint

`POST /story/:story_id/confirm`

### Responsibility

- lock the exact currently visible working version
- record confirmation provenance
- return confirmed version identity

### Must Accept

- optional final review adjustments if the product supports them

### Must Return

- `story_id`
- `confirmed_version`
- confirmation timestamp
- canonical confirmed narrative

### Must Not Do

- ignore submitted final notes
- silently confirm some later recomputed version instead

## 14.7 Reopen Story

### Endpoint

Target responsibility requires a dedicated reopen endpoint.

Suggested shape:
- `POST /story/:story_id/reopen`

### Responsibility

- create a new mutable working version from the last confirmed version
- preserve historical confirmation
- return reopened draft state

### Must Not Do

- mutate the prior confirmed version in place

## 14.8 Story To Track

### Endpoint

`POST /story/:story_id/to-track`

### Responsibility

- create track-ready downstream context directly from the canonical confirmed story version
- preserve provenance to the exact confirmed version

### Must Be

- the primary bridge from confirmed story into song creation

### Must Not Be

- bypassed by a client-rebuilt approximation when story-native generation is intended

## 14.9 Story To Poem

### Endpoint

`POST /story/:story_id/to-poem`

### Responsibility

- generate poem output from the canonical confirmed story version
- preserve provenance

### Must Follow

the same confirmed-version rule as track generation

## 14.10 Cancel Or Abandon Story

### Endpoint

`DELETE /story/:story_id` or explicit abandon endpoint

### Responsibility

- distinguish between logical abandonment and hard deletion

### Rule

Abandoning a draft must not imply silent destructive deletion unless the product explicitly says so.

## 15. Client Responsibility Matrix

## 15.1 Create Flow Container

Responsible for:
- lifecycle routing between drafting, review, confirmed, reopened
- authoritative restore sequencing
- save/error state visibility

Not responsible for:
- inventing canonical story state locally
- treating local booleans as confirmation truth

## 15.2 Drafting View

Responsible for:
- submitting conversational turns
- allowing direct edits where supported
- surfacing save and error state
- rendering latest canonical draft snippet

## 15.3 Review View

Responsible for:
- showing the editable draft
- showing latest integration changes
- exposing confirm and reopen actions

Not responsible for:
- being read-only while claiming to support editing

## 15.4 Local Cache

Responsible for:
- fast resume rendering
- temporary dirty-state preservation

Not responsible for:
- becoming the source of truth

## 16. Acceptance Criteria

The story creator should not be considered robust until all of the following are true:

1. The user can review and directly edit the canonical draft.
2. The user can revise prior meaning, not only append detail.
3. The product exposes whether the draft is saved, saving, stale, or failed.
4. The product surfaces what changed after a revision.
5. The product can preserve and display exact draft version identity at confirmation time.
6. Reopening after confirmation creates a new editable version rather than mutating the prior confirmed version invisibly.
7. Resume reconstructs from authoritative server state.
8. Song or poem generation consumes the exact confirmed story version.
9. A story shown as complete locally is also complete canonically.
10. The system no longer relies on client-side story reconstruction as the primary downstream source.

## 17. Migration Guidance For Evaluation

This section is not implementation work. It is a sequencing guide for future design review.

The redesign should be evaluated in this order:

1. Canonical draft and version semantics
2. Confirm and reopen semantics
3. Direct edit semantics
4. Review surface semantics
5. Resume and save-state semantics
6. Downstream story-to-track and story-to-poem provenance

If that order is reversed, the product risks polishing the UI around the same broken contract.

## 18. Final Position

The story creator should be treated as a draft editor with a conversational assistant, not a conversation flow with a decorative summary.

That is the central product decision this spec makes.

If the repo follows this contract, the story system can become robust, trustworthy, and suitable for multiple rounds of user revision.

If it does not, the product will continue to feel like a wizard that occasionally pretends to edit.
