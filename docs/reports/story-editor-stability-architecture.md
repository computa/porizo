# Story Editor Stability Architecture

## Purpose

This document defines the stability-first architecture for Porizo's story chat and review editor on iPhone. It replaces ad hoc patching with a structure designed to keep the app responsive under long transcripts, active editing, background persistence, and network-driven draft updates.

The goal is not merely to "avoid crashes." The goal is:

- the editor must remain responsive while typing
- the transcript must remain responsive while streaming new turns
- review and editing must not block the rest of the app
- local persistence must never dominate the interaction path
- the same visible user flow must remain intact

Current visible flow to preserve:

- create entry
- conversational drafting
- review/edit
- continue into song or poem creation

## Source Guidance

This architecture is grounded in Apple guidance on responsiveness, hangs, and text editing.

Primary sources:

- Apple SwiftUI performance analysis: https://developer.apple.com/documentation/swiftui/performance-analysis
- Apple hang diagnostics overview: https://developer.apple.com/documentation/xcode/understanding-hangs-in-your-app
- Apple shipping-app performance analysis: https://developer.apple.com/documentation/Xcode/analyzing-the-performance-of-your-shipping-app
- Apple `UITextView` / Text Kit guidance: https://developer.apple.com/library/archive/documentation/StringsTextFonts/Conceptual/TextAndWebiPhoneOS/CustomTextProcessing/CustomTextProcessing.html
- Apple text view lifecycle and selection behavior: https://developer.apple.com/library/archive/documentation/StringsTextFonts/Conceptual/TextAndWebiPhoneOS/ManageTextFieldTextViews/ManageTextFieldTextViews.html
- WWDC21 "Understand and eliminate hangs from your app": https://developer.apple.com/videos/play/wwdc2021/10258/
- WWDC22 "Track down hangs with Xcode and on-device detection": https://developer.apple.com/videos/play/wwdc2022/10082/
- WWDC23 "Analyze hangs with Instruments": https://developer.apple.com/videos/play/wwdc2023/10248/

## Apple Guidance Distilled

The relevant Apple guidance reduces to a few rules:

- Keep the main thread free for event handling and display updates.
- Avoid file I/O, synchronization, and long-running work on the UI path.
- Reduce the frequency of SwiftUI updates, not only their cost.
- Profile hangs directly with hang-aware tools; do not infer all hangs from crash logs.
- Use the system text stack for heavy editing rather than forcing complex editing behavior through decorative UI abstractions.

Inferences for this repo:

- Large `@MainActor` observable objects are dangerous when they mix editor state, transcript state, persistence state, and network state.
- A serious mobile editor should not treat each keystroke as a canonical session mutation.
- SwiftUI can still frame the screen, but the actual editing core should be isolated and simple.

## Current Failure Shape In This Repo

### 1. One large `session` object drives too much UI

Relevant files:

- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- `PorizoApp/PorizoApp/V2Story/V2StoryTypes.swift`
- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
- `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift`

Symptoms:

- transcript, draft, revision metadata, provenance, and review controls all derive from one large observable session
- any broad session mutation risks invalidating more of the screen than necessary
- the entire editor surface is too sensitive to changes that should be local

### 2. Full-session persistence is too close to the typing path

Relevant files:

- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- `PorizoApp/PorizoApp/V2Story/V2SessionStore.swift`

Problem:

- session persistence currently encodes and writes the full `V2Session`
- if editor state writes into that session too often, typing competes with JSON encode + file write churn

Even when writes happen on a background queue, the app still pays for:

- frequent session publishes
- repeated encode requests
- more redraw opportunities
- more contention between typing and persistence

### 3. The review screen is too dense for one state domain

Relevant file:

- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`

This screen currently contains:

- narrative display
- draft diff
- edit-intent controls
- fact inventory
- conflict UI
- revision history
- provenance
- final notes
- active editor fields

That is too much to bind to one hot observable object if we want a stable editor.

### 4. The transcript is append-heavy but still rebuilt too broadly

Relevant file:

- `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift`

Risk factors:

- `ScrollViewReader` auto-scrolls on message-count changes
- latest message can animate with typewriter behavior
- inline story cards derive from overall narrative state
- suggestion chips and loading indicators share the same view pass

This is manageable only if transcript updates stay narrow and append-oriented.

## Architecture Decision

The story UI should be split into four state domains:

1. `StoryTranscriptStore`
2. `StoryDraftEditorStore`
3. `StoryReviewStore`
4. `StorySyncCoordinator`

`V2StoryEngine` should stop being the single hot object that every part of the UI talks to on every interaction.

## Target State Model

### `StoryTranscriptStore`

Owns:

- visible transcript rows
- latest AI prompt metadata
- suggestion chips
- lightweight inline story preview state

Must support:

- append turn
- patch last turn metadata
- scroll-to-bottom triggers
- read-only copy/select behavior

Must not own:

- mutable editor text
- revision history detail
- persistence scheduling

### `StoryDraftEditorStore`

Owns:

- current editable draft text buffer
- current final-notes buffer
- current structured edit intent
- current selected target fact/conflict
- current local unsaved-change status
- selection state if using `UITextView`

Rules:

- typing is local to this store
- keystrokes do not mutate the canonical session directly
- sync to canonical state happens on debounce, blur, submit, and scene transitions

This is the hottest state in the system and must stay the smallest.

### `StoryReviewStore`

Owns:

- canonical draft snapshot currently being reviewed
- fact inventory
- open conflicts
- revision history
- latest diff
- provenance
- lifecycle state
- clarification/pending-revision state

Rules:

- mostly read-heavy
- updates only when server state changes or a revision is applied
- should not re-render for every keystroke in the editor

### `StorySyncCoordinator`

Owns:

- network requests
- local persistence scheduling
- resume reconciliation
- debounce policies
- background flush behavior
- server-authoritative refresh policy

Rules:

- all persistence policy lives here
- all "when do we flush local draft to canonical state?" logic lives here
- no view should decide persistence policy on its own

## Editor Technology Decision

### Recommendation: use a UIKit-backed editor for the main draft editing surface

Use a wrapped `UITextView` as the actual editing control for the main review editor and final-notes editor.

Why:

- Apple's text system is built around `UITextView` / Text Kit for large editable text
- native selection, copy, cursor movement, keyboard handling, and selection tracking are stronger there
- `UITextViewDelegate` gives explicit editing lifecycle hooks
- selection changes can be observed directly
- the editing core becomes more predictable than a heavily decorated SwiftUI `TextEditor`

SwiftUI should still provide:

- layout
- chrome
- cards
- buttons
- status banners
- segmented tabs

But the editable text core should be UIKit-backed.

### Non-goal

Do not move the entire screen to UIKit. Only move the editing core where the platform support is stronger.

## Update Frequency Rules

### Allowed per keystroke

- local text buffer mutation inside editor store
- cursor/selection updates inside editor store
- character counter updates
- local dirty-state updates

### Not allowed per keystroke

- full canonical session mutation
- full transcript recomputation
- revision history recomputation
- JSON persistence of the whole session
- provenance recalculation
- broad `ObservableObject` publishes across the full story feature

## Persistence Model

Persistence must move from "save whenever session changes" to checkpoint-oriented persistence.

### Persist immediately on

- successful revision apply
- successful server response that changes canonical draft
- explicit user confirmation
- app backgrounding / scene phase changes
- navigation away from editor screen

### Persist on short debounce

- local draft buffer
- final notes buffer

### Never persist synchronously on the visible UI path

- no blocking disk I/O on the main actor
- no synchronization primitives on the main actor
- no synchronous reconciliation while typing

## Resume Model

Resume should work in two layers:

### Layer 1: canonical resume

- fetch server-authoritative draft state
- fetch lifecycle, version, pending revision, review metadata

### Layer 2: local draft recovery

- restore unsent local draft buffer
- compare local unsent buffer against server version
- explicitly surface divergence to the user

UI outcomes:

- "Recovered unsent local edit"
- "Server draft changed while you were away"
- "Reviewing newer server draft"
- "Local unsent edit needs reconciliation"

This must be explicit, not silent.

## Transcript Rendering Model

The transcript should be append-oriented and row-isolated.

### Rules

- message rows must be stable and identifiable by immutable IDs
- appending a new row must not cause unrelated rows to recompute if avoidable
- inline story preview should subscribe to narrow summary state, not the whole draft object
- auto-scroll should be event-driven, not broad-state-driven

### Avoid

- broad transcript invalidation when only review metadata changes
- animation on every state change
- coupling the latest loading state to the whole transcript tree

## Review Screen Composition

The review screen should be decomposed into stable blocks with separate inputs:

- `StoryDraftCardView`
- `StoryDraftEditorView`
- `DraftDiffView`
- `FactInventoryView`
- `ConflictResolutionView`
- `RevisionHistoryView`
- `ProvenanceView`
- `FinalNotesEditorView`

Each block should depend only on the data it needs.

The current `StoryConfirmationView` is too monolithic for a stability-sensitive screen.

## Concurrency and Isolation Rules

### Current issue

`V2StoryEngine` is `@MainActor` and currently does too much.

### Target

- UI-facing observable state may remain `@MainActor`
- persistence, transformation, and reconciliation work should move off the main actor
- long JSON encode/decode and disk writes must never share the typing loop

### Specific rule

Main actor owns:

- visible state mutation
- applying finished results to UI state

Background / detached work owns:

- serialization
- disk I/O
- diff preparation if expensive
- session snapshotting if expensive

## Instrumentation Plan

If hangs continue after the architectural split starts, use Apple's hang tooling in this order:

1. Thread Performance Checker during development
2. Time Profiler with hang labeling
3. Hangs instrument
4. SwiftUI View Body instrument when the stall looks render-related
5. On-device hang detection in iOS Developer settings
6. Xcode Organizer hang diagnostics for field behavior

This is the correct Apple-aligned workflow. Do not keep guessing from UX symptoms alone.

## Recommended Build Sequence

### Phase 1: Stabilize current architecture without visible flow changes

- keep current flow intact
- isolate review draft text into local editor state
- move persistence into explicit coordinator logic
- stop broad per-keystroke canonical session writes

### Phase 2: Split the hot state domains

- extract transcript store
- extract editor store
- extract review store
- make `V2StoryEngine` a coordinator/facade instead of the one hot session bag

### Phase 3: Replace the main editing core

- wrap `UITextView` for draft editing
- wrap `UITextView` for final notes if needed
- enable robust selection/copy/paste and selection tracking

### Phase 4: Reduce transcript rendering pressure

- isolate row rendering
- reduce view invalidation breadth
- narrow auto-scroll and animation triggers

### Phase 5: Profile on device and trim remaining hot spots

- real-device hang capture
- SwiftUI body/update profiling
- final iteration based on evidence, not assumptions

## Repo-Specific Recommendations

### Highest-priority code areas

- `PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift`
- `PorizoApp/PorizoApp/V2Story/V2SessionStore.swift`
- `PorizoApp/PorizoApp/V2Story/Views/StoryConfirmationView.swift`
- `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift`

### Near-term decision

Do not keep adding more behavior into `StoryConfirmationView` until state ownership is split. That file is already carrying too much interactive responsibility for a stability-sensitive mobile surface.

### Strong recommendation

Treat the current story feature as two products sharing one screen shell:

- a chat collector
- a draft editor

They should share a flow, not share one giant hot state object.

## Acceptance Criteria

The architecture work is successful when:

- typing in the review editor does not visibly stall the UI
- long transcripts remain scrollable while editing exists elsewhere in the flow
- resume behavior is explicit and does not silently overwrite local edits
- review metadata does not re-render the transcript unnecessarily
- local draft persistence survives app backgrounding without degrading typing
- on-device hang detection no longer flags this feature under normal edit/review usage

## Bottom Line

The stable version of this feature is not "the same SwiftUI screen with more guards."

It is:

- local hot editor state
- separated observable domains
- checkpoint-based persistence
- UIKit-backed text editing where mobile editing behavior matters most
- Apple hang tooling used as the arbiter for the remaining work

That is the architecture most likely to make this story editor feel reliable on a real iPhone.
