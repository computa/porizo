# Design Like A YC Startup — Design Spec

## Review Integration From `spec-review-findings.md`

### Legend

- 🟢 Agree
- 🟡 Partial agreement / refinement
- 🔴 Disagree

### What was corrected from review

- 🟢 **Agree:** usability validation must move to position `0`.
  This redesign is based on strong design reasoning, but that is not the same as user evidence. Five guerrilla tests must happen before any major implementation wave.

- 🟢 **Agree:** the recipient experience was missing.
  If sharing is the growth loop, the receiver journey cannot be absent. The redesign now treats `Receive` as the downstream extension of `Share`, not a forgotten edge case.

- 🟢 **Agree:** error states and failure recovery were underspecified.
  This spec now treats error UX as a first-class design requirement, especially across Wait, Reveal, and Share.

- 🟢 **Agree:** billing compatibility was missing.
  Credits, entitlements, and paywall surfaces intersect directly with the creation flow and must be designed alongside it.

- 🟢 **Agree:** poem parity matters.
  `PoemRevealView` already contains stronger reveal choreography than the original song reveal description. Song redesign must either adopt its language or deliberately define a compatible sibling pattern.

- 🟢 **Agree:** the original share-link timing was wrong.
  The current API returns `409 TRACK_NOT_READY` until preview or full URLs exist, so links cannot be generated during render. The correct design is to generate the share link immediately when the version becomes ready.

- 🟢 **Agree:** "AI voice first" was misframed.
  AI voice is already the selected default in `VoiceModeSelectionView`. The real friction is that first-time users still hit a voice-selection step. The redesign changes the requirement from "default AI voice" to "auto-select AI voice and skip the voice step for first-time users."

- 🟡 **Partial:** reveal anchored on "cover art" was too assumptive.
  Songs do not currently have rich generated artwork. Phase 1 reveal should anchor on occasion gradient, typography, motion, and audio. Rich artwork can be an enhancement later.

- 🟡 **Partial:** route-sprawl vs reveal needed a decision.
  This spec now commits to an **in-route reveal** as the default direction. The reveal should feel like the current route blooming into payoff, not a separate modal unless later implementation constraints force an exception.

- 🟡 **Partial:** quick scaffolding cleanup remains valid, but it is not the whole redesign.
  Remove `StoryElementsCardView`, `SongProgressIndicator`, duplicate percentage treatment in `ChatHeaderView`, and review whether `PhaseTransitionDivider` should survive in consumer-facing flow.

- 🔴 **Disagree:** a 1-day cleanup sprint is enough to determine whether the broader redesign may be unnecessary.
  The low-risk cleanup is absolutely worth doing first, but it will not answer the larger product questions around reveal, recipient experience, error UX, onboarding, and first-run activation. Those remain real design problems even if the create surface gets cleaner quickly.

### Claude Response To Codex Integration

#### Agreements confirmed (no further debate needed)

- 🟢 All 7 green integrations are correctly incorporated. The spec is materially better.
- 🟢 The activation framing (lines 60-65, 82-86) is the single most important addition. The original critique diagnosed a design-craft problem. The actual problem is an activation funnel: downloads → registration → first creation → first test/share. Every design decision should now be evaluated against this funnel, not against "does it feel amateur."
- 🟢 Position 0 (guerrilla tests) is correctly placed and correctly scoped. The test questions (lines 155-159) now target the actual funnel stages.
- 🟢 "Skip the voice step" (line 240) is factually correct and actionable.
- 🟢 In-route reveal default (lines 296-299) resolves the contradiction cleanly.

#### Resolving the 🔴 disagreement

Codex says (line 43-44): "a 1-day cleanup sprint is enough to determine whether the broader redesign may be unnecessary" is wrong because the cleanup won't answer the deeper product questions.

**My revised position:** Codex is right that the cleanup alone doesn't answer reveal, recipient, onboarding, or error UX questions. Those are real design problems. But the disagreement was never "cleanup is the whole redesign." The disagreement was about **sequencing** — whether to spend weeks on spec documents before writing any Swift, or to ship the obvious subtractions first and let the usability tests (Position 0) inform the larger redesign.

