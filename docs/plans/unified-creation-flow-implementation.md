# Unified Creation Flow — Implementation Plan

**Branch:** `version3`
**Design spec:** `docs/design/unified-creation-flow-v3.md`
**Risk level:** HIGH — production app, must not break existing flow

---

## Guiding Principle: Zero Breakage

The current `CreateFlowView` state machine works in production. We will NOT:
- Delete or modify `CreateFlowView` until the unified flow is fully wired and tested
- Remove any existing flow states, coordinators, or services
- Change the `CreateFlowState` enum
- Modify `ExploreTabView` routing until the unified flow passes all test scenarios

Instead, we will:
- Build the unified flow as a **parallel path** behind a feature flag
- Share ALL existing backend services (V2StoryEngine, CreateFlowStore, etc.)
- Toggle between old flow and new flow via a single flag
- Only make the unified flow default after full verification

---

## Architecture Overview

### Current Flow (CreateFlowView)
```
ExploreTab → CreateFlowView (state machine)
  → typeSelection → createMerged (form) → storyConversation (chat)
  → creatingTrack (API) → lyricsReview (separate screen) → trackPlayer
```

### Unified Flow (UnifiedCreateFlowView)
```
ExploreTab → UnifiedCreateFlowView (single scroll)
  → chat (inline) → confirmation (inline) → lyrics (inline card)
  → rendering (inline card) → player (inline card)
```

### What stays the same:
- `V2StoryEngine` — drives the chat conversation
- `CreateFlowAsyncService` — creates tracks via API
- `SongFlowCoordinator` / `PoemFlowCoordinator` — manages state transitions
- `StoryFlowCoordinator` — starts/completes story sessions
- `RenderPollingService` — polls for render completion
- `APIClient` — all network calls
- `StoreKitManager` — entitlement checks
- All backend API endpoints unchanged

### What changes:
- `UnifiedCreationFlowView` replaces the UI layer only
- No more separate screens — everything is inline
- The state machine still exists but drives inline state, not view switching
- `LyricsReviewView` content is embedded inline
- `TrackPlayerView` content is embedded inline

---

## Implementation Phases

### Phase 1: Feature Flag + Shell (Est: 1 session)

**Goal:** Wire the unified view to the real engine with feature flag toggle.

**Tasks:**
- [ ] 1.1 Add `useUnifiedCreateFlow` feature flag
  - Add to `AppConfig` / feature flags table
  - Default: `false` (old flow active)
  - Settable via server config OR local DEBUG toggle in Settings
  - Location: `SettingsTabView` — add toggle in DEBUG section

- [ ] 1.2 Create `UnifiedCreateFlowView` (production version)
  - New file: `Flows/UnifiedCreateFlowView.swift` (NOT in CreationFlowRedesign/)
  - Copy structure from design mockup
  - Remove `#if DEBUG`, remove mock data
  - Accept same init params as `CreateFlowView`:
    - `apiClient`, `preselectedOccasion`, `preselectedType`
    - `onComplete`, `onCancel`
  - Wire `V2StoryEngine` (real, not mock)
  - Wire `APIClientWrapper` for auth

- [ ] 1.3 Add routing toggle in ExploreTab/MainTab
  - Where `CreateFlowView` is presented, check flag
  - If `useUnifiedCreateFlow`: present `UnifiedCreateFlowView`
  - Else: present `CreateFlowView` (existing)
  - Both receive identical parameters

- [ ] 1.4 Verify: old flow still works with flag OFF
  - Build, run, create a song through the old flow
  - Confirm zero regressions

**Safety:** Flag defaults OFF. Old flow is untouched. Rollback = set flag false.

---

### Phase 2: Chat Phase — Wire V2StoryEngine (Est: 1-2 sessions)

**Goal:** Replace mock chat messages with the real V2StoryEngine conversation.

**Tasks:**
- [ ] 2.1 Integrate V2StoryEngine into unified view
  - Engine already handles: session creation, message send/receive, beat tracking
  - Map `engine.messages` → chat bubble list
  - Map `engine.draft` → story elements card data
  - Map `engine.completionScore` → strength progress bars
  - Map `engine.isComplete` → show confirmation section

- [ ] 2.2 Wire InputBarView to engine
  - On send: call `engine.submitAnswer(text)`
  - On mic: use existing `SpeechInputContext` + `STTRouter`
  - Show typing indicator while engine processes
  - Handle errors (network, timeout)

- [ ] 2.3 Wire Story Elements tabs
  - **Elements tab**: Map `engine.draft.elements` → icon/label/value rows
  - **Strength tab**: Map `engine.draft.beats` → progress bars
  - Live-update as messages arrive

- [ ] 2.4 Wire setup flow (name, occasion, style)
  - Option A: Keep the existing `CreateFlowMergedSetupView` as a pre-step
  - Option B: Extract name/occasion from first message (AI asks)
  - **Recommended: Option A** — least risk, proven UX
  - Style selection: use `CollapsibleStylePicker` at bottom

