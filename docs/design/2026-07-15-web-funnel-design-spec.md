# Web Funnel — Design Specification (minute detail)

2026-07-15 · Status: SOURCE OF TRUTH for implementation, alongside the mockups.
**Pixel truth lives in `web-funnel/design/*.html`** (10 screenshot-verified mockups + `tokens.css` + `base.css`). This document covers what static mockups can't: non-default states, behavior, motion, responsive rules, and integration hooks. Where prose and mockup disagree, the mockup wins for visuals, this spec wins for behavior. Product/technical context: `specs/web-funnel-spec.md`.

## 0. Non-negotiables (apply to every screen)

- **Tokens only.** Components consume `tokens.css` variables exclusively — no raw hex/px in component code. New needs → add a token, don't inline.
- **No autoplay, ever.** Audio starts only from a user tap on `.play-btn` (also unlocks the WebAudio context for iOS).
- **Focus-visible** on every interactive element (`--focus-ring`), tab order = visual order, all controls keyboard-operable.
- **Contrast floor AA:** verified pairs are documented in tokens.css comments; never place `--ink-3` on `--bg-2` or `--dim-text-2` below 15px.
- **Reduced motion:** every animation has its `@media (prefers-reduced-motion: reduce)` branch (already in base.css) — new animations must add theirs.
- **Copy voice:** feelings not features; recipient's name used wherever known ("Write Sarah's song", never "Generate"). No "AI" in user-facing funnel copy after S4. Words banned: generate, credits, render, processing, error codes.
- **Family vocabulary (per Ambrose, 2026-07-15): the iOS app's wording is canonical.** Web and app must feel like one product. Verified sources and strings:
  - Name question: **"Who's this song for?"** (`Flows/InlineNamePromptView.swift:125`).
  - Memory coaching: **"You don't need to be creative. Start with one real memory."** (`Onboarding/OnboardingV2View.swift:371`).
  - Occasions: use the app's `Occasion` enum displayName + emoji verbatim (`Models/TrackModels.swift` — I Love You ❤️, Celebration 🎉, Birthday 🎂, Thank You 🙏, Encouragement 💪, Anniversary 💑, Mother's Day 💐, Wedding 💒, Graduation 🎓, Friendship 👫, Get Well 💊, Apology 💐, Advice 🧭, Bereavement 🕊️, Custom ✨). Chip order on web = verified usage order (I Love You and Celebration first). ⚠ Parity gap: the app enum has **no Father's Day** — do not invent it on web; seasonal variants need the enum extended first (server `occasion` is free-text, app display would fall back to Custom).
  - Styles: the app's `StyleOption` catalog is the genre source (popular: Pop, Acoustic, Soul, Folk, Jazz, R&B, Rock, Country, Ballad · african: Afrobeats, Highlife, Igbo Highlife, Amapiano, Jùjú, Fuji, Afropop · latin: Reggaeton, Salsa, Bossa Nova, Cumbia, Bachata, Samba, Latin Pop). Web shows 9 + "More styles…" expanding the full categorized list. Never invent styles that aren't in the catalog.
  - Share message prefill: **"I made this song for you, {name}."** (+ occasion phrase variant) — `Controllers/ShareController.swift:415-421`.
  - Recipient reveal greeting: the enum's `greeting` strings ("With Love", "Happy Birthday"…) — same greeting the app's reveal bloom uses.
  - Flow container: the stacked collapse (§1) intentionally mirrors the app's inline cards + `CollapsedCardSummary` — same gesture, same product.

## 1. THE FLOW MODEL — stacked collapse (per Ambrose, 2026-07-15)

**The quiz (S0–S4) is ONE continuous surface, not a slideshow.** When a step is answered it **collapses in place into a 52px summary row** (`.step-done`: quiet key + bold value + edit pencil, hairline separator) and the next question settles into the same focus zone (`.step-live`). The page grows above the user's eye line; the user never feels transported — _they stay at one place while the process moves_. Mockup: `flow-stacked.html` (mid-flow with three collapsed rows + live memory step). This mirrors the iOS create flow's inline cards + `CollapsedCardSummary` — web and app become the same product gesture.