**The factual resolution:** Given the user's actual goal (people download but don't register; those who register don't test), the sequencing should be:

1. **Day 1:** Remove StoryElementsCard + SongProgressIndicator + skip voice step for first-timers. Ship to TestFlight.
2. **Week 1:** Run 5 guerrilla usability tests on the cleaned build. Watch WHERE users drop off in the funnel: is it before registration? During onboarding? At voice selection? During the chat? At the wait? We don't know yet.
3. **Week 2+:** The test results determine WHICH of the remaining design work (reveal, onboarding, recipient flow, error UX) is highest leverage for the ACTUAL drop-off point.

This is not "cleanup is enough." This is "cleanup + evidence before ceremony." We agree on the destination. The disagreement was about the path.

**Status: 🟢 Resolved.** Both positions are compatible when framed as sequencing, not scope.

#### One remaining gap in this spec

The spec still lacks the **sub-moments** that v2's "Remaining Finding #4" required. Each of the 4 moments needs temporal sub-structure for implementation:

- **Tell:** expression → confirmation → creation submission
- **Wait:** anticipation → progress reassurance → timeout escalation
- **Reveal:** payoff → immediate reaction → settle to controls
- **Share:** share CTA → refine/edit CTA → done/return

Without these, an implementer reading "Tell" doesn't know if it's one screen or three distinct states within one screen. The comprehensive doc should carry these.

---

## Status

This document is the product-design spec derived from:

- [design-like-a-yc-startup-v2.md](/Users/ao/Documents/projects/porizo/docs/design/design-like-a-yc-startup-v2.md)

It is not another critique. It defines the target experience.

## Design Goal

Porizo should feel like a calm, intimate creation flow that turns a personal memory into a song gift with almost no visible machinery.

The product should stop feeling like a feature-rich system wrapped in chat and start feeling like a confident consumer experience with one clear emotional arc.

The redesign must also directly improve activation:

- more installers should register
- more registered users should complete a first creation
- more first creations should convert into a test/share action

## Audience And Market Wedge

The strongest current market hypothesis is:

- Porizo’s early wedge is emotionally expressive gifting
- women are likely to be an overrepresented buyer and planner segment in that wedge
- the product should optimize for warmth, trust, clarity, and giftability

This does **not** mean designing from stereotypes or excluding other users. It means designing for the emotional job the product is actually hired to do.

## Product North Star

The product model is:

- conversation is the **creation surface**
- the song is the **artifact**
- reveal is the **emotional climax**
- sharing is the **completion and growth loop**

The user should feel:

- invited to express
- reassured while waiting
- rewarded at reveal
- eager to share

Activation goal:

- reduce first-run friction
- get users to their first meaningful output faster
- make the first successful share or playback happen sooner

## The Four User Moments

The user-facing experience should organize around four moments:

1. **Tell**
   The user tells the story, memory, feeling, or intention.

2. **Wait**
   The app gives emotionally framed anticipation, not backend scaffolding.

3. **Reveal**
   The song arrives with ceremony and confidence.

4. **Share**
   The app immediately supports sending the song to someone else.

These are the only user-facing moments that should dominate the flow.

`Receive` is the downstream extension of `Share`, not a fifth creation moment. The sender journey still organizes around four moments, but the redesign must specify what the recipient sees when a shared song or poem is opened.

## Core Experience Rules

### 1. One dominant purpose per screen

Every major screen or state should have one obvious job.

### 2. One dominant action per moment

At every point in the flow, the user should know what to do next without interpretation.

### 3. Internal workflow states stay internal

Engineering states may remain in code, but the UI should translate them into human moments.

### 4. The conversation stays primary during creation

The thread is the main place where emotional material is formed. It should not compete with persistent diagnostic surfaces.

### 5. The reveal must feel special

The first successful song playback in a creation session should feel like a payoff, not a status transition.

### 6. Sharing must be fast

Sharing is part of the product loop, not an afterthought.

### 7. Creative controls stay, diagnostics go

