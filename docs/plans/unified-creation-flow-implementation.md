# Unified Creation Flow — Implementation Plan v2

**Branch:** `version3`
**Design spec:** `docs/design/unified-creation-flow-v3.md`
**Risk level:** HIGH — production app, must not break existing flow
**Review status:** Revised after Codex audit (v1 was too optimistic and partly detached from real code)

---

## Lessons from v1 Review

The first plan treated this as a UI swap. It is not. The honest assessment:

1. **CreateFlowView is not a view router.** It owns flow state, launch bootstrap, resume persistence, error routing, song/poem branching, and downstream transitions. It IS the orchestration.
2. **StoryDraftSnapshot has no `.elements` or `.tone`.** The plan referenced imaginary API. Real contract: `narrative`, `completionScore`, `beats: [V2Beat]`, `factInventory: [StorySessionFact]`, `readiness`.
3. **There is no `createTrack()` method.** The real pipeline is a 4-step sequence in `CreatingTrackView.createTrack()`: confirmStoryV2 → generateStoryLyrics → storyToTrack → updateLyrics.
4. **RenderPollingService is a 65-line timer wrapper.** Render kickoff, retry, failure, reroll, full-render logic all live in `TrackPlayerFullView` (2,449 lines).
5. **ShareService, LibraryService, AudioPlayer don't exist as services.** TrackPlayerFullView uses AVPlayer directly and presents ShareSheetView inline.
6. **Resume/entitlements are architectural constraints, not polish.** They must shape the design from day one.

**Revised approach:** Extract before composing. Don't build the unified shell until the orchestration seams exist.

---

## Guiding Principles

1. **Extract, then compose.** Don't duplicate logic — extract it from existing views into reusable controllers/view-models, then build the unified view as a thin composition layer.
2. **Feature flag from day one.** Old flow preserved, flag defaults OFF.
3. **Resume/entitlements from day one.** Not Phase 7 — Phase 1.
4. **Song first, poems later.** Don't multiply uncertainty.
5. **Reuse existing working components.** AdaptiveConversationView and StoryConfirmationView work. Restyle, don't rewrite.
6. **Verify at every phase.** Old flow must keep working after every phase.

---

## Architecture: What Actually Needs to Happen

### Current Ownership (the real map)

```
CreateFlowView (646 lines)
├── Owns: flowState, setup, songFlow, poemFlow, storyEngine
├── Owns: resume persistence (onChange of every state)
├── Owns: error routing (alert-based)
├── Owns: flow initialization and type selection
└── Delegates to:
    ├── CreateFlowMergedSetupView (form: name, occasion, style)
    ├── AdaptiveConversationView (chat UI) ← V2StoryEngine
    ├── StoryConfirmationView (review story)
    ├── CreatingTrackView (202 lines) ← 4-step API pipeline
    ├── LyricsReviewView (1,259 lines) ← lyrics load/edit/approve/reroll
    └── TrackPlayerFullView (2,449 lines) ← render/play/share/reroll

Total downstream logic: ~4,556 lines of view-embedded business logic
```

### Target Ownership (after extraction)

```
Reusable Controllers (new):
├── TrackCreationController ← extracted from CreatingTrackView
│   Methods: createTrack(storyContext, voiceMode) → (trackId, versionNum, lyrics)
│
├── LyricsReviewController ← extracted from LyricsReviewView
│   Methods: loadLyrics(), approveLyrics(), rerollLyrics(), editSection()
│   State: lyrics, isLoading, moderationStatus, rerollCount
│
├── RenderController ← extracted from TrackPlayerFullView
│   Methods: startPreviewRender(), startFullRender(), retry(), checkStatus()
│   State: renderPhase, progress, isRendering, audioURL
│
├── PlaybackController ← extracted from TrackPlayerFullView
│   Methods: play(), pause(), seek(), share(), save()
│   State: isPlaying, currentTime, duration
│   Wraps: AVPlayer lifecycle
│
└── ShareController ← extracted from TrackPlayerFullView
    Methods: shareTrack(), generateShareLink()
    State: shareURL, isSharing

Existing (unchanged):
├── V2StoryEngine (chat orchestration)
├── CreateFlowAsyncService (API helpers)
├── SongFlowCoordinator (state transitions)
├── StoryFlowCoordinator (story session lifecycle)
├── RenderPollingService (timer — 65 lines, stays as-is)
└── CreateFlowResumeCoordinator (resume persistence)

Unified View (new, thin):
└── UnifiedCreateFlowView
    Composes: setup form → restyled chat → inline lyrics → inline render → inline player
    Delegates ALL logic to extracted controllers
    Owns: only the scroll layout and phase visibility
```

