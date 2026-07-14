# Codex Implementation Brief — Porizo Web Funnel Frontend

You are implementing the **frontend** of the Porizo web funnel (units U8–U11 of `docs/plans/2026-07-14-002-feat-web-funnel-implementation-plan.md`). The design is fully decided — your job is faithful implementation, not design judgment. When something visual is ambiguous, the answer is in a mockup; when behavior is ambiguous, it's in the design spec. If genuinely absent from both, STOP and ask — do not invent.

## Source-of-truth precedence (highest first)

1. **`web-funnel/design/*.html` + `tokens.css` + `base.css`** — pixel truth. 11 screenshot-verified mockups. Copy the markup/CSS patterns directly; they are production-intent, not sketches.
2. **`docs/design/2026-07-15-web-funnel-design-spec.md`** — behavior truth: the stacked-collapse flow model (§1 — READ FIRST), per-step states (§2), motion inventory (§3), responsive/platform (§4), QA gates (§6).
3. **`specs/web-funnel-spec.md`** — product/integration truth: API sequences (§5), funnel targets (§1), edge cases (§9).
4. **`docs/plans/2026-07-14-002-feat-web-funnel-implementation-plan.md`** — build order, per-unit test scenarios, verification.

## Hard contracts (violations fail review)

1. **Tokens only.** Every color/size/duration comes from `tokens.css` variables. Zero raw hex/px in components. Need something new → add a token + a comment, flag it in the PR.
2. **The stacked collapse IS the flow** (spec §1): quiz steps collapse to 52px summary rows in ONE continuous surface; live question stays in a stable focus zone; ≤12px perceived motion per transition; scroll-anchored; edit = re-expand in place. No screen-swap routing for S0–S4.
3. **Family vocabulary** (spec §0): the iOS app's strings are canonical — "Who's this song for?", the `Occasion` enum displayNames + emoji, the `StyleOption` catalog, "I made this song for you, {name}." Never write new user-facing copy; every string in the mockups/spec is final.
4. **No autoplay.** Audio starts only on the play-button tap.
5. **Reduced motion:** every animation has its `prefers-reduced-motion` branch (patterns in base.css).
6. **Price is never hardcoded** — offer screen renders `GET /web/products`. (Grep-able invariant: `19.99` must not appear in the SPA source.)
7. **No new dependencies** beyond the U8 stack (Vite + React + TS) without asking. No UI libraries — base.css already is the component library.
8. Standing brand bans: no voice-clone copy, no fake urgency/countdown, no "AI magic"/sparkle/robot iconography, no strikethrough pricing.
9. **The funnel is a page of porizo.co** (spec §1): render under the site's `.nav--static` header (reuse `public/styles/main.css` classes — logo · How it works · Pricing · Blog) with the nav CTA swapped to a quiet "Sign in"; landing occasion pills and hero CTAs enter `/create` with `?occasion=` prefill; footer only on the entry state; dim pages reduce to brand mark. A funnel that looks like a standalone micro-app fails review.
10. **The column is CENTERED at every viewport width** (`.shell` centering guard in base.css). Verify against `flow-stacked.html` rendered at 1440×900 before opening the PR — a left-anchored column is a review-failing bug (caught once already, 2026-07-15).

## Build order & acceptance (mirrors implementation-plan units)

1. **U8 scaffold**: Vite+React+TS in `web-funnel/`; port tokens.css/base.css as the style layer (self-host the two fonts at build); funnel state machine with localStorage+server resume; static mount plan per `src/plugins/http-bootstrap.js` precedent. ✔ Accept: `/create` serves the shell; state machine unit tests green; bundle ≤150KB gz.
2. **U9 quiz (stacked)**: S0–S4 as collapse-flow steps (container per `flow-stacked.html`; per-step content per `s0…s4` mockups; behavior spec §2). ✔ Accept: full quiz produces the exact `POST /tracks` body (snapshot test); keyboard-only completable; collapse choreography matches spec §3 timings.
3. **U10 theater + preview**: `s5-theater.html` staging + lyric feed from real lyrics; LyricSheet → approve → the dim (`s6-preview.html`) with karaoke sweep; resume-safe job polling. ✔ Accept: refresh mid-render resumes; `ended` fires once per listen; reduced-motion renders the final scene instantly.
4. **U11 offer + success**: `s7-offer.html` (products API) → checkout redirect → `s8-success.html` three-state order status + SharePanel. ✔ Accept: cancel returns with state intact; cold deep-link `?session_id=` renders standalone; copy button announces to screen readers.

Backend endpoints (U1–U6) are being built in parallel by another session — code against the API shapes in `specs/web-funnel-spec.md` §5.7 and stub locally; do not modify `src/` backend code.

## Screenshot verification (required per unit)

Regenerate and eyeball against the committed baselines before opening the PR:

```bash
# baselines: web-funnel/design/*.html rendered at 390×844 (2x) — see /tmp/design-*.png recipe
# in review: your implemented screens at the same viewport must match the mockups'
# layout, spacing, and type scale to the eye; token drift = failure.
```

Launch QA gates (spec §6): contrast on new pairs, keyboard walk, VoiceOver on S6/R1, the slop test, and the webview matrix (TikTok iOS, IG iOS, Safari iOS, Chrome Android) before merge to main.

## Out of scope for you

Backend routes/migrations (U1–U7), landing-page rework, `/play` recipient page server template (U7 — separate), analytics wiring (U12 — comes after), Etsy/marketing anything. If a task seems to require touching those, stop and flag it.
