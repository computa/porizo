# Handoff: Warm Canvas — Screen-by-Screen Build

**Date:** April 2, 2026
**Branch:** version3
**Status:** Architecture wired, screens wiped, ready for screen-by-screen build

---

## What This Session Did

1. Read the handoff from the previous session (Phase 0 complete, Phase 1 views built but not wired)
2. Read the design spec and comprehensive plan
3. Created `WarmCanvasFlowView.swift` — a standalone Four Moments flow (Tell → Wait → Reveal → Share)
4. Added `WarmCanvasMoment` and `TellSubPhase` enums to `CreateFlowTypes.swift`
5. Wired `MainTabView.swift` to route songs through WarmCanvasFlowView (poems stay on UnifiedCreateFlowView)
6. Built and installed on iPhone + simulator
7. Compared simulator screens to prototype — found the screens don't match the prototype
8. **Wiped WarmCanvasFlowView** back to an empty shell, ready to rebuild screen-by-screen to match the prototype exactly

---

## The Problem

The previous session built WarmCanvasFlowView by extracting orchestration from UnifiedCreateFlowView. The architecture (state machine, controller wiring, resume logic) was correct, but the **screens themselves** didn't match the prototype. The user saw the old "Welcome" auth screen, old name entry, etc. — not the redesigned prototype.

The user's instruction: **wipe it and start over, building each screen to match the prototype exactly.**

---

## Key Locations

### Design Spec & Plan

| Document | Path |
|----------|------|
| **Design spec** | `docs/design/design-like-a-yc-startup-spec.md` |
| **Comprehensive plan** | `docs/design/design-like-a-yc-startup-comprehensive.md` |
| **Implementation plan** | `~/.claude/plans/starry-hopping-dusk.md` |
| **Previous handoff** | `docs/handoff-20260402-warm-canvas-implementation.md` |

### Prototype

| Item | Path |
|------|------|
| **HTML prototype** | `~/.gstack/projects/computa-porizo/designs/create-flow-20260401/prototype-full.html` |
| **Serve command** | `python3 -m http.server 8888 --directory ~/.gstack/projects/computa-porizo/designs/create-flow-20260401` |
| **URL** | `http://localhost:8888/prototype-full.html` |

The prototype has **31 screens** with navigation links at the bottom. Screen IDs: `splash`, `onboarding`, `name-entry`, `auth`, `phone-entry`, `phone-verify`, `profile-complete`, `tell`, `tell-lyrics`, `wait`, `reveal`, `lyrics-review`, `share`, `home`, `songs`, `poems`, `settings`, `voice-intro`, `voice-recording`, `voice-processing`, `voice-complete`, `subscription`, `now-playing`, `poem-detail`, `share-claim`, `tell-error`, `tell-moderation`, `wait-timeout`, `wait-failure`, `reveal-failure`, `share-failure`, `no-credits`.

### Screens Already Built (Phase 1 — match the prototype)

These SwiftUI views were built in the previous session and **DO match the prototype**:

| View | File | Status |
|------|------|--------|
| WaitPulseView | `PorizoApp/Flows/WaitPulseView.swift` | Matches prototype ✓ |
| RevealBloomView | `PorizoApp/Flows/RevealBloomView.swift` | Matches prototype ✓ |
| SharePostcardView | `PorizoApp/Flows/SharePostcardView.swift` | Matches prototype ✓ |
| FlowErrorViews (5 errors) | `PorizoApp/Flows/FlowErrorViews.swift` | Matches prototype ✓ |
| ChatMessageBubble (sage/coral) | `PorizoApp/V2Story/Views/ChatMessageBubble.swift` | Matches prototype ✓ |

### WarmCanvasFlowView (Empty Shell)

| File | Path | Status |
|------|------|--------|
| **Flow view** | `PorizoApp/Flows/WarmCanvasFlowView.swift` | **Wiped — empty shell** |
| **Enums** | `PorizoApp/Flows/CreateFlowTypes.swift` | `WarmCanvasMoment` + `TellSubPhase` added |
| **Routing** | `PorizoApp/MainTabView.swift` | Songs → WarmCanvasFlowView, poems → UnifiedCreateFlowView |

---

## What Needs to Happen Next

Build each screen inside WarmCanvasFlowView to match the prototype exactly. The approach:

1. **Don't patch old views** — create new screen views purpose-built for the prototype
2. **Reuse existing controllers** (RenderController, PlaybackController, TrackCreationController, ShareController, LyricsReviewController, V2StoryEngine) for backend wiring — but build fresh UI on top
3. **Reuse existing Phase 1 views** (WaitPulseView, RevealBloomView, SharePostcardView, FlowErrorViews) — they already match the prototype
4. **Build in screen order** as a user encounters them