---

## Implementation Phases

### Phase 0: Extraction Sprint (Est: 2-3 sessions)

**Goal:** Extract business logic from view-embedded code into reusable controllers. This is the prerequisite for everything. No UI work yet.

**Why first:** If we build the unified UI first and wire later, we'll either duplicate 4,500 lines of logic or do a rushed extraction under pressure. Extract clean, test, verify old flow still works.

**Tasks:**

- [ ] 0.1 Extract `TrackCreationController` from `CreatingTrackView`
  - Extract the `createTrack()` pipeline (lines 123-176):
    - `confirmStoryV2(storyId:additionalNotes:)`
    - `generateStoryLyrics(storyId:)`
    - `storyToTrack(storyId:voiceMode:voiceGender:)`
    - `updateLyrics(trackId:versionNum:lyrics:)`
  - Expose: progress (0-100), statusMessage, result callback
  - Make `CreatingTrackView` delegate to this controller (verify no regression)

- [ ] 0.2 Extract `LyricsReviewController` from `LyricsReviewView`
  - Extract: lyrics loading, moderation check, section editing, approval, reroll
  - The view is 1,259 lines — most is business logic mixed with UI
  - Controller owns: `Lyrics` state, `isLoading`, `moderationResult`, `rerollCount`
  - Make `LyricsReviewView` delegate to this controller (verify no regression)

- [ ] 0.3 Extract `RenderController` from `TrackPlayerFullView`
  - Extract: render start (preview + full), retry logic, status polling, failure handling
  - Wraps `RenderPollingService` (the timer) + render API calls
  - Controller owns: `renderPhase`, `progress`, `audioURL`, `isRendering`
  - Make `TrackPlayerFullView` delegate to this controller (verify no regression)

- [ ] 0.4 Extract `PlaybackController` from `TrackPlayerFullView`
  - Extract: AVPlayer setup, play/pause/seek, time observation, audio session
  - Controller owns: `isPlaying`, `currentTime`, `duration`, `AVPlayer`
  - Make `TrackPlayerFullView` delegate to this controller (verify no regression)

- [ ] 0.5 Extract `ShareController` from `TrackPlayerFullView`
  - Extract: share link generation, share sheet presentation data
  - Controller owns: `shareURL`, `isGenerating`
  - Make `TrackPlayerFullView` delegate to this controller (verify no regression)

- [ ] 0.6 Verify: full regression test of old flow
  - Create a song end-to-end through the old flow
  - Create a poem end-to-end through the old flow
  - Resume after kill
  - All existing behavior preserved

**Output:** 5 controllers, zero UI changes, old flow works identically.

---

### Phase 1: Feature Flag + Production Shell (Est: 1 session)

**Goal:** Empty unified view behind feature flag, routing works, old flow preserved.

**Tasks:**

- [ ] 1.1 Add `useUnifiedCreateFlow` feature flag
  - `AppConfig` / feature flags table, default `false`
  - DEBUG toggle in `SettingsTabView`

- [ ] 1.2 Create `Flows/UnifiedCreateFlowView.swift` (empty shell)
  - Same init params as `CreateFlowView`
  - Accept: `apiClient`, `preselectedOccasion`, `preselectedType`, `onComplete`, `onCancel`
  - Owns: `V2StoryEngine`, `APIClientWrapper` (same as current)
  - Body: placeholder "Unified flow coming soon"