Mechanics (CSS shipped in `base.css`):

- **Collapse choreography:** on answer → live step's content wrapper (`.collapse-wrap`) animates `grid-template-rows: 1fr → 0fr` over `--t-step` (280ms) → summary row fades in → next `.step-live` settles (8px rise, 280ms). Total perceived motion ≤ 12px. Reduced motion: instant swap.
- **Scroll anchoring:** after a collapse, scroll so the live question's heading sits at the same viewport y as the previous one (~35% from top). If the stack fits above, no scroll at all. Never scroll-jump more than the collapse delta.
- **Edit = re-expand in place:** tapping a `.step-done` row expands THAT step inline (its wrapper back to `1fr`), collapsing the currently-live question below it into a waiting state; answering re-collapses and returns focus to where the user was. Downstream answers are preserved (only lyrics regeneration invalidates, and only after S4).
- **The stack IS the progress indicator** — collapsed rows replace progress dots entirely (dots CSS remains in base.css for any future use, unused in the funnel).
- **Phase transition at S4 → theater:** the whole stack collapses into ONE summary line ("Sarah · Mum · I Love You ❤️ · Acoustic, warm, female voice" + edit pencil) pinned under the top bar, and the theater begins beneath it in the same focus zone. Same place, next act. The dim (S6) is the one deliberate scene change — it's the payoff and earns it.
- Column `--col: 480px` centered; mobile padding `--pad-x: 20px`; top bar 56px (brand only; back chevron unnecessary — the stack is the way back). Browser back = collapse-reopen of the previous step (history entries per step).
- Primary CTA: bottom-fixed on mobile (`.cta-bar`, gradient fade, safe-area padded); inline on ≥720px. Labels name the action ("Write Sarah's song", "Unlock for $19.99") — never "Continue" after S4.

## 2. Per-step states & behavior (screen mockups = each step's expanded content; flow-stacked.html = the container)

### S0 `s0-recipient.html` — name

- CTA disabled until ≥1 char. Enter key = Next. Name is trimmed, title-cased for display only (store raw).
- Errors: none (any name valid). Moderation happens at S4 submit.
- Return visitor with saved progress → toast-style card above the question: "Pick up Sarah's song where you left off" + quiet "start over".

### S1 `s1-relationship.html` — relationship (single-select)

- Question interpolates the name ("**Sarah** is your…"). Chip tap = select + auto-advance after 250ms (single-select screens auto-advance; CTA is the fallback for reduced-motion/AT users).
- "Someone else…" swaps a text field into the chip row (max 50 chars) with its own Next.

### S2 `s2-occasion.html` — occasion (single-select) + optional date

- Chips = the app's `Occasion` enum verbatim (see §0 family vocabulary), ordered by verified usage: I Love You ❤️ · Celebration 🎉 · Birthday 🎂 · Thank You 🙏 · Encouragement 💪 · Anniversary 💑 · Mother's Day 💐 · Wedding 💒 · Graduation 🎓 · Friendship 👫 · Get Well 💊 · Custom ✨ (Apology/Advice/Bereavement live under Custom's expansion — heavy for a gift funnel's first row). Seasonal variants re-order via `?occasion=` prefill (pre-selects + moves to front, never removes, never invents non-enum occasions).
- Date is free-text (no calendar widget — "July 26" is enough); stored for delivery-reminder copy only. No auto-advance (two inputs on screen).

### S3 `s3-memory.html` — memory + phrase

