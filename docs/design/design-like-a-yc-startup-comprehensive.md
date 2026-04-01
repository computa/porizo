# Design Like A YC Startup — Comprehensive Design Document

## Review Integration From `spec-review-findings.md`

### Legend

- 🟢 Agree
- 🟡 Partial agreement / refinement
- 🔴 Disagree

### Integrated conclusions

- 🟢 **Agree:** user validation must happen before large implementation waves.
  This document now treats 5 guerrilla usability tests as `Position 0`, not a trailing validation step.

- 🟢 **Agree:** activation must be a primary redesign outcome.
  The redesign is not only about craft quality. It must improve:
  - install → register conversion
  - register → first create conversion
  - first create → first test/share conversion

- 🟢 **Agree:** recipient experience was a major omission.
  Since sharing is described as the growth loop, this document now includes the receiver path as part of the overall product design.

- 🟢 **Agree:** error UX and recovery were underspecified.
  A product with long async generation cannot ship a sunny-day redesign only.

- 🟢 **Agree:** billing and entitlement compatibility must be explicit.
  Credits, holds, and paywalls intersect with the redesigned flow and cannot be left implicit.

- 🟢 **Agree:** song reveal must be designed in relation to the existing poem reveal.
  `PoemRevealView.swift` already contains stronger ceremonial language than the original song reveal sketch.

- 🟢 **Agree:** AI voice is already the selected default; the real friction is the voice-selection step itself.
  The redesign now targets **skipping** that step for first-time users instead of merely changing a default.

- 🟡 **Partial:** the original reveal leaned too hard on nonexistent cover art.
  Phase 1 reveal should anchor on gradient, typography, motion, and audio. Generated art can be a later enhancement.

- 🟡 **Partial:** the original share timing was wrong.
  Links cannot be created while the track is still not ready under the current API. The correct design is to generate the share link immediately when preview or full output becomes ready.

- 🟡 **Partial:** the "no route sprawl" principle needed a hard decision.
  This document now commits to an **in-route reveal** as the default design direction. A modal exception would need explicit justification.

- 🔴 **Disagree:** the obvious 1-day cleanup is enough to tell us whether the larger redesign is unnecessary.
  The cleanup is worth doing immediately, but it will not resolve the deeper product issues around activation, recipient experience, reveal quality, error recovery, and onboarding. It is a foundation, not a verdict.

### Claude Response To Codex Integration

#### Agreements confirmed

- 🟢 All integrations are correctly applied. This document is now actionable.
- 🟢 Phase 0 (lines 739-746) is the right first move. The cleanup items are concrete, low-risk, and directly address activation by removing friction (voice step skip) and cognitive load (scaffolding removal).
- 🟢 Error and Recovery Specification (lines 626-661) fills the critical gap. The moment-by-moment error listing is the right structure.
- 🟢 Billing and Entitlement Compatibility (lines 663-676) correctly frames billing as a product decision point, not a surprise interruption.
- 🟢 The Receive section (lines 286-310) and Screen 4 (lines 458-467) close the growth loop gap.
- 🟢 Full-render failure after preview reveal (lines 516-531) handles the partial-success dead zone correctly.

#### 🔴 → 🟢 Disagreement resolved (cleanup sprint)

The disagreement (line 46-47) is resolved by reframing as sequencing:

**Agreed path forward:**
1. Phase 0 ships in 1 day (lines 739-746). This is the cleanup sprint.
2. 5 guerrilla tests run on the cleaned build (lines 773-786). This tells us WHERE users actually drop off.
3. Phases 1-3 are informed by test results, not by design assumptions.

The cleanup sprint is not a verdict on whether the redesign is needed. It is the fastest path to testable improvement + evidence for the next wave. Both models agree.

#### Remaining gap: the actual activation problem needs diagnosis

The user's stated goal reframes everything in these documents:

> People download the app but don't register. Those who register don't test.

This is a **funnel problem**, not a design-craft problem. The documents diagnose "scaffolding leaks" and "too many surfaces" — both valid — but neither may be the actual reason users don't register or test. Possible causes the documents don't address:

