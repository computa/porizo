# Design Review Synthesis — 5-Agent Findings

**Agents:** Design Shotgun, Design Lab, Frontend Design Quality, UX Flow, Feminine Design Research
**Goal:** Meta/WhatsApp quality app that solves: downloads that don't convert to registrations, registrations that don't convert to testing.

---

## The Single Biggest Finding

**The "Velvet & Gold" dark design system is actively repelling the primary audience.**

Women drive 63-80% of personalized gift purchases (greeting cards, personalized gifts, celebration planning). Every successful gifting app (Headspace, Bumble, Moonpig, Etsy, TouchNote, Artifact Uprising, Calm) uses light backgrounds. Not one uses dark. Porizo's `#0A0A0A` near-black background reads as "nightclub" or "premium whiskey," not "I'm making something beautiful for Mom's birthday."

Research shows women prefer light mode, dark mode reduces trust for emotional products, and cognitive performance is higher in light mode. The current design system is a market-fit problem, not just an aesthetic choice.

---

## Cross-Agent Convergence (All 5 agents independently arrived at these)

### 1. Audio is the most underused asset

The product IS audio. Yet:
- Onboarding is silent (3 pages of text + icons)
- Auth screen is silent
- Library is silent
- The reveal auto-plays but arrives as an inline card

**Every direction that adds proactive audio outperforms its silent equivalent.** A 10-second sample song on first launch does more than any amount of visual design.

### 2. The recipient name should be the loudest text

Porizo is about people, not songs. The current UI treats song titles and metadata as the organizing principle. "A song for Sarah" is more compelling than "Birthday Song - Preview Ready." Every screen should lead with WHO, not WHAT.

### 3. "90 seconds" should be everywhere

The strongest marketing claim ("make something in 90 seconds") appears nowhere prominent in the UI. It should be on the auth screen, the onboarding, and the create entry. It's the single best argument for low-commitment registration.

### 4. Value must come before commitment

The current funnel: explain (carousel) → authenticate (identity) → create (value).
The correct funnel: demonstrate (hear a song) → personalize (type a name) → authenticate (you already want this).

The Design Lab agent identified the fix: move name entry before auth. The user types "Sarah," feels emotional investment, and THEN registers because they've already started something.

### 5. The design system needs a fundamental palette shift

Current: Dark masculine luxury (near-black + bronze gold + editorial serif)
Needed: Warm intimate personal (light warm background + organic warm accent + approachable serif)

---

## Three Proposed Design Token Palettes

### Palette A: "Warm Canvas" (RECOMMENDED)

Closest to: Headspace + Artifact Uprising

| Token | Current | Proposed |
|-------|---------|----------|
| Background | `#0A0A0A` (near-black) | `#FBF7F2` (warm parchment) |
| Surface | `#161616` (dark gray) | `#FFFFFF` (white) |
| Primary Accent | `#D4A574` (metallic gold) | `#E07850` (terracotta coral) |
| Secondary Accent | `#8B7355` (dark gold) | `#7B8F6B` (sage green) |
| Text Primary | `#F5F5F0` (warm white) | `#2C2420` (warm near-black) |
| Text Secondary | `#8A8A8A` (gray) | `#6B6560` (warm gray) |
| Display Font | Playfair Display | Fraunces (variable, high softness) |
| Body Font | SF Pro | SF Pro or DM Sans |

### Palette B: "Soft Bloom"

Closest to: Bumble + Moonpig. Dusty rose (`#D4637A`) + muted teal (`#5B7B8A`). Boldest emotional play. Tests best with women specifically.

### Palette C: "Golden Hour" (Safest evolution)

Closest to: Headspace warm. Preserves the gold family (`#D4894A` amber/honey) but shifts background from near-black to warm cream (`#FDF6EE`). Smallest visual departure from current system.

---

## The Activation Funnel: 14 Drop-Off Points

The UX Flow agent mapped the complete funnel. The 3 biggest drop-offs:

| Drop-Off | Stage | Current State | Fix |
|----------|-------|--------------|-----|
| **A** (biggest) | Download → Register | Silent carousel, then auth wall. No value demonstrated. | Sample song on first launch. Name entry before auth. |
| **C** | Main app → Create | User doesn't understand what they'll get | "90 seconds" messaging. Sample in library. Visual occasion grid. |
| **I** | Voice Selection | User confused by AI Voice vs My Voice step | Skip for first-timers (already in plan) |

**Critical sequencing problem:** Drop-offs A and C are likely the biggest (the stated problem is "downloads don't register"), yet the redesign defers their fix to Phase 3 while spending Phases 1-2 on post-auth improvements.

---

## 5 Guerrilla Test Scripts (Ready to Run)

| Test | What You Say | Pass | Fail |
|------|-------------|------|------|
| **1. Five-Second** | "Look at this. What does it do?" | They say "making songs" in 5s | They say "I don't know" |
| **2. Registration** | "Try using this app." | They reach main view in 60s | They stop at auth and ask "can I try first?" |
| **3. First Create** | "Your friend's birthday. Make something." | Complete chat in 3 min | Stare at blank input 15+ seconds |
| **4. Voice + Wait** | "Finish making the song." | Pick voice in 10s, wait through render | Hesitate at voice 10+s, background app |
| **5. Reveal + Share** | "Your song is ready." | Smile, look for share | Shrug, say "that's it?" |