- Textarea: placeholder rotates through 4 coaching examples (8s interval, crossfade; static first example under reduced motion). Counter turns `--coral-700` at 1900, hard stop 2000.
- Soft nudge below 20 chars on Next: hint swaps to "One more sentence — what did it feel like?" (non-blocking; second Next proceeds).
- Moderation rejection (from API at S4 submit) routes back here: field `aria-invalid`, `.error-text`: "We couldn't use part of that — try saying it a different way." Never echo which words.

### S4 `s4-sound.html` — genre/mood/voice (each single-select)

- Three groups, group labels in `--fs-small`/`--ink-3`. Defaults preselected (Acoustic · Warm · Female voice) so CTA is always enabled — momentum over completeness.
- CTA "Write Sarah's song" fires the full API sequence (track create → version → lyrics). Failures: moderation → S3 error state; rate-limit/`FUNNEL_PAUSED` → holding card ("We're at capacity — leave your email and we'll hold your place", email field + quiet submit); network → inline retry.

### S5 `s5-theater.html` — generation theater

- Stage labels cycle (aria-live=polite): "Reading your memory…" → "Writing the words…" → "Finding the melody" → "Recording the vocals" → "Mixing" — advance on real job progress when available, else timed (12s each), never regress.
- Lyric lines feed in as generated lyrics arrive (client reveals sequentially, 900ms stagger, `rise` animation). Max 4 lines shown — a taste, not the sheet.
- > 150s: append hold-your-place email capture (quiet, inline). Job failure: one silent retry, then card: "That take didn't come together. Let's try again — your details are safe." + primary Retry (counts against cap).
- Refresh/return: state machine re-attaches to job poll; theater resumes at correct stage. Never restart the quiz.

### S6 `s6-preview.html` — lyrics + the dim + preview player

- Entry: LyricSheet first on `--bg` (light) with primary "Sounds right — hear it" and quiet "Change something" (inline editing, 3 regenerations/guest cap). On "hear it": **the dim** — background luminance animates `--bg`→`--ink-deep` over `--t-dim` (900ms), lamplight fades in, content crossfades to player. Reduced motion: instant scene swap. (Mockup shows the post-dim player state.)
- Playback: karaoke `.now` line follows `timeupdate`; lines scroll to keep `.now` vertically centered (smooth 300ms; auto-scroll pauses 4s after manual scroll). Scrub is display-only in preview (no seek — 20s chorus).
- Preview ends → play button returns as replay; after 2nd full listen, CTA bar pulses once (single 600ms glow — never loops).
- Preview-cap state (2 generations): "Change something" replaced by "You've heard two versions free — unlocking lets us perfect it with you."

### S7 `s7-offer.html` — offer

