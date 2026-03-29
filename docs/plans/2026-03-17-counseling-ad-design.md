# Ad Design: "Remember When" — Couples Counseling × Porizo

**Date:** 2026-03-17
**Status:** Design approved, ready for implementation
**Platforms:** Instagram Reels, TikTok (9:16, ~50s), Facebook, YouTube pre-roll (16:9, 15-30s)

## Concept

A couple in a counseling session. The counselor asks: "When was the last time you reminded each other of your memories together?" This triggers a flashback through their love story — how they met, fell in love, built a life. The flashback culminates in one of them creating a Porizo song, and the couple crying as they relive their memories through music.

**Production:** HeyGen AI avatar (counselor) + Remotion programmatic video (love story + app demo)
**Variants:** Two versions targeting different demographics

## Act Structure (Both Variants)

| Act | Seconds | Source | Description |
|-----|---------|--------|-------------|
| 1. Hook | 0-5s | HeyGen | Counselor: "When was the last time you reminded each other of your memories together?" |
| 2. Porizo Intro | 5-8s | Remotion | Logo reveal with warm glow transition |
| 3. Love Story | 8-25s | Remotion | Chat messages → photos → story highlights |
| 4. Song Creation | 25-35s | Remotion | PhoneMockup showing full Porizo app flow |
| 5. Payoff | 35-45s | HeyGen + Remotion | Song plays, couple emotional. Counselor smiles. |
| 6. CTA | 45-50s | Remotion | "Turn your memories into a song" + App Store badge |

## Variant A: Young Couple (20s)

### Act 3 — Love Story

| Beat | Component | Content | Duration |
|------|-----------|---------|----------|
| First contact | ChatMessage | Dating app match → "Hey, is that your dog in pic 3?" / "That's my roommate's dog, I'm the one holding the pizza 😂" | 4s |
| First date | PhotoScene | Coffee shop photo, text reveal: "October 2022" | 3s |
| Falling | ChatMessage | "I can't stop thinking about last night" / "Same. When can I see you again?" | 3s |
| Milestones | PhotoScene montage | Concert → road trip → meeting friends | 4s |
| The moment | TextReveal | "Two years later, they forgot how it all started" | 3s |

### Act 4 — Song Creation

- Occasion: "Anniversary"
- Recipient: "Jake"
- Message: "Remember our first date? You had pizza sauce on your shirt and I pretended not to notice"
- Style: Acoustic / Warm

### Act 5 — Payoff

- Song audio fades in over couple photos
- Cut to counselor (HeyGen) — subtle smile, small nod
- Text: "Sometimes you just need to hear it"

## Variant B: Established Couple (30s-40s)

### Act 3 — Love Story

| Beat | Component | Content | Duration |
|------|-----------|---------|----------|
| How they met | PhotoScene | Wedding photo, text reveal: "June 2012" | 3s |
| Early days | ChatMessage | "I left you lunch in the fridge ❤️" / "You're the best thing that ever happened to me" | 4s |
| Building a life | PhotoScene montage | First apartment → pregnancy announcement → baby's first steps | 5s |
| Drift | TextReveal | "Somewhere between school runs and deadlines, they stopped reminding each other" | 3s |
| The quiet | PhotoScene | Same couple, same couch, both on phones | 2s |

### Act 4 — Song Creation

- Occasion: "Just Because"
- Recipient: "Sarah"
- Message: "I still remember the night we danced in the kitchen at 2am because you couldn't sleep"
- Style: Soul / Heartfelt

### Act 5 — Payoff

- Song plays, couple listening together
- She puts her head on his shoulder
- Cut to counselor (HeyGen) — warm smile
- Text: "The best gift is a memory they forgot they had"

## HeyGen Counselor Spec

- **Avatar:** Professional, warm female (30s-40s). Natural look.
- **Background:** Blurred warm-toned office (bookshelf, soft lamp)
- **Clips to generate:**
  1. Hook: "When was the last time you reminded each other of your memories together?" (~5s)
  2. Smile/nod reaction (~3s)
  3. Optional alt hook for A/B testing

## Remotion Build Plan

### New Files

| File | Purpose |
|------|---------|
| `src/videos/AdCounselingYoung.tsx` | Variant A master composition |
| `src/videos/AdCounselingEstablished.tsx` | Variant B master composition |
| `src/components/AppFlowDemo.tsx` | Animated PhoneMockup showing Porizo creation flow |

### Reused Components

- `TextReveal` — Story text moments
- `ChatMessage` — Text message conversations
- `PhoneMockup` — App UI showcase
- `PhotoScene` — Couple photo montages with overlays
- `SceneTransition` — Smooth transitions between acts
- `EndCard` — CTA with App Store badge

### Audio Layers

| Layer | Source | Acts |
|-------|--------|------|
| Counselor voice | HeyGen MP4 audio | 1, 5 |
| Background music | Royalty-free emotional piano | 2-4 |
| Porizo sample song | Existing render output | 5 |

### Render Specs

- Master: 1080×1920 (9:16) @ 30fps, ~50s (1500 frames)
- YouTube cut: 1920×1080 (16:9) @ 30fps, 15-30s (trim Acts 1, 4, 5, 6)
- Total deliverables: 2 variants × 2 formats = 4 videos

## Assets Needed

| Asset | Source | Count |
|-------|--------|-------|
| Young couple photos | Stock (Unsplash/Pexels) | 5-6, consistent couple |
| Established couple photos | Stock | 5-6, same couple across ages |
| Background music | Royalty-free | 1 track, emotional piano, ~50s |
| Porizo sample song | Existing render | 1 real Porizo output |
| App screenshots | Porizo app | Occasion picker, message input, generation screen |
| HeyGen counselor clips | HeyGen API | 2-3 clips |

## Implementation Order

1. Generate HeyGen counselor clips
2. Source stock photos for both variants
3. Build `AppFlowDemo` component
4. Build `AdCounselingYoung.tsx` composition
5. Render and review Variant A
6. Build `AdCounselingEstablished.tsx` (reuse structure, swap assets/copy)
7. Render and review Variant B
8. Create 16:9 YouTube cuts from both