- [ ] 1.3 Define unified resume model
  - **Decision: reuse existing `CreateFlowState` enum for persistence.**
  - The unified view maps its internal phases to the same `CreateFlowState` milestones:
    - Chat phase → `.storyConversation`
    - Track creation → `.creatingTrack`
    - Lyrics review → `.lyricsReview`
    - Player → `.trackPlayer`
  - This means `CreateFlowResumeCoordinator` works unchanged.
  - The unified view interprets restored state to show the right inline phase.
  - On resume: if state is `.lyricsReview`, scroll to lyrics card. If `.trackPlayer`, scroll to player.
  - **Why not a new enum:** Adding a new phase model requires extending `CreateFlowStore`,
    `CreateFlowResumeCoordinator`, and the server-side resume endpoint. That's unnecessary risk
    when the existing states map 1:1 to unified phases.

- [ ] 1.4 Define entitlement check point
  - **Current reality:** There is NO client-side pre-create entitlement gate in the existing flow.
    `CreateFlowView` does not check credits before `CreatingTrackView`. Entitlements are loaded
    in settings/subscription surfaces, not inline in the creation flow.
  - **Decision for unified flow:** Add an explicit entitlement check BEFORE track creation (Phase 3).
    - Before calling `TrackCreationController`: query `apiClient.getEntitlements()`
    - If insufficient credits: show inline upgrade prompt (not a separate screen)
    - This is NEW behavior, not "same as current flow" — document it as such
  - **Why:** The current flow's lack of a pre-create gate is a gap, not a feature to preserve.

- [ ] 1.5 Route toggle in ExploreTab
  - Check flag → present `UnifiedCreateFlowView` or `CreateFlowView`
  - Identical parameters

- [ ] 1.6 Verify: old flow still works, flag OFF

---

### Phase 2: Chat Phase — Restyle Existing Components (Est: 1-2 sessions)

**Goal:** Working chat in the unified view using EXISTING engine and components.

**Critical insight from review:** Don't rewrite AdaptiveConversationView from mocks. Restyle it or compose with its internal pieces.

**Strategy choice: Compose, not rewrite.**
- `AdaptiveConversationView` already encapsulates: message rendering, input handling, speech flow,
  finish-early, inline story cards. That's 400+ lines of working logic.
- The unified view should EMBED or COMPOSE WITH existing pieces:
  - Reuse `InputBarView` (already extracted as its own component)
  - Reuse `ChatMessageBubble` for rendering (restyle colors/shape only)
  - Reuse `SuggestionChipsView` for quick replies
  - Reuse `ConversationHeader` or replace with unified header
- What changes: layout (no Chat/Story tab split), bubble styling (gold vs current),
  story card presentation (tabbed, not separate tab)
- What does NOT change: engine interaction, message submission, speech-to-text wiring

**Tasks:**

- [ ] 2.1 Keep `CreateFlowMergedSetupView` as pre-step
  - Name, occasion, style selection — proven UX, low risk
  - After setup → transition to chat phase in unified view

- [ ] 2.2 Integrate V2StoryEngine for chat
  - Map `engine.messages` (public `[V2Message]` property) → chat bubbles
    - NOT `engine.conversationStore.messages` — conversationStore is private
    - `V2Message` has `.role` (.user/.assistant), `.content`, `.timestamp`
  - Use the design mockup's bubble styles (gold user, left-accent AI)
  - Wire to REAL message data, not mock

- [ ] 2.3 Wire Story Elements tabs using REAL data contracts
  - **Elements tab**: Map `engine.draft.factInventory` → icon/label/value rows
    - `StorySessionFact` actual fields: `.text` (String), `.beat` (String?), `.sourceTurn` (Int?), `.status` (String?)
    - NO `.key` or `.value` — use `.beat` as label category, `.text` as the extracted content
    - Group facts by `.beat` to organize under icons
  - **Strength tab**: Map `engine.draft.beats` → progress bars
    - `V2Beat` actual fields: `.displayName` (String), `.strength` (Double 0-1), `.isFilled` (Bool, computed: strength >= 0.7), `.purpose` (String)
    - NO `.label`, `.progress`, or `.isComplete` — use `.displayName`, `.strength`, `.isFilled`
    - `V2Beat.strengthDots` gives 0-5 dot rating
  - **Completion**: `engine.draft.completionScore` (Int, 0-100) — this is correct

