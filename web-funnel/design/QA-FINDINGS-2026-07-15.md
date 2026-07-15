# Web Funnel QA — Curated Findings (2026-07-15)

Source: live browser walk of commit `2d437de2` at 127.0.0.1:4174 (390×844 + 1440×900, API + Turnstile stubbed at the fetch layer) + backend-contract verification against `src/`. Every finding below was OBSERVED or code-verified — none are speculative. Fix in order.

## Cleared suspicions (no action — verified compatible)

- `/jobs/:id` terminal status IS `"completed"` (runner.js:2437; `preview_ready` at :3065 is a _version_ status) — client poll logic correct.
- `GET /tracks/:id` returns `{track, versions}` (tracks.js:563-566) — matches client shape.
- `parent_version_id` + free-form `params` accepted by `createVersion` schema (schemas:51-60) — child-version editing is API-valid.
- Code review (full pass, commit 2d437de2): all 10 hard contracts PASS; API field names/sequence match spec §5.7 exactly; token refresh single-retry correct; corrupt-storage restart tested; a11y is a strength (deliberate no-aria-live on lyrics, focus management, aria-pressed).

## P0 — must fix before any traffic

1. **Post-checkout state traps returning visitors.** After a completed (or abandoned) checkout, navigating to `/create/#recipient` renders "Confirming your payment…" — the persisted order phase overrides fresh-entry intent; the quiz is unreachable except via "Start over". Repro: finish flow → visit `/create/#recipient`. Fix: a terminal/stale order phase must not hijack a plain `/create` entry — reset to quiz (with the "pick up where you left off" card if a draft exists); only `/create/success?session_id=` re-enters order status.
2. **Turnstile config failure masquerades as a network error and blocks S0→S1 entirely.** `VITE_TURNSTILE_SITE_KEY` unset → `acquireTurnstileToken()` throws (turnstile.ts:54) → generic "We couldn't save your place. Check your connection." (App.tsx:210 catch-all). Fix: (a) dev/preview env ships Cloudflare's always-pass test sitekey (`1x00000000000000000000AA`); (b) error taxonomy — config/bot-check/network get distinct, honest copy; (c) build fails loudly if the key is missing in production mode.

## P1 — spec deviations & UX bugs (fix before launch gate)

3. **Theater stage math is off by 100×** (code review, VERIFIED): `App.tsx:497-503` `stageForJob` compares `job.progress > 0.8/0.6/0.4/0.2`, but `/jobs/:id` returns progress as a percent 0–100 (`server.js:1943-1957`, completed → 100). Any real progress ≥1% maps to the final stage, so with a live backend the staged labels jump straight to "Mixing" — the signature wait experience degrades to one static label. Fix: compare against 20/40/60/80 (or ÷100) + add a test feeding `{progress: 100}`.
4. **`?occasion=` prefill SKIPS the occasion step** (observed live: Birthday never shown as a question; collapsed row appears directly). Spec §2-S2: prefill = pre-select + move to front, still shown — the confirmation beat + optional date field are lost. Fix: render S2 with the chip selected.
5. **No auto-advance on single-select steps.** Spec §2-S1: chip tap = select + collapse-advance after 250ms. Observed: selection sets `aria-pressed` but waits for Next — one extra tap per step × 2–3 steps of pure friction.
6. **Header collision: "Start over" overlaps "Sign in"** (observed on LyricSheet phase at 390px). Placement/z bug between funnel controls and site nav; also "Start over" needs a confirm ("Your song for Sarah will be lost") — it's currently a one-tap state wipe.
7. **Entry-state layout: dead void + initial scroll offset.** On load at 390px the page scrolled to y≈163 hiding the question under the nav; body is 2060px tall with ~1,200px of empty space between the step and the entry-state footer, with the fixed CTA floating over the void. Fix: no auto-scroll on entry; keep the mockups' focus-zone rhythm; footer sits directly after content.
8. **The dim transition doesn't dim.** "Sounds right — hear it" hard-swaps to the dark scene (no 900ms luminance transition — spec §3 "the dim" is THE signature move; instant is the reduced-motion path, not the default). Implement the `--t-dim` choreography.
9. **Homepage "Father's Day" pill is a dead prefill** (code review, VERIFIED): `public/index.html` links `/create?occasion=Father%27s%20Day`, not in the Occasion enum → silently no-ops; `contracts/source.test.ts:56` asserts the link exists, encoding the contradiction. Fix: repoint to `?occasion=Custom` or drop until the enum is extended server+app side; align the test.

## P2 — fidelity & polish (fix in the same pass)

10. **"Sarah" fixture leaked as the S0 placeholder** (design: "Their name"). Observed live at both viewports.
11. **Recipient name not coral-highlighted in LyricSheet** (spec component table).
12. **Kicker grammar repeating**: "— FOR SARAH" (LyricSheet) + "— FOR SARAH" (dim) + "— THEIR GIFT LINK" (success) — tracked-caps eyebrow becoming section scaffolding, the exact tell the design system bans. Keep ONE (the dim's), drop the others.
13. **Preview player missing timecodes** (mockup s6: 0:07/0:21 under the scrub) and scrub shows a stale position pre-play.
14. **Success page "Start over" placement** — floats prominently at the top of a page whose job is sharing; demote below the share panel and rename ("Make another song").
15. **`.pulse-once` animation shorthand invalid** (`styles.css`: iteration count written as `one` → shorthand dropped; the 2nd-listen CTA glow never fires). Fix: `1`.
16. **Self-hosted fonts not preloaded** (`web-funnel/index.html`) — add `<link rel="preload" as="font">` for both faces to cut the swap flash.
17. **`package.json` deps pinned to `"latest"`** — non-reproducible ranges (lockfile saves installs in practice); set real semver ranges; move `@vitejs/plugin-react` to devDependencies.

## Test coverage gaps (add with the fixes)

- `stageForJob` numeric thresholds (would have caught #3) — feed `{progress: 100}`.
- Actual POST bodies to `/versions` + `/lyrics/generate` in `createSongDraft` (integration-shape test).
- Theater >150s hold-email capture; silent-retry→Retry-card UI flow.
- Preview auto-scroll pause-after-manual-scroll; 2nd-listen CTA pulse (would have caught #15).
- Checkout 5s-timeout toast; Stripe cancel-return state.

## Environment/process (for the backend track, not Codex)

- Local/staging QA needs the backend U1–U3 endpoints or an official mock mode; my walk required fetch-level stubs. Recommend a `VITE_API_MOCK=1` dev mode encoding the stub shapes so frontend QA doesn't depend on prod backend availability.
- The vite preview server on :4174 dies silently; document `npx vite preview --port 4174` in web-funnel README.

## Verified good (credit where due)

Stacked collapse + summary rows + S4 phase-transition summary line work as designed; family vocabulary and full style catalog present; contract tests (no hardcoded price, no autoplay) exist and pass; tokens discipline held (no raw hex in components); bundle 72KB gz (budget 150); cold `?session_id=` deep-link renders success standalone; desktop centering with site nav correct after reset; occasion emoji chips + collapsed row editing affordances render cleanly.
