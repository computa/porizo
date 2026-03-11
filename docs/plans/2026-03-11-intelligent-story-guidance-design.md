# Intelligent Story Guidance & Confirmation Screen Redesign

**Date:** 2026-03-11
**Status:** Approved
**Baseline:** Commit `5d46503` (revert point)

## Problem

The StoryConfirmationView is too busy (11 possible sections) with no clear user journey. The revision composer has 4 intent modes — a power-user tool on a review screen. Story Elements are passive progress bars with no way to act on them. Slot guidance during conversation is static templates, not grounded in the user's actual story.

## Solution

1. **Upgrade StorySlotGuidance** from static templates to LLM-generated, story-aware guidance
2. **Make Story Elements interactive** on the confirmation screen — tap a weak element, see specific guidance, type a detail, apply inline
3. **Simplify the confirmation screen** from 11 sections to 5

## Architecture

### Backend: `src/writer/v3/guidance.js` (New Module)

Single function: `generateElementGuidance(state, elementId)`

**Input:** Full story state (narrative, atoms, primitives, facts, gap analysis, element definitions)

**Output:**
```json
{
  "element_id": "moment",
  "element_name": "The Moment",
  "strength": 0.40,
  "state": "weak",
  "diagnosis": "The story celebrates Amaka's motherhood broadly but doesn't anchor it to a single vivid scene.",
  "story_anchor": "the love you pour so selflessly into your family",
  "suggestion": "Think of one specific time — where were you, what did she do, and what did it make you feel?",
  "examples": [
    "The night she stayed up rewriting my university application after I'd given up.",
    "When she sold her jewelry without telling anyone so we could keep the house."
  ]
}
```

**LLM:** Uses `callLightweightModel` (Haiku-tier). ~800 tokens input, ~200 tokens output. Target <2s latency.

**Fallback:** If LLM fails, returns existing `SLOT_GUIDANCE_TEMPLATES` (kept as safety net).

### Backend: New Endpoint

```
GET /story/:story_id/element-guidance/:element_id
```

Auth required. Verifies story ownership. Rate-limited 20/min. Calls `generateElementGuidance()`.

### Backend: Conversation Turn Integration

After the reasoning pipeline produces a turn targeting a specific slot, call `generateElementGuidance()` for the corresponding element and attach as `slotGuidance`. Runs in parallel with narrative composition.

`StorySlotGuidance` schema extended with optional `diagnosis` and `story_anchor` fields (backward compatible).

### iOS: Interactive Story Elements

New `InteractiveStoryElementsView` replaces passive `StoryElementsCardView`.

**Interaction:** Tap weak element → expands inline → shows guidance (fetched from endpoint) → user types detail → hits Apply → calls `reviseFromConfirmation()` with `[strengthen:element_id]` context → element collapses, strength updates.

**State:**
- `expandedElementId: String?` — one element open at a time
- `guidanceCache: [String: ElementGuidance]` — avoid re-fetching
- `elementInput: String` — text field content
- `isLoadingGuidance: Bool`

**New engine method:** `fetchElementGuidance(elementId:) async throws -> ElementGuidance`

### iOS: Confirmation Screen Simplification

**Removed (6 components, ~600 lines):**
- RevisionComposerView (4-mode, 380 lines)
- FactInventoryCardView
- ProvenanceCardView
- FinalNotesCardView (folded into one-liner)
- ConflictResolutionCardView
- RevisionHistoryCardView

**Untouched:**
- Header (party popper, title, draft version)
- Chat/Story tab picker + Chat tab
- StoryNarrativeCardView (full story text)
- Draft diff card (conditional)
- Continue to Create Song button

**New Story tab layout (top → bottom):**
1. Resume notice (conditional)
2. Story narrative card (untouched)
3. Draft diff card (conditional, after revision)
4. Interactive Story Elements (new)
5. Simplified final notes (one line, collapsed)

## Implementation Phases

### Phase 1 — Backend: Intelligent Guidance

| Step | What | Files |
|---|---|---|
| 1a | Create `guidance.js` with `generateElementGuidance()` | `src/writer/v3/guidance.js` (new) |
| 1b | Add `GET /story/:id/element-guidance/:element_id` | `src/routes/story.js` |
| 1c | Extend `StorySlotGuidance` schema with `diagnosis`, `story_anchor` | `src/routes/story.js` |
| 1d | Wire conversation turns to use LLM guidance | `src/writer/v3/index.js` |
| 1e | Tests | `test/writer/v3/guidance.test.js` (new) |

### Phase 2 — iOS: Interactive Elements + Screen Simplification

| Step | What | Files |
|---|---|---|
| 2a | Add `ElementGuidance` model + `fetchElementGuidance()` | `V2StoryTypes.swift`, `V2StoryEngine.swift`, `StorySyncService.swift` |
| 2b | Extend `StorySlotGuidance` with optional fields | `StoryModels.swift` |
| 2c | Build `InteractiveStoryElementsView` | `V2Story/Views/InteractiveStoryElementsView.swift` (new) |
| 2d | Simplify `StoryConfirmationView` | `StoryConfirmationView.swift` |
| 2e | Build & test on simulator | |

### Phase 3 — Polish

| Step | What |
|---|---|
| 3a | Animate element expansion with `.spring` |
| 3b | Skeleton loading while guidance fetches |
| 3c | Strength visual update after revision |
| 3d | All-strong celebration state |

## Risk Mitigation

- Baseline commit `5d46503` — full revert point
- Template fallback preserved — LLM failure degrades gracefully
- Backend ships independently — old iOS works with richer `slotGuidance`
- Existing `reviseFromConfirmation()` reused — no new revision pipeline
