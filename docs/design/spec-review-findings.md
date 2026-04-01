# Design Spec Review — 6-Agent Synthesis

**Reviewed:** `design-like-a-yc-startup-spec.md` + `design-like-a-yc-startup-comprehensive.md`
**Against:** `design-like-a-yc-startup-v2.md` (research-validated source)
**Reviewers:** Correctness, Adversarial, Design Lens, Product Lens, Scope Guardian, Feasibility

---

## 🔴 DISAGREEMENTS (Red Flags)

These are points where the spec/comprehensive documents are **wrong, contradictory, or dangerously incomplete.** They must be resolved before implementation.

### 🔴 D-01: No user evidence that the problems cause measurable harm
**Source:** Product Lens (Critical)

The entire redesign chain starts from "the app leaks scaffolding" — a valid design-craft observation. But zero user data is cited showing abandonment, confusion, or dissatisfaction caused by StoryElementsCardView or SongProgressIndicator. NNGroup heuristics and Linear's design philosophy are frameworks for evaluating design quality, not evidence that Porizo users are struggling.

**The fix:** Move guerrilla usability tests from position 10 to **position 0**. Run 5 tests BEFORE implementing Phases 1-3. Cost: zero. Risk of skipping: building the wrong thing well.

---

### 🔴 D-02: "Cover art as the visual anchor" — the asset doesn't exist
**Source:** Adversarial (Medium, 0.90 confidence)

The Reveal spec says "cover art as the visual anchor" and "large cover art (full-width)." But songs use **generated gold gradients** (`LinearGradient gold/goldDark`), not album art. There is no image asset. Building a full-screen reveal anchored on a gradient square will not produce the "ceremonial premium" feeling described. The spec assumes rich visual content that does not exist in the product.

**The fix:** Either (a) generate cover art during the render pipeline (AI image from story keywords), or (b) redesign the reveal to use the occasion gradient + typography as the anchor instead of assuming "cover art."

---

### 🔴 D-03: Poems already HAVE a ceremonial reveal — spec would create a conflicting second pattern
**Source:** Adversarial (High, 0.92 confidence)

`PoemRevealView.swift` already implements a ceremonial reveal with animated seal, glow effects, and card opacity transitions. The comprehensive doc's song Reveal spec would produce a SECOND, conflicting reveal pattern. Poems are invisible in both documents despite being a core feature (`CreateFlowKind` has `.song` and `.poem`). Neither doc addresses how the 4-moment model applies to poems.