- [ ] 2.5 Wire confirmation
  - When `engine.isComplete == true`:
    - Show "READY" divider
    - Show confirmation card with `engine.draft.narrative`
    - Show mood pills from `engine.draft.tone`
  - "Keep chatting" stays available (input bar always visible)

- [ ] 2.6 Verify: chat works end-to-end
  - Create a story session via chat
  - Verify story elements populate
  - Verify strength bars update
  - Verify confirmation appears when complete
  - Test: cancel mid-conversation, error recovery, speech input

**Risks:**
- V2StoryEngine expects `AdaptiveConversationView` patterns — verify the message format compatibility
- Engine uses `@Observable` — ensure unified view correctly observes changes

---

### Phase 3: Lyrics Phase — Inline Lyrics Card (Est: 1-2 sessions)

**Goal:** Replace the separate `LyricsReviewView` with an inline lyrics card.

**Tasks:**
- [ ] 3.1 Create inline lyrics card component
  - Move from mock data to real `Lyrics` model
  - Map `Lyrics.sections` → section cards (Verse, Chorus, Bridge, etc.)
  - Show style badge from selected style

- [ ] 3.2 Wire "Create" button to track creation
  - On tap: call `CreateFlowAsyncService.createTrack()`
  - Show "Writing lyrics..." message while creating
  - On success: display lyrics card inline
  - On error: show error message inline (not alert)

- [ ] 3.3 Add inline editing via quick replies
  - Quick reply chips: "Love it", "Change the chorus", "Make it funnier", "Edit a line"
  - "Love it" → approve lyrics, advance to rendering
  - Others → send feedback to engine, get revised lyrics
  - Revised section appears as new card below

- [ ] 3.4 Wire reroll functionality
  - Map to existing `RerollType` system
  - Lyrics-only reroll: regenerate lyrics, keep instrumental
  - Full reroll: regenerate everything

- [ ] 3.5 Verify: lyrics creation and editing
  - Create lyrics through the flow
  - Edit via quick replies
  - Approve lyrics
  - Test: reroll, error during creation, network failure

**Key integration point:** `LyricsReviewView` currently uses `apiClient.approveLyrics()` — the inline version must call the same endpoint.

---

### Phase 4: Rendering Phase — Inline Progress (Est: 1 session)

**Goal:** Replace the separate rendering/polling screen with an inline progress card.

**Tasks:**
- [ ] 4.1 Wire RenderPollingService
  - After lyrics approved: start render via existing API
  - Poll for completion using `RenderPollingService`
  - Map poll status → progress bar (0-100%)
  - Map poll steps → step checklist (lyrics, melody, arrangement, vocals, mix)

- [ ] 4.2 Create inline rendering card
  - Show waveform animation (deterministic bars)
  - Show `RenderingProgressCard` with real progress
  - Show step checklist with real step status
  - Auto-advance to player when render completes

- [ ] 4.3 Handle render failures
  - Timeout: show retry button inline
  - Server error: show error message + retry
  - Maintain all state — don't lose the conversation

- [ ] 4.4 Verify: rendering progress
  - Approve lyrics → see rendering progress
  - Verify progress updates in real-time
  - Verify auto-advance to player on completion
  - Test: cancel during render, timeout, retry

**Key integration point:** `RenderPollingService.startPolling()` — same service, just different UI.

---

### Phase 5: Player Phase — Inline Player (Est: 1 session)

**Goal:** Embed the song player inline in the conversation thread.

**Tasks:**
- [ ] 5.1 Create inline player card
  - Reuse `SongPlayerCard` component from design
  - Wire to real audio playback (existing `AudioPlayer` service)
  - Wire Share/Reroll/Save actions to existing services

- [ ] 5.2 Wire share functionality
  - Share button → existing `ShareService.shareTrack()`
  - Deep link generation → existing `ShareTokenService`

- [ ] 5.3 Wire reroll from player
  - "Reroll" → go back to lyrics phase with new lyrics
  - Reuse existing reroll flow logic from `SongFlowCoordinator`

- [ ] 5.4 Wire "Done" action
  - Save to library → existing `LibraryService`
  - Call `onComplete(trackId, versionNum)` to dismiss
  - Clear all state

- [ ] 5.5 Verify: player works end-to-end
  - Play audio
  - Share track
  - Reroll
  - Save and dismiss
  - Test: audio errors, share failures

---

### Phase 6: Poem Flow (Est: 1 session)

**Goal:** Support poem creation through the same unified flow.