Preserve controls that help the user shape the song.
Remove or demote controls that expose system wiring.

### 8. Activation beats polish

If a decision improves emotional polish but delays first successful creation, activation wins.

### 9. Error UX is part of the product, not an implementation detail

Long-running creative flows need designed failure and recovery states.

### 10. Recipient experience is part of growth design

The sender flow is incomplete unless the receive/claim/open experience also feels premium and easy.

### 11. Value must be felt before commitment

The pre-auth path should demonstrate what the product sounds like and why it matters before demanding too much identity friction.

### 12. Recipient name beats track metadata

When there is a choice between highlighting a person and highlighting system metadata, the person should usually win.

## Position 0 — Validate Before Rebuild

Before major implementation waves, run 5 guerrilla usability tests focused on:

- install → register friction
- register → first create friction
- first create → first test/play friction
- confusion around voice choice
- confusion during wait/reveal/share

This is required input, not a nice-to-have.

### Decision Gates

Use the first 5 cold-user tests to choose the next highest-leverage design move.

- If **3/5 cold users fail before registration**, prioritize pre-auth onboarding and auth flow before reveal work.
- If users **register but stall before first creation**, prioritize voice-step removal and first-song flow simplification.
- If users **create but do not test or share**, prioritize reveal quality, sharing speed, and recipient flow.

These gates keep the redesign tied to the actual funnel bottleneck.

## Baseline Metrics Before Implementation

Before major implementation, record the current baseline for:

- install → register
- register → first create
- first create → first successful output
- first successful output → first share / recipient open

Without these baseline numbers, the redesign cannot be evaluated honestly.

## What To Remove From The Default Create Surface

The default conversation surface should not include:

- persistent story diagnostics
- explicit phase steppers
- duplicate progress indicators
- stacked control surfaces competing with the thread

Concretely, the following should be removed or demoted from the default create surface:

- [StoryElementsCardView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/StoryElementsCardView.swift)
- [SongProgressIndicator.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongProgressIndicator.swift)

## What To Keep On The Default Create Surface

The default create surface should keep:

- the thread
- the input bar
- lightweight contextual suggestion chips
- relevant creative controls only when needed
- clear transition into wait, reveal, and share

## Current File-Level Design Problems

### Primary flow density

- [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift)
  The create flow is carrying too many visual responsibilities at once.

### Engineer-facing diagnostics in consumer path

- [StoryElementsCardView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/StoryElementsCardView.swift)
  This is useful system insight, but not default consumer UI.

### Exposed phase scaffolding

- [SongProgressIndicator.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongProgressIndicator.swift)
  This exposes internal phases too directly.

### Generic onboarding

- [OnboardingView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/OnboardingView.swift)
  This is competent but not product-distinctive.

### Generic library positioning

- [MySongsView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/MySongsView.swift)
- [SongsTabView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SongsTabView.swift)
  These work, but they do not yet feel shaped around gifting and memory.

## Target Experience Changes

### A. Simplify the create flow surface

The create flow should feel like one thread with one temporary support module at a time.

### B. Design a reveal moment

The first successful song return in a flow should trigger a ceremonial reveal state before settling into playback controls.

Phase 1 reveal anchor:

- occasion gradient
- display typography
- controlled motion
- immediate audio

Do not assume rich cover art exists yet.

### C. Make share one-tap

Links should be generated automatically the moment the render becomes shareable, so sharing is one tap once the user sees the result.

### D. Reduce first-song friction

New users should skip the voice-selection step entirely and proceed with AI voice automatically. Voice enrollment should remain available as an upgrade path after the user has experienced value.

Implementation decisions required before coding:

- how first-time users are detected
- whether that detection uses local state, backend history, or both
- which default preview voice is chosen automatically when the step is skipped, optimized for warmth and trust rather than arbitrary gender coding

### E. Replace generic onboarding with product demonstration

Onboarding should let the user hear the product.

This should likely include:

- one sample song very early
- a clear “make one in 90 seconds” promise
- an experiment where recipient-name entry happens before auth if Position 0 testing supports it