- [ ] 2.4 Wire input bar to engine
  - Send: `engine.submitAnswer(text)`
  - Mic: existing `SpeechInputContext` + `STTRouter`
  - Loading: `engine.isLoading`

- [ ] 2.5 Wire confirmation
  - When `engine.isComplete`:
    - Show confirmation with `engine.draft.displayNarrative`
    - Show beats summary

- [ ] 2.6 Verify: chat works end-to-end
  - Create story session, chat, see elements populate, confirm

---

### Phase 3: Track Creation + Lyrics (Est: 2 sessions)

**Goal:** After confirmation, create track and show lyrics inline.

**Prerequisite:** `TrackCreationController` and `LyricsReviewController` from Phase 0.

**Tasks:**

- [ ] 3.1 Wire "Create" to `TrackCreationController`
  - Build `StoryContext` from engine state (same as `finishStoryConversation()`)
  - Call controller's pipeline: confirm → generate lyrics → create track → sync lyrics
  - Show progress inline (status messages + progress bar)

- [ ] 3.2 Show lyrics inline using `LyricsReviewController`
  - On track created: controller loads lyrics
  - Display as inline card (design mockup's lyrics card format)
  - Handle moderation results inline

- [ ] 3.3 Wire editing
  - Quick reply chips → controller methods
  - "Love it" → `controller.approveLyrics()`
  - Reroll → `controller.rerollLyrics(type:)`
  - Edit section → inline editing UI

- [ ] 3.4 Entitlement check before creation (NEW — see Phase 1.4)
  - Call `apiClient.getEntitlements()` before track creation pipeline
  - If insufficient credits: show inline upgrade prompt with StoreKit purchase flow
  - This is NEW behavior — the current flow has no pre-create gate
  - Must handle: free tier limits, expired subscriptions, zero credits

- [ ] 3.5 Verify: create track, review lyrics, approve

---

### Phase 4: Rendering + Player (Est: 2 sessions)

**Goal:** After lyrics approved, show render progress and player inline.

**Prerequisite:** `RenderController`, `PlaybackController`, `ShareController` from Phase 0.

**Tasks:**

- [ ] 4.1 Wire render kickoff
  - After lyrics approved: `renderController.startPreviewRender()`
  - Show inline rendering card with real progress
  - Wire `RenderPollingService` through controller
  - Handle: timeout, retry, failure — all inline

- [ ] 4.2 Wire player
  - On render complete: `playbackController.play(url:)`
  - Show inline player card with real controls
  - Audio session management via controller

- [ ] 4.3 Wire share/reroll/save
  - Share: `shareController.shareTrack()`
  - Reroll: back to lyrics phase
  - Save: `onComplete(trackId, versionNum)` to dismiss

- [ ] 4.4 Wire full render flow
  - Preview → user approves → full render → final player
  - Same as current TrackPlayerFullView behavior

- [ ] 4.5 Verify: full song creation end-to-end
  - Chat → lyrics → render → play → share → done

---

### Phase 5: Resume + Edge Cases (Est: 1-2 sessions)

**Goal:** Handle every production edge case from day one architecture.

**This is NOT polish. This is correctness.**

**Tasks:**

- [ ] 5.1 Resume persistence
  - Persist unified flow phase on every state change
  - On relaunch: restore to correct phase
  - Resume render poll if interrupted mid-render
  - Resume lyrics review if killed during edit

- [ ] 5.2 Background handling
  - Render continues in background (existing `BackgroundTaskManager`)
  - Push notification on completion
  - Resume flow on notification tap

- [ ] 5.3 Rate limiting
  - Respect existing limits (20 previews/day, etc.)
  - Show inline messages, not alerts

- [ ] 5.4 Cancel at every phase
  - Cancel during chat: dismiss
  - Cancel during track creation: cancel task, dismiss
  - Cancel during render: stop poll, dismiss
  - Cancel during play: stop audio, dismiss

- [ ] 5.5 Error recovery at every phase
  - Network failure during chat: retry option inline
  - Track creation failure: retry or start over
  - Render failure: retry
  - All errors inline, never alerts

- [ ] 5.6 Accessibility
  - VoiceOver labels
  - Dynamic Type
  - Reduce Motion

- [ ] 5.7 Verify: every edge case from test matrix

---

### Phase 6: Testing + Cutover (Est: 2 sessions)

**Goal:** Prove it works, then flip the flag.

**Tasks:**

- [ ] 6.1 Full test matrix
  - [ ] Song creation (happy path)
  - [ ] Song with voice enrollment
  - [ ] Song reroll (lyrics only, full)
  - [ ] Network failure mid-chat
  - [ ] Network failure mid-render
  - [ ] App backgrounded during render
  - [ ] App killed and relaunched mid-lyrics
  - [ ] App killed and relaunched mid-render
  - [ ] Low credits / upgrade prompt
  - [ ] Rate limit hit
  - [ ] Cancel at every phase
  - [ ] Speech-to-text input
  - [ ] Instrumental-only mode
  - [ ] Custom lyrics mode

- [ ] 6.2 Cutover
  - Set `useUnifiedCreateFlow` default to `true`
  - Keep old flow code for 2 releases as fallback
  - Monitor crash/error rates for 1 week
  - Remove old flow code in subsequent release

---

### Phase 7: Poem Flow (Est: 1-2 sessions, AFTER song is stable)

**Goal:** Add poem support as a second rollout.

**Tasks:**

- [ ] 7.1 Adapt unified view for poem path
  - After confirmation → poem generation (reuse `PoemCreatingContentView` logic)
  - Show poem inline instead of lyrics
  - Handle gap questions as inline AI messages

- [ ] 7.2 Wire poem preview inline
  - Regenerate, save, share

- [ ] 7.3 Verify: poem end-to-end

---

## File Map (Revised)

### Phase 0 — New Files (Controllers)

| File | Extracted From | Lines (est) |
|------|---------------|-------------|
| `Controllers/TrackCreationController.swift` | `CreatingTrackView` | ~80 |
| `Controllers/LyricsReviewController.swift` | `LyricsReviewView` | ~400 |
| `Controllers/RenderController.swift` | `TrackPlayerFullView` | ~300 |
| `Controllers/PlaybackController.swift` | `TrackPlayerFullView` | ~200 |
| `Controllers/ShareController.swift` | `TrackPlayerFullView` | ~100 |

### Phase 1-5 — New Files (UI)

| File | Purpose |
|------|---------|
| `Flows/UnifiedCreateFlowView.swift` | Production unified view (composition layer) |

### Modified Files

| File | Change |
|------|--------|
| `CreatingTrackView.swift` | Delegates to `TrackCreationController` |
| `LyricsReviewView.swift` | Delegates to `LyricsReviewController` |
| `TrackPlayerFullView.swift` | Delegates to `RenderController` + `PlaybackController` + `ShareController` |
| `SettingsTabView.swift` | Feature flag toggle |
| `ExploreTabView.swift` | Routing toggle |

### Untouched Files

| File | Reason |
|------|--------|
| `CreateFlowView.swift` | Preserved as fallback — delegates to same controllers |
| `CreateFlowContracts.swift` | Shared contracts |
| `V2Story/*` | Engine unchanged |
| All coordinator files | Shared between old and new flow |

---

## Risk Mitigation (Revised)

| Risk | Mitigation |
|------|-----------|
| Extraction breaks old flow | Each controller extraction has a regression test gate |
| Unified flow breaks production | Feature flag defaults OFF |
| AVPlayer in ScrollView | PlaybackController manages singleton player; test on device |
| Memory (long scroll) | Profile with Instruments after Phase 4 |
| Engine observation misses | Wire to real engine in Phase 2, test immediately |
| Resume gaps | Built into architecture from Phase 1, not bolted on |
| Poem flow complexity | Deferred to Phase 7 after song is stable |

---

## Revised Timeline

| Phase | Sessions | Risk | Dependency |
|-------|----------|------|------------|
| 0. Extraction sprint | 2-3 | Medium | None — must be first |
| 1. Feature flag + shell | 1 | Low | Phase 0 |
| 2. Chat phase | 1-2 | Medium | Phase 1 |
| 3. Track + lyrics | 2 | High | Phase 0 + Phase 2 |
| 4. Render + player | 2 | High | Phase 0 + Phase 3 |
| 5. Resume + edge cases | 1-2 | High | Phase 4 |
| 6. Testing + cutover | 2 | High | Phase 5 |
| 7. Poem flow | 1-2 | Medium | Phase 6 |
| **Total** | **12-16 sessions** | | |

This is 50% longer than v1's estimate. The difference is honesty. The extraction work exists whether we plan for it or not — v1 just hid it inside "wiring" tasks that would have blown up on contact with reality.

---

## What Changed from v1

| v1 Claim | v2 Reality |
|----------|-----------|
| "Replaces the UI layer only" | Replaces the UI AND requires extracting ~4,500 lines of view-embedded business logic |
| `engine.draft.elements` / `.tone` | Real API: `factInventory` (`.text`, `.beat`), `beats` (`.displayName`, `.strength`, `.isFilled`), `completionScore`, `displayNarrative` |
| `engine.conversationStore.messages` | Private. Public: `engine.messages` (`[V2Message]`) |
| `StorySessionFact.key/value` | Doesn't exist. Real: `.text` (String), `.beat` (String?) |
| `V2Beat.label/progress/isComplete` | Doesn't exist. Real: `.displayName`, `.strength` (Double), `.isFilled` (computed) |
| `CreateFlowAsyncService.createTrack()` | Does not exist. Real pipeline: 4-step sequence in `CreatingTrackView` |
| `RenderPollingService` owns rendering | 65-line timer. Real render logic: 2,449 lines in `TrackPlayerFullView` |
| `ShareService` / `LibraryService` / `AudioPlayer` | Don't exist. All embedded in `TrackPlayerFullView` |
| Resume in Phase 7 | Resume in Phase 1 (reuses existing `CreateFlowState` milestones) |
| "Entitlement check same as current" | Current flow has NO pre-create gate. Unified flow adds one (new behavior) |
| "Reuse AdaptiveConversationView" | Compose with its pieces (InputBarView, ChatMessageBubble), don't rewrite from mocks |
| Poems in Phase 6 | Poems in Phase 7 (after song is stable) |
| 8-12 sessions | 12-16 sessions |

## Codex Review Status

| Finding | Status |
|---------|--------|
| v1: Not a UI-only swap | Fixed in v2 — extraction-first approach |
| v1: Imaginary engine API (elements/tone) | Fixed in v2 — corrected to real contracts |
| v1: No createTrack() method | Fixed in v2 — documented real 4-step pipeline |
| v1: RenderPollingService misunderstood | Fixed in v2 — extraction from TrackPlayerFullView |
| v1: Service boundaries don't exist | Fixed in v2 — extraction plan for 5 controllers |
| v1: Resume/edge cases misplaced | Fixed in v2 — Phase 1 from day one |
| v2: conversationStore.messages is private | **Fixed in v2.1** — use `engine.messages` |
| v2: StorySessionFact.key/value wrong | **Fixed in v2.1** — use `.text`, `.beat` |
| v2: V2Beat.label/progress/isComplete wrong | **Fixed in v2.1** — use `.displayName`, `.strength`, `.isFilled` |
| v2: Resume model ambiguous | **Fixed in v2.1** — reuse existing CreateFlowState milestones |
| v2: Entitlement "same as current" is false | **Fixed in v2.1** — new pre-create gate, documented as new behavior |
| v2: Chat phase drifts toward rewrite | **Fixed in v2.1** — compose with existing InputBarView/ChatMessageBubble |