**Scoring:** If 3/5 fail Tests 1-2 → fix onboarding/auth FIRST. If they pass 1-2 but fail 3 → fix chat empty state. If they pass 1-3 but fail 4 → skip voice step. If they pass 1-4 but fail 5 → build reveal ceremony.

---

## The 5 Most Important Animations (With Specs)

| # | Animation | Duration | Easing | Trigger |
|---|-----------|----------|--------|---------|
| 1 | **Reveal Entry** | 800ms (3 phases) | Spring(0.5, 0.8) + easeOut(0.3) | Preview ready |
| 2 | **Wait Breathing** | 3000ms loop | easeInOut(1.5) | Enter wait state |
| 3 | **Card Press** | 150ms down, 200ms up | spring(0.25, 0.7) | Touch on any card |
| 4 | **Share Confirm** | 300ms | easeOut(0.3) + spring | Tap share button |
| 5 | **Mode Transition** | 350ms | easeInOut(0.35) | Tell→Wait→Reveal→Share |

---

## The Reveal: 3 Visual Directions

| Direction | Concept | Best For |
|-----------|---------|----------|
| **A: "The Bloom"** | Occasion gradient expands from center, title + auto-play. In-route. | Default choice — proven pattern (Spotify Wrapped) |
| **B: "The Vinyl Drop"** | Gold circle drops from top with spring bounce + crackle sound. | Most distinctive — could be Porizo's signature moment |
| **C: "The Letter Reveal"** | Gold envelope unseals, revealing title + audio. Gift metaphor. | Most emotionally coherent with gifting identity |

**Note:** PoemRevealView.swift already has a wax-seal reveal with animations. The song reveal should learn from it but be a different component (audio needs auto-play, not tap-to-open).

---

## Reveal Haptic Specification

```swift
// On reveal trigger:
let generator = UINotificationFeedbackGenerator()
generator.prepare()
generator.notificationOccurred(.success)

DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
    let impact = UIImpactFeedbackGenerator(style: .heavy)
    impact.impactOccurred(intensity: 0.8)
}
// Reduce Motion: keep .success, skip .heavy
```

---

## Wait Copy by Timing Threshold

| Elapsed | Copy |
|---------|------|
| 0-15s | "Composing..." |
| 15-30s | "Writing the melody for {name}..." |
| 30-60s | "Bringing the lyrics to life..." |
| 60-90s | "Almost there, adding the finishing touches..." |
| 90-120s | "Still working on this one. Good songs take a moment." |
| 120s+ | "Taking longer than usual. We'll notify you when it's ready." |

---

## Implementation Decisions (Resolved)

| Decision | Answer | Rationale |
|----------|--------|-----------|
| First-time detection | Local `UserDefaults` flag, backend reconciliation on login | No network dependency on cold path |
| Default AI voice gender | Female | Warmth, approachability, gifting register |
| Reveal route | In-route transformation, not modal | Matches "no route sprawl" principle |
| Song reveal approach | Separate from PoemRevealView — different interaction model (auto-play vs tap-to-open) | Audio demands immersion |
| Tell-to-Wait boundary | Input bar slides down, thread dims to 60%, anticipation element rises | "The room goes quiet after speaking" |

---

## Priority Resequencing (Based on All Findings)

The design documents defer onboarding/auth to Phase 3. Given the actual problem (downloads don't register), and that 5 agents independently identified this as the likely biggest drop-off, the sequencing should be:

| Phase | What | Effort |
|-------|------|--------|
| **0a** | Run 5 guerrilla tests on current build | 0 (2 hours of observation) |
| **0b** | If tests confirm pre-auth drop-off: redesign onboarding (sample song + name-before-auth) | 1-2 days |
| **0c** | Palette shift: swap DesignTokens from dark to light warm | 1 day |
| **1** | Remove StoryElements + SongProgress + skip voice step + ChatHeader dedup | 0.5 day |
| **2** | Build reveal choreography + pre-generate share links | 1-2 weeks |
| **3** | Recipient flow + error UX + re-engagement hooks | 1-2 weeks |

**The palette shift (0c) is the single highest-impact change.** Flipping from dark to light with warm accents changes the app's first-impression signal from "exclusive members club" to "warm personal gift." Every screen benefits. No feature logic changes. Pure design token swap.

---

## Sources

30+ sources cited across agents. Key references:
- Gift demographics: GiftAFeeling, MediaCulture, GlobeNewsWire, GiftLips
- Light/dark mode research: Taylor & Francis, Almax Agency, Loop11, Medium UX
- Consumer app design: Headspace, Bumble, Moonpig, Etsy, Calm, Spotify, TikTok, Duolingo
- Typography: Google Fonts (Fraunces, Lora), PeerJ serif preference research
- Color psychology: MockFlow, NW Brand Design, Sage Design Group
- UX patterns: NNGroup, Laws of UX, OpenAI UI Guidelines