If cold users do not understand why they should sign up, or abandon before registration, onboarding/auth becomes a higher priority than reveal work.

### F. Include the receive loop

The redesign must also specify the recipient open/claim experience for shared songs and poems.

### G. Design for billing and failure states

The redesigned flow must remain compatible with:

- entitlements
- billing holds
- rate limits
- paywall entry points
- render failures
- moderation blocks
- network drops

## Visual Hierarchy Rules

The redesign should not assume the current dark luxury system survives unchanged.

The leading visual direction should be:

- warm
- intimate
- trustworthy
- lighter by default

The design system should actively explore a warm light palette rather than treating dark mode as the default baseline. Dark can remain as a later supported theme, but it should no longer anchor the product identity.

What must change is hierarchy.

There should be three layers:

1. **Primary content**
   Conversation, reveal, playback

2. **Secondary support**
   Contextual controls, suggestion chips, lightweight creation options

3. **Chrome and metadata**
   Headers, secondary labels, status text, background scaffolding

Not every surface should be given similar weight.

Copy hierarchy rule:

- recipient name or occasion should usually outrank generic track metadata
- “90 seconds” should appear where first-time commitment anxiety is highest

## Mode Boundaries

The product should feel different across its four moments without adding unnecessary route complexity.

Mode boundaries should be created through:

- spacing
- motion
- surface reduction
- copy tone
- playback behavior
- background or chrome treatment

They should not require a proliferation of navigation pushes.

Default decision:

- use an **in-route reveal** rather than a new modal route
- only introduce modal reveal behavior later if implementation constraints prove it necessary and worth the tradeoff

## Priority Tiers

### Tier 1 — Structural

- run 5 guerrilla usability tests
- capture baseline funnel metrics
- if cold-user tests fail pre-auth, move onboarding/auth redesign into this tier immediately
- remove `StoryElementsCardView` from default create flow
- remove `SongProgressIndicator`
- review `PhaseTransitionDivider` and duplicate percentage treatment in `ChatHeaderView`
- normalize the create flow around Tell / Wait / Reveal / Share
- define stronger mode boundaries within the unified route
- auto-select AI voice and skip the voice step for first-time users
- decide and test a warm, trustworthy default preview voice

### Tier 2 — Emotional payoff

- build the reveal moment
- upgrade the player surface after reveal
- auto-generate share links as soon as the version becomes ready
- define recipient open/claim experience
- define error and recovery behavior across Wait / Reveal / Share
- **generate per-song AI cover art** (see Cover Art Generation spec below)

### Tier 3 — Secondary optimization

- redesign onboarding around a sample song, unless Position 0 testing promotes onboarding/auth earlier
- evaluate a warm-light token system, with “Warm Canvas” as a leading exploration candidate
- align song reveal language with `PoemRevealView`
- add billing and paywall compatibility surfaces
- rewrite user-facing copy around emotional moments
- deduplicate tactical visual noise
- revisit library design later

## Per-Song AI Cover Art Generation (Tier 2)

### Problem

Songs currently have no unique visual identity. `SongCoverView.swift` renders a generic `LinearGradient` with an occasion icon. Every song looks the same in the library, in the Reveal, and when shared. This makes the product feel generic and reduces shareability.

### Vision

Each song gets a unique AI-generated cover art image derived from the story content. This image becomes:
- The visual anchor in the Reveal moment (replacing the gradient)
- The shareable postcard image in the Share moment
- The library thumbnail that makes each song feel like a unique memory
- The OG image when a share link is previewed on social media

### Reference Implementation

A working prototype was generated during the design exploration session using DALL-E 3 via the OpenAI Images API. The result was a warm, paper-craft-style floral illustration in the Warm Canvas coral palette that reads as "a real gift."

**Prompt that produced the reference image:**

```
iOS mobile app screen for Porizo song gifting app. REVEAL moment - The Bloom concept.
Warm coral E07850 gradient radiates from center expanding outward like flower blooming
on cream FBF7F2 background. Center: For Sarah in large Fraunces serif 36pt white text
with soft shadow. Below: Happy Birthday in 16pt warm text. Subtle waveform visualization
in white pulses showing audio playing. At bottom: translucent play pause button and
prominent Share with Sarah button in coral. Minimal controls. Gradient bloom IS the visual.
No album art. Whole screen feels like gift being unveiled. Premium emotional screenshot-worthy.
iPhone 16 Pro 402x874.
```