### Screens to Build (in user encounter order)

| # | Prototype Screen | Build New or Reuse? | Notes |
|---|---|---|---|
| 1 | Name Entry | **Build new** | Occasion chips, Song/Poem toggle, "Create a Birthday song" title |
| 2 | Tell (Chat) | **Compose from existing** | Reuse V2StoryEngine + ChatMessageBubble + InputBarView, but new header matching prototype |
| 3 | Tell Lyrics | **Compose from existing** | Reuse InlineLyricsCard, add "Create my song ✦" CTA |
| 4 | Wait | **Reuse** WaitPulseView | Already matches ✓ |
| 5 | Reveal | **Reuse** RevealBloomView | Already matches ✓ |
| 6 | Share | **Reuse** SharePostcardView | Already matches ✓ |
| 7 | Error states | **Reuse** FlowErrorViews | Already matches ✓ |

### Screens Outside WarmCanvasFlowView (also need updating)

These are shown by RootView BEFORE the create flow launches:

| Screen | Current File | Status |
|--------|-------------|--------|
| Onboarding | `OnboardingView.swift` | Old "Welcome" carousel — needs redesign |
| Auth | `AuthView.swift` | Old "Welcome" generic — needs redesign |
| Splash | `SplashView.swift` | Needs warm canvas update |

---

## Architecture Decisions (Validated by Specialist Reviews)

These decisions from the implementation plan were validated by a spec-alignment reviewer and a SwiftUI architecture reviewer:

- **Two-stage rendering**: Preview render → Reveal → optional full render upgrade (p95 < 90s, not 180s)
- **Layered ZStack**: Tell stays mounted underneath, Wait/Reveal/Share overlay on top (chat context preserved)
- **Auto-play at reveal**: Song starts playing when Reveal appears (spec requirement)
- **Pre-generated share link**: Call generateShareLink() when render completes, before user taps Share
- **Resume ceremony skip**: Resumed sessions don't replay bloom animation
- **Poem guard**: MainTabView routes poems to UnifiedCreateFlowView, songs to WarmCanvasFlowView

Full review findings are in `~/.claude/plans/starry-hopping-dusk.md`.

---

## Design Tokens (Warm Canvas)

| Token | Hex | Usage |
|-------|-----|-------|
| background | #FBF7F2 | Warm parchment |
| surface | #FFFFFF | White cards |
| gold/coral | #E07850 | Buttons, fills, accents |
| coralText | #C06030 | Small text (WCAG AA) |
| sage | #7B8F6B | AI accent |
| sageBubble | #E8F0E5 | AI chat bubble bg |
| coralBubble | #FDE8E0 | User chat bubble bg |
| textPrimary | #2C2420 | Headings, body |
| textSecondary | #6B6560 | Labels, metadata |
| border | #E8E2DC | Dividers |
| Font | Fraunces | Display/title |

---

## Key Controllers (Reuse As-Is)

| Controller | File | Key Methods |
|------------|------|-------------|
| RenderController | `Controllers/RenderController.swift` | startPreviewRender(), startFullRender(), onPreviewComplete, onFullRenderComplete |
| PlaybackController | `Controllers/PlaybackController.swift` | setupPlayer(), play(), switchAudio(), cleanup() |
| TrackCreationController | `Controllers/TrackCreationController.swift` | createTrack(), onLyricsGenerated |
| ShareController | `Controllers/ShareController.swift` | generateShareLink(), prepareShareData() |
| LyricsReviewController | `Controllers/LyricsReviewController.swift` | approveLyrics(), onApproved |
| V2StoryEngine | `V2Story/V2StoryEngine.swift` | startSession(), submitAnswer(), isComplete, messages |
| SongFlowCoordinator | `Flows/SongFlowCoordinator.swift` | voiceMode, currentTrackId, resume() |

---

## Git State

```
Branch: version3
Recent commits this session:
  (none committed yet — changes are unstaged)

Modified files:
  PorizoApp/Flows/CreateFlowTypes.swift    — WarmCanvasMoment + TellSubPhase enums added
  PorizoApp/Flows/WarmCanvasFlowView.swift — NEW file (empty shell)
  PorizoApp/MainTabView.swift              — useWarmCanvasFlow flag + poem guard routing
  PorizoApp/Flows/SharePostcardView.swift  — pre-existing modification
```