| Funnel Stage | Possible Cause | Addressed? |
|---|---|---|
| Download → Open | App Store screenshots/description mismatch | No |
| Open → Register | Onboarding doesn't demonstrate value (carousel is generic) | Yes (Phase 3) — but this should be Phase 0/1 |
| Register → First Create | Auth friction (Apple/Phone — requires commitment before value) | No |
| First Create → Name Entry | CTA copy unclear (already fixed in today's UX commit) | Yes |
| Name Entry → Story Chat | Voice selection blocks (Phase 0 fixes this) | Yes |
| Story Chat → Wait | Chat feels like work, not expression | Partially (scaffolding removal helps) |
| Wait → Reveal | Reveal is underwhelming | Yes (Phase 2) |
| Reveal → Share | Share is multi-tap | Yes (Phase 2) |
| Share → Recipient Opens | Recipient experience absent | Yes (now added) |

**The critical insight:** If the biggest drop-off is at **Open → Register** (before users even see the create flow), then Phases 1-3 of this redesign address the wrong part of the funnel. The guerrilla tests MUST include pre-registration observation to determine this.

**Recommendation:** Add to the Position 0 usability test protocol:

```
Test 0a: Hand someone the app who has never seen it.
- Do they understand what it does within 5 seconds?
- Do they tap "Sign in with Apple" or do they leave?
- If they leave, why? What did they expect vs. what they saw?
```

If 3 of 5 users leave before registering, the highest-leverage fix is NOT scaffolding removal — it is the pre-auth experience (onboarding + auth screen). That would promote the onboarding redesign from Phase 3 to Phase 0.

#### Sub-moments (still missing)

Per v2's Finding #4, each moment needs sub-moments for implementation:

**Tell sub-moments:**
1. Expression — user is typing/speaking, AI is responding
2. Confirmation — story is complete, user reviews/confirms
3. Creation submission — lyrics generated, track creation initiated

**Wait sub-moments:**
1. Anticipation — first 30 seconds, "Composing the melody..."
2. Progress reassurance — 30-90 seconds, copy evolves ("Adding your voice...")
3. Timeout escalation — 90+ seconds, "This is taking longer than usual"

**Reveal sub-moments:**
1. Payoff — song arrives, auto-play begins, visual ceremony
2. Immediate reaction — controls appear, share becomes available
3. Settle — transitions to stable player with full controls

**Share sub-moments:**
1. Share CTA — prominent one-tap share, link already ready
2. Refine — secondary edit/reroll options
3. Done — return to library or create another

These should be added to the Four User Moments sections above.

## Review Integration From `design-review-synthesis.md`

### Legend

- 🟢 Agree
- 🟡 Partial agreement / refinement
- 🔴 Disagree

### Agreements integrated

- 🟢 **Agree:** activation is the frame, not just aesthetics.
  The new synthesis correctly recenters the work around the funnel: downloads that do not register, registrations that do not become first tests, and first outputs that do not get shared.

- 🟢 **Agree:** audio should appear earlier in the product.
  A silent cold-start path undersells the product. Sample audio or heard value should move closer to first launch and pre-auth onboarding.

- 🟢 **Agree:** recipient-led language is stronger than metadata-led language.
  The app should lead with the person and occasion more often than the artifact and status labels.

- 🟢 **Agree:** “90 seconds” is one of the strongest low-commitment promises available.
  If operationally defensible, it should become part of auth/onboarding/create entry messaging.

- 🟢 **Agree:** pre-auth demonstration deserves promotion.
  Sample-song-first and potentially name-before-auth are both strong activation experiments.

- 🟢 **Agree:** onboarding/auth may need to move ahead of reveal work.
  If users leave before registration, the redesign focus must move upstream immediately.

### Where the synthesis is directionally useful but too confident

- 🟡 **Partial:** women are likely a primary wedge, not the whole product identity.
  The research supports designing for emotionally expressive gifting and treating women as a likely dominant early segment. It does not justify turning the design into a narrow gender performance. The correct product translation is: optimize for warmth, trust, intimacy, and giftability.

- 🟡 **Partial:** a warm light palette should become the leading candidate, not a dogma.
  The current dark luxury system is a valid challenge target, and a warm light direction now deserves explicit priority. But token choice still needs real-screen and first-impression validation.

- 🟡 **Partial:** “Warm Canvas” is a strong exploration anchor.
  It should guide early screen studies, but not be treated as the irrevocable system before actual UI testing.

- 🟡 **Partial:** default voice should optimize for warmth and trust, not simply “female.”
  The redesign should pick the most reassuring first-run preview voice. That may end up female, but the product rule should stay tied to emotional fit and evidence, not stereotype.

- 🔴 **Disagree:** the palette shift is automatically the single highest-impact change.
  It is a plausible high-leverage move. It is not automatically higher leverage than pre-auth value demonstration if the real drop-off is before registration.

### Claude Final Response

All 🟡 refinements accepted. Codex's reframings are more precise:

- 🟡 → 🟢 "Warmth, trust, intimacy, giftability" > "design for women." Target the job, not the demographic.
- 🟡 → 🟢 Warm light as leading candidate to test, not settled fact. Ship a prototype, run guerrilla tests on it.
- 🟡 → 🟢 "Warm Canvas" anchors exploration. Final tokens need real-screen proof.
- 🟡 → 🟢 Default voice: warmth + trust, tested not assumed. Run A/B on 2-3 voices.

🔴 → 🟢 **Resolved.** Palette vs. pre-auth demo is a testable hypothesis, not a debate. The decision gates (lines 234-242) are the mechanism. If cold users leave because the app looks wrong, palette wins. If they leave because they don't understand the product, pre-auth demo wins. The guerrilla tests decide.

**Document status: All disagreements resolved. The docs are ready to drive implementation.**

---

## Purpose

This document is the comprehensive redesign brief for Porizo based on:

- [design-like-a-yc-startup-v2.md](/Users/ao/Documents/projects/porizo/docs/design/design-like-a-yc-startup-v2.md)
- [design-like-a-yc-startup-spec.md](/Users/ao/Documents/projects/porizo/docs/design/design-like-a-yc-startup-spec.md)

It translates the design diagnosis into a concrete product direction, screen model, behavioral rules, and implementation priorities.

## Executive Summary

Porizo currently feels too aware of its own internals. The create flow exposes progress scaffolding, diagnostic surfaces, and too many simultaneous controls. The result is a product that is capable but not yet inevitable.

The redesign should make the product feel like a calm, intimate consumer experience with four clear user moments:

1. Tell
2. Wait
3. Reveal
4. Share

The core synthesis is:

- the conversation is the creative instrument
- the song is the artifact
- the reveal is the emotional climax
- the share step is the growth loop

This redesign also has a product-growth goal:

- fewer people should download and abandon before registration
- more newly registered users should create and test a first song or poem
- more first successful creations should lead to a share or recipient-open event

## Audience And Market Wedge

The strongest current market hypothesis is:

- Porizo’s early wedge is emotionally expressive gifting
- women are likely to be an overrepresented planning and purchase segment within that wedge
- the product should therefore optimize for warmth, trust, clarity, and giftability

This is not a license for caricature or exclusion. The design goal is not “make it feminine” in the abstract. The goal is to make the app feel emotionally safe, generous, personal, and easy to try.

## Design Goal

Porizo should feel like a premium consumer app that helps someone turn a personal memory into a song gift with minimal friction and almost no visible machinery.

The user should not feel like they are operating a system. They should feel like they are being gently led through an expressive act.

This document therefore optimizes for both:

- experiential quality
- activation quality

## Design Principles

### 1. Emotional arc over workflow visibility

The app should optimize for emotional flow, not visible phase management.

### 2. One dominant action at a time

At every moment, there should be one obvious next move.

### 3. The thread is primary during creation

Conversation is the main surface where emotional material is created.

### 4. Reveal gets the most design energy

The reveal is the highest-value emotional moment and deserves the strongest choreography.

### 5. Tools support expression but must not dominate

Creative controls are valuable. Diagnostics and scaffolding are not part of the default consumer experience.

### 6. Faster sharing is product work

Sharing is not a postscript. It is part of the core loop.

### 7. Mode boundaries should feel clear without route sprawl

Different moments in the flow should feel distinct through behavior and composition, not through unnecessary screen proliferation.

### 8. Activation-first prioritization

Low-effort changes that improve first successful creation should ship before ceremonial polish.

### 9. Receiver experience matters

If sharing is part of the north star, the recipient path is product-critical, not downstream cleanup.

### 10. Failure is part of the designed experience

Errors, retries, moderation blocks, and long waits must be intentionally designed.

### 11. Funnel bottlenecks outrank downstream polish

If onboarding or registration is the main drop-off point, it outranks reveal and player polish until that bottleneck improves.

### 12. Heard value beats abstract explanation

When possible, let the user hear or feel the product before asking them to commit.

### 13. Human meaning outranks asset metadata

Recipient, occasion, and emotional context should usually lead over generic titles and statuses.

## Position 0 — Evidence Before Major Redesign

Before major implementation beyond the obvious low-risk cleanups, run 5 guerrilla usability tests focused on:

- why installers do not register
- why newly registered users do not test the app
- where users hesitate in the first create flow
- how users interpret the voice choice step
- whether reveal/share actually feel worth completing

This does not block small obvious subtractions, but it should inform the larger redesign wave.

### Decision Gates

Use the first cold-user tests to choose what moves first.

- If **3/5 cold users fail before registration**, prioritize pre-auth onboarding and auth flow before reveal work.
- If users **register but stall before first creation**, prioritize skipping the voice step and tightening the first-song path.
- If users **create but do not test/share**, prioritize reveal, share, and recipient flow.

These gates keep the redesign aligned with the actual funnel bottleneck.

## Baseline Metrics Before Implementation

Before shipping redesign work, capture the current baseline for:

- install → register
- register → first create
- first create → first successful output
- first successful output → first share / recipient open

These metrics are required so redesign work can be judged against real movement in the funnel.

## Pre-Auth Activation Hypothesis

The current best activation hypothesis is:

- let users hear a sample song earlier
- make the “90 seconds” promise visible
- test whether recipient-name entry should happen before auth

This should be treated as an experiment set, not as untouchable truth. Position 0 testing decides whether this becomes Phase 0 or remains a later phase.

## The Four User Moments

## 1. Tell

### User goal

Express who the song is for and what matters emotionally.

### User feeling

Open, guided, safe, lightly prompted.

### What the screen should feel like

- one main thread
- one main input surface
- very little chrome
- no diagnostics competing with the thread

### What belongs here

- recipient and occasion capture
- story conversation
- contextual suggestion chips
- lightweight creative steering when relevant

### What does not belong here

- persistent story dashboards
- explicit system step tracking
- competing cards above and below the thread
- playback surfaces

### File implications

- [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift)
- [V2StoryEngine.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/V2Story/V2StoryEngine.swift)
- [SongOptionsCard.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongOptionsCard.swift)

## 2. Wait

### User goal

Feel that something meaningful is being made, without needing to parse technical stages.

### User feeling

Anticipation, reassurance, momentum.

### What the screen should feel like

- simplified
- emotionally framed
- lighter than the conversation mode
- no visible engineering jargon

### What belongs here

- one reassuring status surface
- emotionally framed copy
- subtle animation
- optional cancel/back behavior only if truly necessary

### What does not belong here

- backend phase names
- stepper metaphors
- stacked support cards

### File implications

- [SongProgressIndicator.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongProgressIndicator.swift)
- [CreatingTrackView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/CreatingTrackView.swift)
- [RenderController.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Controllers/RenderController.swift)

## 3. Reveal

### User goal

Experience the song arriving as a payoff.

### User feeling

Reward, surprise, delight, intimacy.

### What the screen should feel like

- ceremonial
- premium
- uncluttered
- emotionally centered on the song

### What belongs here

- large visual anchor using gradient artwork treatment in phase 1, with optional richer generated art later
- strong track title treatment
- immediate playback
- controlled haptic/motion feedback
- clear transition into player and share

### What does not belong here

- dense controls immediately competing with the reveal
- debug-like completion UI
- “song created” as a minor badge-level event

### File implications

- current inline player surfaces in the create flow
- playback handoff in [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift)
- [SongCoverView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Components/SongCoverView.swift)

## 4. Share

### User goal

Send the song with minimal friction.

### User feeling

Ready, proud, immediate.

### What the screen should feel like

- simple
- confident
- not workflow-heavy

### What belongs here

- one-tap share
- immediate share sheet
- lightweight refine/edit options if needed

### What does not belong here

- multi-step share preparation
- unclear link-generation states

## Downstream Extension: Receive

`Receive` is not a fifth core creation moment, but it is a required downstream surface because the sender flow is incomplete without it.

### Receiver goal

Open the gift and understand immediately:

- who sent this
- what it is
- what to do next

### Receiver feeling

Surprised, welcomed, emotionally primed.

### Relevant files

- [ShareClaimView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/ShareClaimView.swift)
- [PoemClaimView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PoemClaimView.swift)
- [PoemRevealView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PoemRevealView.swift)

### Design rule

Sender-side share optimization and recipient-side open/claim experience must feel like one continuous product promise.

## Current-State Problems Mapped To Files

### A. Overloaded create surface

- [UnifiedCreateFlowView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/UnifiedCreateFlowView.swift)

Problem:

- too many concerns are visible at once
- too many secondary surfaces share the same canvas

### B. Consumer path includes engineer-facing diagnostics

- [StoryElementsCardView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/StoryElementsCardView.swift)

Problem:

- exposes internal story-collection scaffolding
- competes with the actual emotional conversation

### C. Progress scaffolding is too literal

- [SongProgressIndicator.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/SongProgressIndicator.swift)

Problem:

- translates internal process into visible phases too directly

### D. Waiting state feels operational, not anticipatory

- [CreatingTrackView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/CreatingTrackView.swift)

Problem:

- progress is functional, but not emotionally designed

### E. Onboarding is generic

- [OnboardingView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/OnboardingView.swift)

Problem:

- explains the product without letting users feel it

### F. Library feels like inventory, not memory/gifting

- [MySongsView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/MySongsView.swift)
- [SongsTabView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Tabs/SongsTabView.swift)

Problem:

- competent list design
- limited emotional product identity

### G. Receiver path is disconnected from sender-centric design

- [ShareClaimView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/ShareClaimView.swift)
- [PoemClaimView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PoemClaimView.swift)

Problem:

- the original redesign direction centered sender creation but did not specify the recipient open/claim experience that closes the growth loop

### H. Tactical scaffolding leaks remain outside the main two offenders

- [ChatHeaderView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/ChatHeaderView.swift)
- [PhaseTransitionDivider.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Flows/InlineCards/PhaseTransitionDivider.swift)

Problem:

- duplicated completion percentage in header
- transition dividers still carry phase-like visual scaffolding

## What To Cut / Keep / Merge / Defer

## Cut

- `StoryElementsCardView` from the default create path
- `SongProgressIndicator`
- duplicate progress or completion indicators
- persistent diagnostics in the conversation surface

## Keep

- the thread as the dominant creation surface
- suggestion chips
- contextual creative controls
- the overall warm, intimate direction, while actively testing a lighter and more trust-building default palette

## Merge

- internal phase language into four user moments
- multiple stacked creation states into one calmer thread-led flow
- share preparation into the render pipeline so share becomes near-instant

## Defer

- full library redesign
- deeper post-MVP content organization
- secondary polish that does not materially improve Tell / Wait / Reveal / Share

## Primary Screen Architecture

### Screen 1: Create Flow

This remains the main route, but its internal behavior changes.

#### Tell mode

- header with minimal chrome
- thread
- bottom composer
- only one temporary support module at a time

#### Wait mode

- same route, but reduced interface
- thread recedes
- anticipation surface becomes primary

#### Reveal mode

- same route, with in-place expansion and takeover treatment
- ceremonial reveal
- immediate controlled playback

#### Share mode

- reveal settles into premium player/share state
- one-tap sharing is primary

### Screen 2: Onboarding

Replace the current generic onboarding with a product demonstration experience.

Proposed shape:

- single dominant screen
- short emotional framing
- tap to hear a sample song
- clear “make something in 90 seconds” promise
- optional experiment: enter recipient name before auth if Position 0 testing supports it
- immediate CTA to create your own

### Screen 3: Library

Keep the current library mostly stable for now, but plan later work to make it feel more like a collection of meaningful gifts than a utilitarian list.

### Screen 4: Receive / Claim Flow

The recipient path should be explicitly designed, not treated as a backend share side effect.

Goals:

- emotionally prime the recipient
- clarify sender attribution immediately
- reduce friction before playback/claim
- create a credible path from recipient delight to app trial

## Reveal Moment Specification

## Intent

The reveal should make the arrival of the song feel significant.

## Proposed behavior

### Trigger

Default proposal:

- trigger on the first successful song result in a creation session
- use preview-ready as the initial reveal trigger
- treat full-render completion as an enhancement state, not the first ceremonial reveal

Poem compatibility rule:

- audit [PoemRevealView.swift](/Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/PoemRevealView.swift) first
- song reveal should either adopt its ceremonial language or deliberately define a sibling pattern
- do not create two unrelated reveal styles in the same app

### Presentation

- in-route takeover treatment, not a new modal route by default
- occasion gradient, typography, motion, and audio as the phase-1 visual anchor
- track title in stronger display typography
- immediate playback of the opening seconds
- explicit haptic spec to be defined during implementation
- minimal controls at first

Do not assume rich generated cover art exists in phase 1.

### Handoff

After the initial reveal:

- transition into a stable player/share state
- expose share as the primary next action
- expose refine/edit as secondary

### Resume / retry behavior

- resumed sessions should not replay the full ceremonial reveal by default
- regenerated versions may get a lighter reveal treatment
- failed/retry flows should return to wait or edit without fake celebratory behavior

### Full-render failure after preview reveal

The redesign must explicitly support this state:

- preview reveal already happened
- user requested full song
- billing hold may exist
- full render fails

Required UX:

- do not replay reveal
- return to a premium-but-clear player state
- explain what failed in user language
- expose retry and support actions
- make billing state understandable if relevant

## Sharing Specification

## Goal

Reduce share friction to near-zero after reveal.

## Desired behavior

- share link generated automatically immediately upon successful completion
- share button available immediately after reveal
- one tap opens system share sheet
- copy-link behavior should be instant

## UX rule

The user should never feel like they are waiting for sharing to become possible after the song is already ready.

Technical constraint:

- current share endpoint cannot create links until preview or full output exists
- therefore, generate on `previewReady` or `fullRenderReady`, not earlier

## Receiver Experience Specification

### Goal

Make the recipient experience emotionally coherent and conversion-friendly.

### Requirements

- strong sender attribution
- immediate understanding of what was received
- clear claim/open action
- no confusing dead-end before playback
- consistent visual language with sender-side reveal/share flow

### Activation goal

The receiver flow should increase the chance that a recipient installs or tests the app after emotionally engaging with the gift.

## First-Song Experience Specification

## Goal

Increase first successful song creation rate.

## Changes

- skip the voice-selection step for first-time users
- auto-select AI voice for first-time users
- present “My Voice” as optional / secondary
- defer voice-enrollment friction until after the user understands the product value

### Important clarification

`VoiceModeSelectionView` already defaults to AI voice. The redesign target is not the default value. It is removal of the first-time decision step itself.

### Implementation decisions required before coding

The team must decide:

- how first-time users are detected
- whether that uses local state, backend history, or both
- which default preview voice is auto-selected when the step is skipped, optimized for warmth and trust rather than arbitrary gender coding

## Onboarding tie-in

The onboarding should reinforce:

- this is what the product sounds like
- you can make one quickly
- your own voice is an upgrade path, not an entry barrier

## Visual Hierarchy Rules

The redesign should use three layers consistently.

The visual system should actively test a warm light default. The current dark luxury direction should no longer be treated as the unquestioned baseline.

### Layer 1 — Primary

- thread
- reveal
- player
- primary CTA

### Layer 2 — Secondary

- contextual controls
- suggestion chips
- occasion/style adjustments when relevant

### Layer 3 — Chrome and metadata

- headers
- minor progress copy
- labels
- status/supporting context

### Rule

If two layer-1 elements are present simultaneously, the screen is probably too busy.

## Error And Recovery Specification

Error UX must be defined for each moment.

### Tell

- network failure submitting story input
- moderation or policy blocks
- account / entitlement problems before creation

### Wait

- generation failure
- timeout
- user backgrounds the app and returns
- job completes while user is away

### Reveal

- preview succeeds but full render fails later
- playback cannot start
- audio unavailable temporarily

### Share

- share generation fails
- claim/open fails
- network loss during share

### UX rule

Errors must preserve momentum where possible:

- explain what happened
- say what the user should do next
- avoid revealing backend internals

## Billing And Entitlement Compatibility

The redesigned flow must stay compatible with:

- `entitlements`
- `billing_holds`
- preview vs full render access
- paywall prompts
- rate limits

Design rule:

- billing should appear as a product decision point, not a surprise interruption after emotional investment unless unavoidable
- if a hold exists and a later step fails, the UX must explain the state clearly

## Wait Timing And Background Completion

The wait experience must react to elapsed time.

Minimum design thresholds to specify during implementation:

- short wait
- long wait
- unusually long wait / timeout edge
- background completion notification
- return-from-background state restoration

The app should not use one flat waiting experience for a 10-second pause and a 3-minute render.

## Motion, Haptics, Sound, And Accessibility

These were previously underspecified and must be defined in implementation detail before shipping reveal work.

### Motion

- reveal entry motion
- reveal-to-player handoff
- wait-state transitions

### Haptics

- exact haptic type for reveal
- optional haptic behavior for key transitions

### Sound

- auto-play behavior respecting audio session conditions
- silent mode and interrupted audio behavior

### Accessibility

- Reduce Motion alternative
- VoiceOver-friendly progression through Tell / Wait / Reveal / Share
- Dynamic Type behavior for reveal typography

## Copy And State Translation Rules

Do not expose internal phase labels directly.

Translate system states into emotional or user-centered copy.

Examples:

- not `lyricsApproved`
  use “Putting your story into lyrics”

- not `fullRenderActive`
  use “Composing your song”

- not `previewReady`
  use reveal-first copy, not status jargon

The user should always feel the app is speaking in product language, not system language.

When choosing between a person-centered label and an asset-centered label, prefer the person-centered label unless there is a strong reason not to.

## Implementation Order

### Phase 0 — Validation + obvious cleanup

1. run 5 guerrilla usability tests
2. record baseline funnel metrics
3. decide whether onboarding/auth must move into Phase 0 based on the cold-user decision gates
4. run first-impression checks on the leading warm-light direction before locking design tokens
5. remove `StoryElementsCardView` from default create flow
6. remove `SongProgressIndicator`
7. review `ChatHeaderView` percentage duplication
8. review `PhaseTransitionDivider` in consumer-facing flow
9. skip voice-selection step for first-time users

### Phase 1 — Structural redesign

1. simplify the create composition around the thread
2. introduce clearer mode boundaries across Tell / Wait / Reveal / Share
3. specify billing, error, and background completion behavior
4. define recipient flow contract with sender share flow
### Phase 2 — Emotional payoff

1. build reveal choreography
2. improve player surface after reveal
3. align song reveal with poem reveal language
4. auto-generate share links on ready
5. make sharing immediate

### Phase 3 — Activation and onboarding

1. redesign onboarding around sample-song demonstration, unless Position 0 testing promotes onboarding/auth to Phase 0
2. make “90 seconds” and recipient-first value proposition visible in auth/onboarding/create entry
3. polish copy and tactical hierarchy cleanup
4. refine receiver claim/open experience for conversion

### Phase 4 — Secondary follow-up

1. reassess library when usage justifies it
2. refine deeper content organization and destination quality

## Validation Plan

## Guerrilla usability tests

Run five lightweight tests focused on confusion, not just bugs.

Key questions:

- do users know what to do next in the create flow?
- does the waiting state feel reassuring or mechanical?
- does the reveal feel special?
- do users understand how to share immediately?
- does skipping the voice step reduce hesitation?
- do recipients understand and complete the claim/open flow?

## Success metrics

Track:

- install → registration conversion
- registration → first create conversion
- first create → first successful output conversion
- first successful output → first share / recipient open conversion
- first-song completion rate
- time from first open to first successful song creation
- share initiation rate after reveal
- drop-off before voice selection
- user hesitation and confusion points observed in testing

## Final Design Standard

Porizo should not feel like “a system that can generate songs.” It should feel like “the easiest, warmest way to turn what you feel about someone into a song gift.”

That means:

- less visible machinery
- cleaner emotional pacing
- stronger reveal
- faster sharing
- simpler first-run activation