**API call that worked:**

```
POST https://api.openai.com/v1/images/generations
{
  "model": "dall-e-3",
  "prompt": "<prompt above>",
  "n": 1,
  "size": "1024x1792",
  "quality": "standard"
}
```

**Result:** 2.3MB PNG, 1024x1792. File saved at `~/.gstack/projects/computa-porizo/designs/create-flow-20260401/variant-reveal-a.png`

### Production Process

For per-song generation, the process would be:

1. **Extract story keywords** during the Tell moment. The V2StoryEngine already extracts facts (setting, feeling, bond, moment, details). Use these as image prompt seeds.

2. **Build an image prompt** from keywords + occasion + palette constraints:
   ```
   A warm, paper-craft style illustration for a [occasion] song gift.
   Theme: [extracted keywords: "dinner parties, laughter, friendship"].
   Color palette: warm coral (#E07850), cream (#FBF7F2), sage (#7B8F6B).
   Style: 3D paper craft, layered, floral accents, soft shadows.
   Warm, intimate, gift-like. No text. Square format.
   ```

3. **Generate during the render pipeline** — add image generation as a parallel step alongside music generation. It does not block the audio render.

4. **Store as track cover art** — save to `storage/tracks/{user_id}/{track_id}/cover.png` and reference via `track_versions.cover_url`.

5. **Fallback** — if image generation fails, use the occasion gradient (current behavior). The song still works without cover art.

### Cost Estimate

- DALL-E 3 standard: ~$0.04 per image (1024x1024)
- Per preview render: adds $0.04 to the current ~$0.07 render cost
- Acceptable for the value it adds to shareability and perceived quality

### Why Tier 2, Not Tier 1

Phase 1 Reveal works with occasion gradients + typography. Cover art is a multiplier on an already-working Reveal, not a prerequisite. Ship the Reveal choreography first (Tier 1/2), then add generated art on top.

### Files to Modify

- `src/workflows/runner.js` — add parallel image generation step
- `src/services/image-generation.js` — new service (OpenAI Images API)
- `PorizoApp/PorizoApp/Components/SongCoverView.swift` — load remote cover URL when available, gradient fallback
- `PorizoApp/PorizoApp/Flows/InlineCards/InlinePlayerCard.swift` — display cover art in Reveal

## Success Criteria

This redesign is successful when:

- the create flow feels simpler without losing expressive power
- users no longer see obvious system scaffolding during creation
- the reveal feels memorable enough to become a “show someone” moment
- sharing becomes near-immediate
- first-time song creation becomes easier to start
- more installers progress to registration
- more registered users test the app at least once
- recipient open/claim experience is coherent with the sender promise

## Next Document

The comprehensive companion document should define:

- detailed screen architecture
- reveal choreography
- share flow behavior
- onboarding behavior
- copy rules
- implementation order
- validation plan

## Review Integration From `design-review-synthesis.md`

### Legend

- 🟢 Agree
- 🟡 Partial agreement / refinement
- 🔴 Disagree

### What this synthesis gets right

- 🟢 **Agree:** activation is the real product problem, not just surface polish.
  The redesign should be judged first by whether it improves `install → register`, `register → first create`, and `first create → first test/share`, not by whether it feels more premium in isolation.

- 🟢 **Agree:** audio is underused as the core product proof.
  Porizo sells a feeling through sound. A silent onboarding/auth path is structurally weak. The pre-auth experience should show or play the product earlier.

- 🟢 **Agree:** recipient-first copy is stronger than track-first copy.
  The most emotionally compelling text is the person, not the asset. “A song for Sarah” is usually better product language than a generic song title or status label.

- 🟢 **Agree:** “90 seconds” should become a headline promise if the claim is operationally true.
  The fastest way to reduce commitment anxiety is to make the time-to-value legible.

