# Handoff: Warm Canvas Implementation Session
**Date:** April 2, 2026
**Branch:** version3
**Status:** Phase 0 complete, Phase 1 views created but NOT wired into main flow

---

## What Was Done This Session

### 1. HTML Prototype Finalized
- Codex reviewed prototype against spec, found 8 issues
- All 8 fixed: Reveal sequencing, recipient friction, credits banner, Fraunces font, home simplification, demo prefill, error copy, coral contrast
- Social media sharing previews added (iMessage, WhatsApp, Instagram DM)
- Prototype at: `~/.gstack/projects/computa-porizo/designs/create-flow-20260401/prototype-full.html`
- Serve: `python3 -m http.server 8888 --directory ~/.gstack/projects/computa-porizo/designs/create-flow-20260401`

### 2. Implementation Plan Created & Reviewed
- Plan at: `/Users/ao/.claude/plans/spicy-munching-stearns.md`
- 3 specialist reviewers (correctness, reliability, API contract) found 18 issues
- All 18 incorporated into plan before implementation
- Key fixes: inline state-switch (not modal), bubble modifier in Phase 0, 13 additional hardcoded color files, theme picker removal, CreateFlowState backward compat

### 3. Phase 0: Foundation (COMPLETE - 8 units)
All committed on `version3` branch:

| Unit | Commit | What |
|------|--------|------|
| 0A | `f72ad98` | Fraunces font file replaces Playfair |
| 0B+0D | `e50cad1` | DesignTokens.swift full Warm Canvas swap (colors, font, modifiers, gradients) |
| 0C | `d78db6b` | 13 files hardcoded colors fixed, .preferredColorScheme(.light), theme picker removed |
| 0E | `63c79ab` | StoryElementsCardView + SongProgressIndicator deleted |
| 0F | `d78db6b` | Voice skip for first-time users (@AppStorage hasCompletedFirstSong) |
| 0G | `7b58ceb` + `c414895` | CreateFlowState enum: .waitPulse, .revealBloom, .sharePostcard + exhaustive switch |

### 4. Phase 1: New Views Created (7 units)
All committed but **only wired in CreateFlowView.swift, NOT in UnifiedCreateFlowView.swift**:

| Unit | Commit | File Created |
|------|--------|-------------|
| 1A | `eba501e` | `Flows/WaitPulseView.swift` — breathing coral pulse |
| 1B | `e7251f1` | `Flows/RevealBloomView.swift` — coral gradient bloom, Play dominant |
| 1C | `f71151b` | `Flows/SharePostcardView.swift` — postcard + social previews |
| 1D | `9d478bc` | ExploreTabView simplified (single CTA, no feature banner) |
| 1E | `6c8285c` | ShareClaimView redesigned (Listen Now primary) |
| 1F | `d0706f4` | `Flows/FlowErrorViews.swift` — 5 contextual error states |
| 1G | `b7da848` | ChatMessageBubble — sage AI, coral user bubbles |

### 5. Review Fixes Applied (10 commits)
- Contrast fixes (coral text on parchment)
- CTA button text color (background → white)
- Separate claimTask from loadTask (race condition)
- @FocusState for PIN field
- GeometryReader replacing UIScreen.main
- Occasion enum: added friendship + getWell cases
- Duplicate formatTime removed
- Stale Velvet & Gold comments cleaned
- FlowErrorViews scaffold dedup
- StaticWaveformBars shared component

### 6. Reviews Completed
| Review | Verdict |
|--------|---------|
| Correctness (SwiftUI) | 7 fixed, 5 advisory |
| Adversarial | 5 fixed, 4 advisory |
| Post-batch gate | PASS (R1-R12 satisfied) |
| CE correctness (autofix) | 5 auto-fixes |
| Simplify | 2 dedup fixes |
| SwiftUI Pro | 1 fixed, 4 advisory |

---

## CRITICAL: What's NOT Done Yet

### The Main Flow Is NOT Rewired
**This is the biggest gap.** The new views exist as files but the **main production create flow** (`UnifiedCreateFlowView.swift`) still uses the OLD inline rendering for Wait/Reveal/Share. The new views are only wired in the SECONDARY `CreateFlowView.swift`.

The user confirmed: "the build on my iPhone is what the old build was, only color change, totally different from the prototype."

**What needs to happen:**
1. `UnifiedCreateFlowView.swift` needs to route to `WaitPulseView` when render starts (songProgress == .lyricsApproved)
2. `UnifiedCreateFlowView.swift` needs to route to `RevealBloomView` when preview is ready (songProgress == .previewReady)
3. `UnifiedCreateFlowView.swift` needs to route to `SharePostcardView` from RevealBloomView's share action
4. `UnifiedCreateFlowView.swift` needs to show `FlowErrorViews` for the 5 error states
5. The `onPlay` closure in RevealBloomView needs to trigger actual audio playback via the existing `playbackController`/`renderController`
6. The `onSend`/`onSaveToPhotos`/`onCopyLink` closures in SharePostcardView need real implementations

### Other Gaps
- **Onboarding screen** — prototype shows audio sample + "Make one in 90 seconds" but current app shows generic Welcome. Deferred to Phase 2.
- **Name Entry screen** — prototype has occasion chips + Song/Poem toggle but current app has bare name field. Needs layout update in `InlineNamePromptView.swift`.
- **Auth screen** — prototype shows "Sign in to create your song" but current shows "Welcome". Already partially addressed in UX audit (F-24).
- **No-op closures** — RevealBloomView's `onPlay: {}`, SharePostcardView's `onSend/onSaveToPhotos/onCopyLink` are empty stubs
- **~90 stale comments** in untouched files still reference "Velvet & Gold", "Playfair Display", "Deep velvet black"
- **ThemePickerSheet.swift** file still exists (dead code, settings row removed)
- **PorizoApp/PorizoApp/CLAUDE.md** style guide still documents old Velvet & Gold palette