**The fix:** Audit PoemRevealView.swift. Either (a) adopt its pattern for songs (it's more developed than the spec), or (b) design a unified reveal that works for both, or (c) explicitly document that songs and poems have different reveal choreography.

---

### 🔴 D-04: The recipient experience is completely absent from a redesign that calls sharing "the growth loop"
**Source:** Adversarial + Design Lens + Product Lens (Critical, 0.95 confidence)

Three independent reviewers flagged this. The Share moment designs only the SENDER's experience. When a recipient opens a share link, what do they see? This is the single highest-leverage acquisition moment — a person emotionally primed to try the product. The codebase has `ShareClaimView.swift`, `PoemClaimView.swift`, `share_tokens` table, and `share_access_log` tracking. None of this appears in the spec.

**The fix:** Add a "Receive" moment to the spec, or acknowledge it's out of scope with a concrete follow-up.

---

### 🔴 D-05: Contradiction — "no route sprawl" principle vs. full-screen cover for Reveal
**Source:** Adversarial (Medium, 0.85 confidence)

Design principle #7: "Mode boundaries should feel clear without route sprawl." V2: "mode boundaries should be visual/behavioral, not navigation." But the Reveal spec says "same route or full-screen cover depending on implementation choice." A `.fullScreenCover` in SwiftUI IS a modal presentation — it creates a new view controller context. The spec defers the decision without acknowledging one option violates its own principle.

**The fix:** Decide. Either commit to in-route reveal (background shift, content expansion — no modal) or acknowledge the reveal needs a modal exception to the no-sprawl principle with a clear rationale.

---

### 🔴 D-06: AI-voice-first demoted from Priority 5 to Phase 3
**Source:** Product Lens (High)

V2 ranked "Default to AI voice" as Priority 5 (Low effort, High impact). The comprehensive doc moved it to Phase 3. This is the single change most likely to affect first-song completion rate, and it requires the least engineering. Deferring it behind reveal choreography and player upgrades is prioritizing emotional polish over activation rate — backwards for a product that hasn't proven PMF.

**The fix:** Move AI-voice-first to Phase 1 or batch it with the structural cleanup. It's a 2-4 hour change.

---

### 🔴 D-07: Monetization/billing surfaces absent from the redesigned flow
**Source:** Product Lens (High, 0.90 confidence)

The codebase has `entitlements` (tier, credits_balance), `billing_holds` (credit reservation), rate limits (20 previews/day free, 50 premium). The redesign proposes changing the primary creation flow — exactly where billing decisions happen. Neither doc acknowledges that billing intersects with the proposed changes. Risk: redesign ships, then needs partial rework to accommodate billing.

**The fix:** Add a billing compatibility section. At minimum, document where credits, tier status, and paywall surfaces appear in the redesigned flow.

---

### 🔴 D-08: Error states and failure recovery are completely unspecified
**Source:** Design Lens + Adversarial (Critical, 0.92 confidence)

The codebase has 4 error code ranges (E1xx, R2xx, B3xx, S5xx), explicit retry strategies, content moderation blocks, and rate limits. The word "error" appears zero times in the comprehensive doc. The word "fail" appears once ("failed/retry flows should return to wait"). For a product with 60-90 second async operations that can fail at 6+ points, this is a structural gap.

**The fix:** Define error UX for each moment: What does the user see when generation fails? When moderation blocks? When network drops during Wait? When sharing fails?

---

## 🟡 GAPS (Missing but fixable)

### G-01: Spec drops ALL implementation detail from V2
**Source:** Correctness (14 findings)

The reveal loses: trigger condition (`.previewReady`), view name (`SongRevealView`), auto-play duration (5s), haptic type, shimmer animation. Sharing loses: current ShareSheetView that needs replacement, iOS share sheet integration, copy-to-clipboard. First-song loses: which file to change, "Set up later" label. Sub-moments (9 across 4 moments) dropped entirely. State-to-moment mapping table dropped. Priority ordering within tiers dropped.

### G-02: 1,231 lines of design docs for 256 lines of core changes
**Source:** Scope Guardian (HIGH confidence)

The spec document (233 lines) is redundant with V2. The comprehensive doc adds ~75 lines of genuinely new content buried in ~440 lines of restated context. **80% of the value is achievable in 1 day: remove StoryElementsCardView + SongProgressIndicator references from UnifiedCreateFlowView.swift (2-4 hours) and default to AI voice for first-time users (2-4 hours).**

### G-03: Voice enrollment, settings, background render completion unspecified
**Source:** Design Lens + Adversarial

Voice enrollment is a 7-state workflow already in production. Settings/Profile screens not mentioned at all. Background render completion (user leaves during Wait, returns after song finishes) has no spec for what the user sees.

### G-04: Reroll/regeneration breaks the Reveal model
**Source:** Adversarial (ADV-016)

The Reveal triggers on "the first successful song result." After a reroll, there is no reveal ceremony for the new version. User goes Wait → ??? → player update with no payoff. The spec's own principle is violated for every song after the first.

### G-05: Wait timing thresholds undesigned
**Source:** Design Lens

Preview renders take up to 90s, full renders up to 180s. Neither doc addresses: what changes at 30s vs 60s vs 2min? When does the app suggest leaving? What's the timeout UX vs. generic failure? Push notification copy when background-complete?

### G-06: Animation/haptic specs are zero
**Source:** Design Lens + Adversarial

"Subtle haptic pulse" — which of 8 iOS haptic types? "Shimmer animation" — duration, curve? "Mode boundaries through motion" — what motion? No animation parameter exists in either doc. Also: zero haptic usage exists in the codebase currently.

### G-07: Sound design absent for a music product
**Source:** Design Lens

Auto-play during reveal: how does it interact with iOS silent mode? With other audio sessions? With zero volume? Does the Wait moment have ambient audio? Should the reveal have a sound effect before the song plays?

### G-08: Accessibility at 1/10
**Source:** Design Lens

Reduce Motion alternatives for reveal choreography? VoiceOver flow through 4 moments? Dynamic Type behavior for reveal's "display typography"? Auto-play audio respecting silent mode? Not addressed.

### G-09: PhaseTransitionDivider and ChatHeaderView dedup dropped silently
**Source:** Adversarial + Correctness

V2 identified both as concrete quick fixes. `PhaseTransitionDivider` renders gold dividers with system-facing labels in uppercase — the same scaffolding leak class as SongProgressIndicator. `ChatHeaderView` shows completion percentage twice. Both vanished between V2 and the comprehensive doc.

---

## ✅ WHAT THE DOCS GET RIGHT

Both documents correctly identify and preserve:
- The 4-moment model (Tell/Wait/Reveal/Share) as the organizing framework
- Scaffolding removal as the highest-confidence subtraction
- The conversation as the primary creative surface (not "just an on-ramp")
- The warm/dark visual direction as appropriate for a gifting product
- "One dominant action per moment" as the core design principle
- Creative controls preserved, diagnostics removed
- Implementation ordered by phase with dependencies correct

---

## RECOMMENDED ACTIONS (Priority Order)

| # | Action | Effort |
|---|--------|--------|
| 0 | **Run 5 guerrilla usability tests BEFORE any implementation** | Zero |
| 1 | **Do the 1-day sprint:** Remove StoryElements + SongProgress from UnifiedCreateFlowView. Default to AI voice. | 1 day |
| 2 | **Then reassess:** After the cleanup, does the app still feel "amateur"? The 3-layer hierarchy, mode boundaries, and reveal ceremony may be unnecessary. | 1 hour |
| 3 | **If reveal is still needed:** Audit PoemRevealView.swift first — it may already have the pattern you need. Design for BOTH songs and poems. | 2 hours |
| 4 | **Add error UX to the spec.** Define failure states for each moment. | 4 hours |
| 5 | **Add recipient experience.** The growth loop is broken without it. | Design time |
| 6 | **Add billing compatibility section.** Prevent rework. | 2 hours |

---

## 🔴 ADDITIONAL RED FLAGS (from Feasibility + Adversarial reviews)

### 🔴 D-09: AI voice is ALREADY the default — the plan misidentifies the problem
**Source:** Feasibility (HIGH, 0.85 confidence)

`VoiceModeSelectionView.swift` line 189-190 already defaults to `.aiVoice` via `.onAppear`. The actual friction is not the default — it's that the **voice selection step exists at all**. The flow blocks at `songProgress == .confirmed` until the user explicitly taps a voice chip. The real fix: auto-select AI voice and **skip the selection step entirely** for first-time users. This requires a first-time detection mechanism (`UserDefaults` flag or tracks API query) that doesn't exist yet.

### 🔴 D-10: PoemRevealView already has a more developed reveal than what the spec proposes for songs
**Source:** Adversarial (HIGH, 0.95 confidence)

`PoemRevealView.swift` implements a ceremonial reveal with animated seal, glow effects, and card opacity transitions. It is more developed than the spec's song reveal description. Building the spec's song reveal without referencing the poem reveal will create **two conflicting reveal patterns** in the same app. The poem reveal should be the starting template, not ignored.

### 🔴 D-11: Partial render failure creates UX dead zone (preview succeeds, full render fails after payment)
**Source:** Adversarial (HIGH, 0.88 confidence)

The Reveal triggers on preview-ready. User sees ceremony, is delighted. Taps "Get Full Song" — billing hold is created. Full render fails (GPU timeout, Seed-VC error). The Reveal already fired. Wait already ended. The user paid but can't get the full product. The spec has **no UX for this state.** The current `InlinePlayerCard` shows a `renderingInProgressIndicator` during full render, but the comprehensive doc wants to replace it with a full-screen reveal.

### 🔴 D-12: Share link pre-generation cannot happen during rendering — server returns 409
**Source:** Feasibility (MODERATE, 0.75 confidence)

`src/routes/tracks.js` line 1131: `POST /tracks/:id/share` checks `if (!trackVersion.preview_url && !trackVersion.full_url)` and returns 409 `TRACK_NOT_READY`. Links **cannot** be created before the render completes. The earliest moment is when `songProgress` hits `.previewReady`. The fix is still valid (call `generateShareLink()` immediately on transition, not on user tap), but the spec's claim of "prepared during rendering" is technically impossible with the current API.

---

## FEASIBILITY TABLE (Code-Verified)

| Change | Feasible | Effort | Risk | Key Finding |
|--------|----------|--------|------|-------------|
| Remove StoryElementsCardView | Yes | 0.5h | Near zero | Used in exactly 1 place (lines 407-416). Pure display, no bindings. |
| Remove SongProgressIndicator | Yes | 0.5h | Low | Used in 1 place (lines 400-404). But ChatHeaderView % remains — unaddressed. |
| Build reveal choreography | Yes (decision needed) | 8-12h | Medium | `.fullScreenCover` vs new `UnifiedPhase` vs visual state. Audio state during dismiss is the real risk. Check PoemRevealView first. |
| Pre-generate share links | Yes | 2-3h | Low | Can't pre-gen during render (409). But can auto-generate on `.previewReady` transition. Idempotent endpoint. |
| Mode boundaries | Needs restructuring | 6-10h | Medium | Current `chatPhase` is one big VStack/ScrollView. Background animation is trivial but "thread recedes" requires scroll position management. |
| Skip voice selection for first-timers | Yes | 3-5h | Low | Need first-time detection mechanism + default gender decision. AI voice already default — the step itself is the friction. |

**Total for 1-day sprint (2 subtractions + voice skip):** ~4-5 hours
**Total for full Phase 1+2:** ~20-30 hours (3-4 weeks part-time)

---

## DIMENSIONAL SCORES (Design Lens Review)

| Dimension | Score | Gap |
|-----------|-------|-----|
| Information Architecture | 4/10 | Only covers happy-path single creation session |
| Interaction State Coverage | 3/10 | Feelings described, not concrete UI states |
| User Flow Completeness | 3/10 | Only sunny-day path. No error, resume, background, or poem flows |
| Accessibility | 1/10 | Mentioned once across all documents |
| Unresolved Design Decisions | 3/10 | "Ceremonial," "premium," "subtle" — not implementable |