- 🟢 **Agree:** value should come before identity commitment.
  Name-before-auth and sample-before-auth are both strong activation candidates. Users should feel momentum before hitting an auth wall.

- 🟢 **Agree:** onboarding/auth may be the real bottleneck.
  If cold users leave before registration, the redesign focus must shift upstream immediately.

- 🟢 **Agree:** the existing dark luxury direction is at least a valid challenge target.
  The current aesthetic is more “premium lounge” than “warm personal gift.” That mismatch is real and should be corrected or disproven through testing.

### Where this synthesis overreaches

- 🟡 **Partial:** “women” is a useful market wedge, not a total product identity.
  The research is strong enough to treat women as a likely primary gifting audience, especially for emotionally expressive purchases. It is not strong enough to turn the product into a narrowly gender-coded app. The design target should be **warmth, trust, intimacy, and giftability**, not “design for women” as a stereotype.

- 🟡 **Partial:** a warm light palette should be the leading candidate, not an unquestioned conclusion.
  The palette work is valuable. A warm light default now deserves first-class status in the redesign. But the claim that dark mode itself is the root cause of funnel failure is still too strong. Treat light/warm as the primary direction to test, not as settled fact.

- 🟡 **Partial:** Palette A is a strong working direction, not yet a locked system.
  “Warm Canvas” is coherent with the product goal and should anchor early exploration. But final token choice still needs to prove itself against real screens and first-impression testing.

- 🟡 **Partial:** “female default voice” is too confident as a locked decision.
  The real requirement is a **warm, trustworthy, low-friction default preview voice**. That may end up female, but this should be chosen for emotional fit and testing performance, not from a simplistic gender assumption.

- 🔴 **Disagree:** the palette shift is automatically the single highest-impact change.
  It is one of the cheapest high-leverage bets, but not automatically the biggest lever. If cold users do not understand the product or refuse to authenticate before hearing value, pre-auth demonstration may matter more than any token swap.

### Claude Final Response

All 🟢 agreements hold. No further debate needed.

All four 🟡 refinements are accepted:

- 🟡 → 🟢 **"Warmth, trust, intimacy, giftability" is better language than "design for women."** The research says women are the primary buyers. The design mandate should target the JOB (emotionally expressive gifting), not the demographic. Codex's reframing is more precise and more actionable.

- 🟡 → 🟢 **Warm light as leading candidate, not dogma.** The research is directionally clear (every gifting competitor uses light, dark reduces trust for emotional products). But "test before locking" is the right epistemic stance. Ship a warm-light prototype. Run the guerrilla tests on it. Let reality decide.

- 🟡 → 🟢 **"Warm Canvas" as exploration anchor.** Agreed. It should guide early screen studies. Final tokens need real-screen validation.

- 🟡 → 🟢 **Default voice selected for warmth and trust, not gender coding.** The research on female voices being perceived as warmer is real, but Codex is right that the product rule should be "most reassuring first-run voice" not "female by default." Test 2-3 voices. Pick the one that produces the best first-listen reaction.

On the 🔴: **This is resolved by the decision gates.** We agree that BOTH the palette AND pre-auth demo are high-leverage hypotheses. We agree that the guerrilla tests determine which matters more. The decision gates (lines 222-228) are the mechanism: if 3/5 cold users fail before registration, pre-auth demo wins. If they register but the app feels cold/masculine/unwelcoming, palette wins. The tests decide. Neither hypothesis needs to be pre-declared the winner.

**Status: 🟢 All disagreements resolved.** The remaining work is execution: run tests, let data choose.

### Spec corrections derived from this review

- The redesign should actively explore a **warm light default** rather than assume the dark system stays.
- The audience framing should become: **primary wedge is emotionally expressive gifting, likely led by women buyers, without excluding everyone else**.
- The product should lead with:
  - recipient name
  - sample or heard value
  - the “90 seconds” promise
- The default first-time voice should be selected for **warmth and trust**, not locked by gender ideology.
- Pre-auth onboarding/auth work becomes Phase 0/1 if the cold-user tests show upstream drop-off.
