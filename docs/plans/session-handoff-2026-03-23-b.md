# Session Handoff — March 23, 2026 (Session B)

## What Was Done This Session

### Phase 1: Fixed All 8 Codex Review Findings

Commit `68f7d6b` — Fixed every issue from the Codex code review:

1. **Bootstrap/resume** — `initializeFlow()` with `CreateFlowBootstrapAction.resolve()`, `.typeSelection` phase for no-type launches
2. **Song-entry forks** — `hasOwnLyrics` → CustomCreateView, instrumental seeded via `description` field
3. **Task cancellation** — `creationTask` stored and cancelled properly
4. **Speech-to-text** — `.fullScreenCover` for `SpeechInputView`
5. **Billing gate** — `checkEntitlementsForSong()` calls `getBillingEntitlements()`, shows SubscriptionView upgrade prompt
6. **Confirmation guard + edit** — `.disabled` when loading/revision pending, "Edit" button → `enterReviewEditMode()`
7. **Feature flag** — `@AppStorage` defaults to `AppConfig.useUnifiedCreateFlow`
8. **Controller wiring** — TrackPlayerFullView: 2,449 → 968 lines (PlaybackController + RenderController). ShareSheetView: 939 → 747 lines (ShareController). Dead `createTask` in TrackCreationController removed.

### Phase 2: All-in-Chat B+1 Refactor

Commits `985ed4a`, `a41b91b`, `be81fce` — Complete redesign to match B+1 design spec:

- **Removed setup form** — replaced with inline name prompt in chat
- **Removed full-screen phases** for lyrics, voice, creating, rendering, player
- **Added `SongProgress` enum** — tracks song lifecycle within `.chat` phase
- **Built 5 inline card views** in `Flows/InlineCards/`:
  - `VoiceSelectionChips.swift` — AI Female/Male/My Voice suggestion chips
  - `InlineCreatingCard.swift` — track creation progress ring
  - `InlineLyricsCard.swift` — lyrics review with LyricsReviewController, quick-reply chips
  - `InlineRenderingCard.swift` — 5-step rendering progress with deterministic waveform
  - `InlinePlayerCard.swift` — player with scrubber, transport, Get Full Song, Share/Reroll/Done
- **Style picker + mood pills** in confirmation card
- **Two-stage render preserved** — preview first, full render on explicit "Get Full Song" with billing hold
- **Early lyrics callback** — `onLyricsGenerated` at step 2 (25% progress), read-only until track exists
- **Resume reconstruction** — maps persisted state to `songProgress`, fetches server state
- **Scroll back-off** — detects user scrolling up, suppresses auto-scroll until user returns to bottom

## Current State

### Branch: `version3`
```
be81fce Complete all-in-chat steps: style picker, mood pills, resume, scroll back-off
a41b91b All-in-chat B+1: inline cards replace full-screen phases
985ed4a Skip setup form — go straight to chat with inline name prompt
68f7d6b Fix all 8 Codex review findings for unified creation flow
```

### How to Test
1. Build and run on simulator or device
2. Go to Profile > scroll down > toggle **"Unified Create Flow"** ON
3. Tap "Express yourself" on Home
4. Type selection → enter name → chat → story completes → confirmation with style picker → voice chips → creating progress → lyrics card → approve → rendering → player
5. **ALL inline in chat** — user never leaves the chat view
6. Backend must be running (`npm run dev`) for chat to work

### What Works
- Type selection (song vs poem picker)
- Inline name prompt → chat begins
- Story conversation with V2StoryEngine
- Story Elements / Strength tabs (collapsible)
- Confirmation card with mood pills, style picker, Edit button
- Voice selection chips (AI Female / AI Male / My Voice)
- Track creation progress (inline ring)
- Lyrics card (read-only → interactive with quick-reply chips)
- Rendering progress card (5-step checklist, waveform, progress bar)
- Player card (scrubber, transport, Get Full Song, Share/Reroll/Done)
- Two-stage render (preview → full with billing hold)
- Billing entitlement check before creation
- Resume from kill (maps to songProgress, fetches server state)
- Scroll back-off (stops auto-scroll when user reads history)
- Old flow preserved with flag OFF
- Poem flow unchanged (still full-screen)
- 105 tests pass, 0 failures

### What Needs Work Next

1. **E2E testing with live backend** — the full pipeline (chat → create → lyrics → render → play) hasn't been tested with live API calls yet. Individual inline cards are wired but not confirmed working end-to-end.