- Price from `GET /web/products` — **never hardcoded** (mockup's $19.99 is illustrative). No strikethrough/fake-sale styling (brand rule: no fake urgency). If `PREVIEW_ONLY` flag on → this screen unreachable (S6 CTA hidden, replaced by "Save your song" email capture).
- CTA → `POST /web/checkout` → same-tab redirect to Stripe Checkout. Button enters loading state (spinner replaces label, disabled) — max 5s then error toast + re-enable.
- Cancel/return from Stripe: back to this screen, state intact, quiet toast "Nothing was charged."

### S8 `s8-success.html` — order status → delivery

- Three sequential states: (1) `confirming` — "Confirming your payment…" (poll; >60s → support line appears); (2) `rendering` — "Finishing Sarah's song…" + progress copy from job ("verse 2 of 3"); (3) `delivered` — mockup state: link card + share chips + reaction nudge + account note.
- Render-fail-after-pay (rare): honest card — "We couldn't finish the song, so we've refunded you in full. Your details are saved if you'd like to try again." (matches U6 automation).
- Copy button: clipboard + label swaps to "Copied ✓" 2s. Share chips use `sms:`/WhatsApp URL schemes with pre-filled message: "I made you something. Press play when you're somewhere quiet 🧡 {link}".
- Deep-link entry (`?session_id=` from email, cold device): renders standalone — server state only.

### R0–R2 `play-reveal.html` — recipient gift page

- R0 (unopened): exactly the mockup — no lyrics, no waveform, no product pitch. OG/social preview mirrors it ("Someone made you a song 🧡 — For Sarah").
- Play tap → the dim is already the scene; transition is content-level: reveal copy fades, player + karaoke lyrics fade in (700ms). Sender's message-level card can follow post-v1.
- R2 (claim card): appears ONLY after ≥1 completed listen (`ended` event), rising from below (reduced motion: appears). Copy per mockup — reciprocity framing ("answer back"), zero urgency ("this link plays forever").
- Claimed-elsewhere: card swaps to "Saved in Sarah's app ✓ — it plays here forever, too." Revoked/refunded: warm unavailable page ("This song isn't available right now."), no error jargon, support link.
- This page must work on any browser ≥2019: progressive `<audio>` m4a/mp3, no module-only JS on the playback path.

## 3. Motion inventory (complete)

| Name             | Where                  | Spec                                                                                               | Reduced-motion      |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------- | ------------------- |
| step-advance     | S0–S4                  | 280ms, fade+12px rise, `--ease-reveal`                                                             | instant             |
| collapse-settle  | S0–S4 stacked flow     | wrap 1fr→0fr 280ms → summary row fade-in → next step settles (≤12px total motion); scroll-anchored | instant swap        |
| chip-commit      | chips                  | border+bg 120ms; auto-advance delay 250ms                                                          | instant             |
| lyric-rise       | S5                     | 700ms rise per line, 900ms stagger                                                                 | visible immediately |
| progress-shimmer | S5                     | 2.4s translating bar loop                                                                          | static 50% bar      |
| **the dim**      | S6 entry, R0 (pre-set) | 900ms bg luminance + lamplight fade                                                                | instant scene       |
| karaoke          | S6/R1                  | color swap per line on timeupdate; centered auto-scroll 300ms                                      | color swap only     |
| cta-pulse        | S6 after 2nd listen    | one 600ms glow, once                                                                               | none                |
| claim-rise       | R2                     | 700ms rise on listen end                                                                           | appears             |

## 4. Responsive & platform

- Breakpoints: base ≤719px (mobile, fixed CTA) · ≥720px (column centered, warm radial ambient on light pages, inline CTA). No layout re-architecture — the funnel is a column everywhere; desktop is atmosphere, not new UI.
- Test matrix (launch gate, from implementation plan U14): TikTok iOS webview · Instagram iOS webview · Safari iOS · Chrome Android · desktop Chrome/Safari. Fixed CTA + `100dvh` + safe-area insets are the known webview risk points — verify per screen.
- Fonts: Fraunces + DM Sans via Google Fonts, `display=swap`, preconnect (already in mockups); self-host at build time (U8) to cut the third-party request.

## 5. Asset inventory (to produce before launch)

| Asset                                                           | Used                            | Source                                                   |
| --------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| Cover-art thumbnails                                            | S8 link card (v1.1), lyric card | existing `cover-generator.js`                            |
| OG image for gift links                                         | recipient link unfurls          | existing OG pipeline (verified in sharing routes)        |
| Landing hero photo (real listening moment, warm domestic light) | `/` rework (separate task)      | reaction-clip pipeline stills, until then verified stock |
| App store badges                                                | S8/R2                           | official assets                                          |

## 6. Design QA gates (before Codex's work merges)

1. Screenshot parity: rendered screens vs `web-funnel/design/*.png` baselines (regenerate via the harness recipe in CODEX-BRIEF).
2. Contrast audit on any NEW token pair introduced.
3. Keyboard-only walk of the full funnel; VoiceOver pass on S6/R1 (aria-live on lyrics is _off_ — announce play state changes only).
4. The slop test: would a stranger guess "AI gift site template"? The dim + reveal must stay distinctive — if a change flattens them, it fails review.