**Tasks:**
- [ ] 6.1 Adapt for poem path
  - When `selectedType == .poem`:
    - Skip lyrics card (poems don't have lyrics)
    - After confirmation → poem generation (PoemCreatingContentView logic)
    - Show generated poem inline (like lyrics card but poem format)
    - Regenerate = reroll equivalent

- [ ] 6.2 Wire poem preview inline
  - Map existing `PoemPreviewView` content to inline card
  - "Save" → existing poem save flow
  - "Regenerate" → re-generate poem

- [ ] 6.3 Handle poem gap questions
  - If server needs more details → show question inline as AI message
  - User responds → re-submit
  - Seamless within the chat flow

- [ ] 6.4 Verify: poem flow end-to-end
  - Create poem through unified flow
  - Handle gap questions
  - Save poem

---

### Phase 7: Edge Cases + Polish (Est: 1-2 sessions)

**Goal:** Handle all production edge cases the current flow handles.

**Tasks:**
- [ ] 7.1 Resume flow on app restart
  - Persist unified flow state (same as `CreateFlowResumeCoordinator`)
  - On relaunch: restore to correct phase
  - Resume rendering poll if interrupted

- [ ] 7.2 Entitlement checks
  - Check credits before creating
  - Show upgrade prompt if insufficient
  - Wire to existing `StoreKitManager` / `BillingService`

- [ ] 7.3 Rate limiting
  - Respect existing rate limits (20 previews/day, etc.)
  - Show appropriate messages inline

- [ ] 7.4 Background handling
  - Render continues in background
  - Push notification on completion
  - Resume flow on notification tap

- [ ] 7.5 Accessibility
  - VoiceOver labels on all elements
  - Dynamic Type support
  - Reduce Motion support

- [ ] 7.6 Animation + transitions
  - Smooth scroll to new content as it appears
  - Typing indicator animation
  - Progress bar animation
  - Phase transition animations

---

### Phase 8: Testing + Cutover (Est: 1-2 sessions)

**Goal:** Verify everything works, then make unified flow the default.

**Tasks:**
- [ ] 8.1 Test matrix
  - [ ] Song creation (happy path)
  - [ ] Poem creation (happy path)
  - [ ] Song with voice enrollment
  - [ ] Song reroll (lyrics, full)
  - [ ] Network failure mid-chat
  - [ ] Network failure mid-render
  - [ ] App backgrounded during render
  - [ ] App killed and relaunched
  - [ ] Low credits / upgrade prompt
  - [ ] Rate limit hit
  - [ ] Cancel at every phase
  - [ ] Speech-to-text input
  - [ ] Instrumental-only mode
  - [ ] Custom lyrics mode

- [ ] 8.2 A/B test (optional)
  - Enable unified flow for X% of users via feature flag
  - Compare completion rates, time-to-create, error rates

- [ ] 8.3 Cutover
  - Set `useUnifiedCreateFlow` default to `true`
  - Keep old flow code for 2 releases as fallback
  - Monitor crash/error rates for 1 week
  - Remove old flow code in subsequent release

---

## File Map

| New File | Purpose |
|----------|---------|
| `Flows/UnifiedCreateFlowView.swift` | Production unified view |
| `Flows/UnifiedCreateFlowStore.swift` | State management for unified phases |
| `Components/InlineLyricsCard.swift` | Reusable inline lyrics display |
| `Components/InlineRenderingCard.swift` | Reusable inline rendering progress |
| `Components/InlinePlayerCard.swift` | Reusable inline song player |

| Modified File | Change |
|---------------|--------|
| `Tabs/SettingsTabView.swift` | Feature flag toggle |
| `Tabs/ExploreTabView.swift` | Routing toggle |
| `Flows/CreateFlowSetupViews.swift` | Extract setup view for reuse |
| `Services/CreateFlowStore.swift` | Add unified flow state persistence |

| Untouched Files | Reason |
|-----------------|--------|
| `CreateFlowView.swift` | Preserved as fallback |
| `CreateFlowContracts.swift` | Shared contracts |
| `CreateFlowAsyncService.swift` | Shared services |
| `CreateFlowLifecycleCoordinator.swift` | Shared coordinator |
| `V2Story/*` | Engine unchanged |
| `LyricsReviewView.swift` | Preserved, content extracted |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Unified flow breaks production | Feature flag defaults OFF; old flow untouched |
| State machine incompatibility | Unified flow uses same coordinators, just different UI |
| Audio playback in scroll view | Test extensively; may need singleton player |
| Memory usage (long scroll) | Use LazyVStack for chat, measure with Instruments |
| Engine observation misses | Verify @Observable works with all inline components |
| Resume after crash | Reuse existing resume coordinator pattern |
| Entitlement edge cases | Identical checks as current flow |

---

## Estimated Timeline

| Phase | Sessions | Risk |
|-------|----------|------|
| 1. Feature flag + shell | 1 | Low |
| 2. Chat phase | 1-2 | Medium |
| 3. Lyrics phase | 1-2 | Medium |
| 4. Rendering phase | 1 | Low |
| 5. Player phase | 1 | Low |
| 6. Poem flow | 1 | Medium |
| 7. Edge cases + polish | 1-2 | High |
| 8. Testing + cutover | 1-2 | High |
| **Total** | **8-12 sessions** | |

Each phase is independently testable. If any phase blocks, the feature flag keeps users on the working old flow.