### Advisory Items (Need Human Judgment)
1. ShareClaimView "Listen Now" sends empty PIN — verify server accepts pinless claims
2. SongFlowCoordinator.voiceGender default changed from nil to .female — verify nil semantics aren't needed elsewhere
3. bodyFont() doesn't scale with Dynamic Type (pre-existing, wide impact)

---

## Key Files Reference

### New Files Created
```
PorizoApp/PorizoApp/Flows/WaitPulseView.swift        # 155 lines
PorizoApp/PorizoApp/Flows/RevealBloomView.swift       # 278 lines
PorizoApp/PorizoApp/Flows/SharePostcardView.swift     # 532 lines
PorizoApp/PorizoApp/Flows/FlowErrorViews.swift        # 429 lines
PorizoApp/PorizoApp/Fonts/Fraunces-Variable.ttf       # Variable font
```

### Key Modified Files
```
PorizoApp/PorizoApp/DesignTokens.swift                # Full Warm Canvas swap
PorizoApp/PorizoApp/Flows/CreateFlowView.swift        # New states wired (secondary flow)
PorizoApp/PorizoApp/Flows/CreateFlowContracts.swift   # 3 new enum cases + Codable compat
PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift # Voice skip added, BUT new views NOT wired
PorizoApp/PorizoApp/Tabs/ExploreTabView.swift         # Simplified, single CTA
PorizoApp/PorizoApp/ShareClaimView.swift              # Deep-link primary, PIN fallback
PorizoApp/PorizoApp/V2Story/Views/ChatMessageBubble.swift  # Sage/coral bubbles
PorizoApp/PorizoApp/Models/TrackModels.swift          # friendship + getWell occasions
PorizoApp/PorizoApp/Flows/OccasionPrompts.swift       # Prompts for new occasions
```

### Deleted Files
```
PorizoApp/PorizoApp/Flows/StoryElementsCardView.swift
PorizoApp/PorizoApp/Flows/InlineCards/SongProgressIndicator.swift
PorizoApp/PorizoApp/Fonts/Playfair-Variable.ttf
```

---

## Design Tokens (Warm Canvas)

| Token | Hex | Usage |
|-------|-----|-------|
| background | #FBF7F2 | Warm parchment |
| surface | #FFFFFF | White cards |
| gold (coral) | #E07850 | Buttons, fills, accents |
| goldDark (coralText) | #C06030 | Small text (WCAG AA) |
| roseGold (amber) | #D4894A | Secondary accent |
| sage | #7B8F6B | AI accent, nature |
| sageBubble | #E8F0E5 | AI chat bubble bg |
| coralBubble | #FDE8E0 | User chat bubble bg |
| textPrimary | #2C2420 | Headings, body |
| textSecondary | #6B6560 | Labels, metadata |
| border | #E8E2DC | Dividers |
| Font | Fraunces | Display/title (variable) |

---

## Commit Log (26 commits)
```
f8d40ca fix(review): add friendship and getWell cases to Occasion enum
f24d9ee fix(review): remove dead ThemePickerSheet references from SettingsTabView
41ae0af fix(review): occasion rawValue, migration filter, stale comments, animation snap
49acda9 Consolidate occasion display text into Occasion enum
869f9aa Remove duplicate formatTime from ShareClaimView
253dd1e fix: resolve non-optional nil comparison warning in ExploreTabView
4ff7e67 fix(design): review fixes — contrast, wiring, race condition
fc51150 fix(design): review fixes — separate claim task, FocusState, GeometryReader
b7da848 feat(design): update Tell conversation views for sage AI and coral user bubbles
f71151b feat(design): add SharePostcardView — postcard card with social media previews
d0706f4 feat(design): add FlowErrorViews — 5 contextual error states for create flow
9d478bc feat(design): simplify Home — remove feature banner, merge CTAs into single action
6c8285c feat(design): update ShareClaimView — Listen Now primary, PIN as fallback
e7251f1 feat(design): add RevealBloomView — coral gradient bloom with Play as dominant CTA
eba501e feat(design): add WaitPulseView — breathing coral pulse during song generation
c414895 feat(design): handle new CreateFlowState cases in CreateFlowView switch
7b58ceb feat(design): add CreateFlowState cases for Wait/Reveal/Share screens
d78db6b feat(design): skip voice selection for first-time users, auto-select AI female
63c79ab feat(design): remove StoryElementsCardView and SongProgressIndicator from create flow
e50cad1 feat(design): swap DesignTokens to Warm Canvas palette
f72ad98 feat(design): replace Playfair font with Fraunces variable font
b91fe19 Update handoff: Codex review fixes + social sharing previews
d9c21a0 Update handoff: add Success screen to flow order and screen list
ff4a463 Add session handoff: design redesign complete, prototype ready
ad65d5e Add complete design system docs + LLM Council review for app redesign
```

---

## Next Session Priority

1. **Wire new views into UnifiedCreateFlowView.swift** — This is the #1 blocker. The views exist, the enum cases exist, but the main flow still renders the old inline cards. Need to add state transitions that route to WaitPulseView/RevealBloomView/SharePostcardView at the right songProgress milestones.

2. **Connect real actions** — onPlay needs playbackController, onSend needs ShareController, onSaveToPhotos needs ImageRenderer export.

3. **Update Name Entry** — Add occasion chips and Song/Poem toggle to match prototype.

4. **Build and test on device** — Verify the full create flow end-to-end on iPhone.