2. **My Voice enrollment fallback** — VoiceSelectionChips has `onMyVoice` callback that sets `showVoiceEnrollment = true`, but the enrollment sheet presentation is not yet wired (needs VoiceEnrollmentView as a sheet).

3. **Reroll detail** — `handleReroll()` currently just calls `regenerateLyrics()`. Should show a reroll type picker (lyrics, beat, vocals, section) matching `allowedRerollTypes`.

4. **Lyrics editing inline** — `InlineLyricsCard` has the controller but section editing (tap to edit a line) UI is not fully interactive yet. Quick-reply chips trigger `onRegenerateLyrics` but per-section editing needs inline TextEditor.

5. **Dead legacy views** — The old full-screen `creatingPhase`, `lyricsPlaceholder`, `voicePlaceholder`, `renderingPlaceholder`, `playerPlaceholder` views still exist in the file as dead code. They compile (phase refs were changed to `.chat`) but should be deleted for cleanliness.

6. **Design polish** — The inline cards match the Velvet & Gold design system tokens but haven't been compared pixel-for-pixel against the mockup screenshots. Fine-tuning spacing/sizing may be needed.

7. **Persist `songProgress`** — `SongProgress` changes are not yet persisted via `resumeCoordinator.persistResumeState()`. The `onChange(of: songProgress)` doesn't persist. Need to add persistence calls.

8. **Input bar during review-edit** — When user taps "Edit" on confirmation to do review-edit, the InputBarView should reappear. Currently `songProgress == .conversing` gates it, but after edit `songProgress` stays at `.conversing` so it should work. Needs testing.

### Key Files
| File | Purpose | Lines |
|------|---------|-------|
| `Flows/UnifiedCreateFlowView.swift` | Main unified flow with inline cards | ~1500 |
| `Flows/InlineCards/VoiceSelectionChips.swift` | Voice selection chips | 113 |
| `Flows/InlineCards/InlineCreatingCard.swift` | Creation progress | 80 |
| `Flows/InlineCards/InlineLyricsCard.swift` | Lyrics review card | 222 |
| `Flows/InlineCards/InlineRenderingCard.swift` | Rendering progress | 264 |
| `Flows/InlineCards/InlinePlayerCard.swift` | Player card | 296 |
| `Controllers/TrackCreationController.swift` | Track creation pipeline + `onLyricsGenerated` | 126 |
| `Controllers/RenderController.swift` | Render lifecycle + polling | ~400 |
| `Controllers/PlaybackController.swift` | AVPlayer lifecycle | 420 |
| `Controllers/ShareController.swift` | Share link management | 389 |
| `TrackPlayerFullView.swift` | Refactored player (controllers wired) | 968 |
| `ShareSheetView.swift` | Refactored share (ShareController wired) | 747 |
| `docs/plans/unified-creation-flow-implementation.md` | Implementation plan v2.3 |
| `docs/design/unified-creation-flow-v3.md` | Design system doc |
| `~/.claude/plans/expressive-roaming-porcupine.md` | B+1 all-in-chat plan |

### Architecture: SongProgress State Machine
```
.conversing → .confirmed → .voiceSelected → .trackCreated → .lyricsApproved → .previewReady → .fullRenderActive → .fullRenderReady
```

Each state derives which inline cards are visible:
- `.conversing` — chat only, InputBarView active
- `.confirmed` — confirmation card + voice chips
- `.voiceSelected` — creating progress card
- `.trackCreated` — lyrics card (interactive)
- `.lyricsApproved` — rendering card
- `.previewReady` — player card (preview mode, "Get Full Song" visible)
- `.fullRenderActive` — player + rendering overlay
- `.fullRenderReady` — player card (full mode)

### API Contracts (verified)
- `engine.messages` — `[V2Message]`
- `engine.isComplete` — triggers confirmation card
- `trackCreationController.onLyricsGenerated` — fires at step 2 (25% progress)
- `trackCreationController.createTrack(storyContext:voiceMode:voiceGender:)` — 4-step pipeline
- `renderController.startPreviewRender(trackId:versionNum:)` — preview render
- `renderController.startFullRender(trackId:versionNum:)` — full render with billing
- `renderController.onPreviewComplete` / `onFullRenderComplete` — `RenderResult` callbacks
- `playbackController.setupPlayer(url:)` / `.play()` / `.switchAudio(url:)`
- `apiClient.getBillingEntitlements()` — credits check before creation
- `songFlow.applyVoiceSelection(using:)` — voice mode API patch
