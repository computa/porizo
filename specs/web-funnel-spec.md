# Porizo Web Funnel — Product, Design & Integration Specification

Version 1.0 · 2026-07-14 · Status: PROPOSED
Owner: Ambrose · Companions: `docs/plans/2026-07-14-repositioning-review-gift-first-web-funnel.md` (why), `docs/plans/2026-07-14-001-feat-web-first-pivot-execution-plan.md` (when/sequencing), `docs/plans/2026-07-14-002-feat-web-funnel-implementation-plan.md` (build order + tests).

Everything in §6–§9 is grounded in a verified code read (file:line refs from the 2026-07-14 backend scout pass). Items marked ⚠ VERIFY are known unknowns to confirm at implementation, not assumptions.

---

## 1. What this is

A web storefront at **porizo.co** that sells a personalized song gift: quiz → free preview (hear it before you pay) → Stripe checkout → full song delivered as a link that plays in any browser → recipient claims it into the app. The iOS app becomes the studio + keepsake; the web becomes acquisition + purchase. Buyer never needs to install anything; recipient never hits a wall before hearing the song.

**North-star flow:** TikTok/Meta ad (reaction video) → `/create` → 4 warm questions → 60–90s "making your song" theater → preview plays their name → $19.99 unlock → share link → recipient cries → recipient claims in app → recipient makes one back.

### Success metrics (funnel targets, benchmarks from web2app data)

| Step                               | Target | Benchmark                      |
| ---------------------------------- | ------ | ------------------------------ |
| Visit → started quiz               | ≥ 40%  | —                              |
| Started → preview played           | ≥ 25%  | ~13% reach paywall (FunnelFox) |
| Preview → purchase                 | ≥ 8%   | ~3% visit→purchase overall     |
| Visit → purchase (blended)         | ≥ 1.5% | 3% is top-quartile             |
| Paid → delivered (share link sent) | ≥ 98%  | —                              |
| Recipient link → played            | ≥ 70%  | —                              |
| Recipient played → app claim       | ≥ 25%  | today: 18% claim→account       |

---

## 2. Design system: evaluation and new work

### 2.1 Evaluation of Warm Canvas v2 against the storefront role

Warm Canvas v2 (`public/styles/main.css`, mirrored in `DesignTokens.swift`) was built to _present an app_. The website's new job is to _sell a gift and stage two emotional peaks_. Assessment:

**Keep (identity, verified working):**

- The warm palette DNA: coral `#E07850` as brand accent, sage `#7B8F6B`, ink `#1A1410` — distinctive against competitor blues/purples, AA-verified ramps.
- Token architecture (CSS custom properties shared conceptually with iOS) — extend, don't fork.
- The voice: message-first warmth. It matches the verified product truth (people say _I love you / thank you_, not just "happy birthday").

**Falls short for the new role (the "new thinking" mandate):**

1. **It's a brochure system, not a commerce system.** Zero components exist for: price presentation, offer framing, trust signals (reviews, secure payment, guarantee), checkout affordances, order status. Every competitor page we researched leads with social proof and a price-anchored offer; we have nothing to build that with.
2. **The cream-paper restraint is now the saturated default.** The 2026 AI-generated landing page _is_ a warm cream page with a serif display font — and our exact pair (Fraunces + DM Sans) sits on the saturation list. Little Hum, and a dozen AI-song sites, occupy the same soft-cream lane. Restraint without a POV now reads generic, which is fatal for a paid-traffic landing page where the ad's emotional charge must not dissipate on arrival.
3. **No components for the two moments that ARE the product:** (a) the buyer hearing the recipient's name sung for the first time; (b) the recipient opening the gift. These are the conversion event and the viral event. They deserve the boldest design in the system; today they'd be a `<audio>` tag on a cream card.
4. **No audio-first primitives.** No player, waveform, lyric-highlight, or long-wait progress components. A 60–90s generation wait with a generic spinner will kill the funnel; the wait must be theater.
5. **No imagery system.** The category's proven creative is human reaction imagery (Songfinch's entire ad engine). Our site is text + app screenshots. A gift brief with zero human imagery reads incomplete.
6. **Motion is an afterthought** (three duration tokens, no choreography, no reveal grammar).

### 2.2 The new design direction: Warm Canvas v3 — "Storefront register"

Evolution, not replacement: iOS app and existing SEO pages stay on v2 tokens; the storefront surfaces (landing, funnel, delivery, recipient page) get a committed extension. One system, two registers.

**Scene sentence (forces the theme):** _It's 10pm. She's in bed, phone in hand, two weeks before her mum's 60th. A TikTok of a daughter's song just made her cry. Warm lamplight. She wants her mum to feel that._ → Light, warm, intimate base — **but when a song plays, the lights dim.**

**The signature move — "the lights dim":** every song-playback moment (preview reveal, recipient gift-open) transitions the page from warm cream into a deep warm-dark "lamplight" treatment (`--ink-deep #14100C` field, warm radial spotlight, coral accents glowing). A theater dimming for the performance, then lights back up for the decision. This is our anti-slop differentiator: no competitor stages the listening moment; it's ownable, it photographs well in screen-recordings (free UGC), and it solves problem #3 directly. Reduced-motion variant: instant crossfade to the dark scene, no animated dimming.

**Color strategy:** Restrained (v2) between moments → **Committed** at moments. Coral carries 30–60% of the surface on hero, offer, and CTAs; the dim-scene is Drenched dark. Extended ramp (all AA-checked against their grounds):

```css
/* additions to :root in a new storefront.css layer */
--coral-50: #fdf1eb;
--coral-100: #f9dfd2;
--coral-300: #eda07c;
--coral-500: #e07850; /* = --gold, unchanged brand anchor */
--coral-600: #c4602f;
--coral-700: #a34e26; /* text-safe on cream, 4.6:1+ */
--ink-deep: #14100c; /* the dim scene */
--lamplight: radial-gradient(
  ellipse 720px 560px at 50% 30%,
  rgba(224, 120, 80, 0.16),
  rgba(20, 16, 12, 0) 70%
);
--paper-warm: #f5efe6; /* v2 --bg-2, quiet sections only */
```

**Typography:** keep Fraunces (display) + DM Sans (body) **for launch** — identity continuity beats novelty when the brand already ships on them, and a font migration mid-pivot is surgery we don't need. New discipline instead of new fonts: fluid modular scale (`clamp()`, ratio ≥1.25), display ceiling 4.5rem, `text-wrap: balance` on headings, weight-contrast (Fraunces 400 display vs DM Sans 500 UI). **Call-out for a later brand pass (post-launch):** run the impeccable font-selection procedure for a distinctive display face for the wordmark + reveal moments only; Fraunces is on the 2026 saturation list and a bespoke display voice is the cheapest long-term differentiation. Not a launch blocker.

**Imagery system (new, required):**

- **Reaction imagery is first-class:** permission-based stills/clips of real recipients listening (collection pipeline already planned in the execution plan). Hero = one decisive photo of a real listening moment in warm domestic light, not a phone mockup.
- Fallback until real assets exist: warm, specific stock ("grandmother laughing at a kitchen table, warm lamplight, eyes closed"), verified URLs only, alt text in brand voice ("the second verse got her").
- Never: robot/AI iconography, sparkles, waveform-as-decoration clichés.

**Motion grammar (new tokens + three named moves):**

```css
--ease-reveal: cubic-bezier(0.16, 1, 0.3, 1); /* ease-out-expo family */
--t-reveal: 700ms;
--t-dim: 900ms;
--t-step: 280ms;
```

1. **Step-advance** — funnel questions slide/settle (280ms, translateY 12px + fade); answers commit with a soft coral pulse on the chip.
2. **The dim** — 900ms background/luminance transition into the lamplight scene when playback starts.
3. **Karaoke sweep** — gold/coral `clip-path` sweep across the active lyric line, synced to `timeupdate` (the exact mechanic already built in `marketing/remotion/src/videos/Hook25.tsx` — port it).
   All three carry `prefers-reduced-motion` fallbacks (crossfade / instant state).

**New component inventory (the commerce + audio families v2 lacks):**

| Component           | Used on                                    | Notes                                                                                                                                                       |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FunnelShell`       | all quiz steps                             | progress dots, back affordance, one question per viewport, autosaving                                                                                       |
| `ChoiceChips`       | relationship, occasion, genre, mood, voice | 44px+ targets, multi-line wrap, "type your own" escape                                                                                                      |
| `MemoryField`       | memory step                                | large textarea + rotating placeholder coaching ("the time she…", 2000-char cap with warm counter)                                                           |
| `OccasionDate`      | occasion step                              | optional date → real urgency later ("in time for July 26")                                                                                                  |
| `GenerationTheater` | making step                                | staged 60–90s progress: writing → lyrics lines materialize one-by-one → arranging → singing; never a bare spinner; survives refresh (resumes from job poll) |
| `LyricSheet`        | lyrics/preview                             | full lyrics, inline edit affordance, recipient name highlighted in coral                                                                                    |
| `PreviewPlayer`     | preview step                               | dim-scene player: big play affordance, karaoke sweep, replay, 15–25s badge ("this is the chorus — the full song is 60–90s")                                 |
| `OfferCard`         | paywall                                    | price, bundle contents (full song · lyric card · video · lifetime link), Apple Pay/GPay marks, guarantee line, single CTA                                   |
| `TrustRow`          | landing + offer                            | ratings, "songs delivered" count, secure-payment marks — real numbers only                                                                                  |
| `OrderStatus`       | success page                               | payment ✓ → finishing song (progress) → ready; email fallback note                                                                                          |
| `SharePanel`        | delivery                                   | copy link, iMessage/WhatsApp/SMS intents, QR, "schedule for the day" (later)                                                                                |
| `GiftRevealPlayer`  | recipient `/play`                          | the gift-open: "Someone made you a song" → sender name → dim → play; claim CTA appears only after ≥1 full listen                                            |
| `ClaimCard`         | recipient `/play`                          | "Keep this song forever" → app store/OneLink handoff (existing receiver-handoff flow)                                                                       |

**Design QA gates (impeccable discipline, wired into the implementation plan):** contrast audit on every new token pair; the AI-slop test on landing + funnel ("could you guess this is the modal AI gift site?" must be _no_ — the dim is the answer); `audit` pass (a11y/perf/responsive) and `critique` pass before launch; screenshot-diff baselines for the five key screens.

### 2.3 UX considerations (cross-cutting)

- **One question per screen.** Funnel cognitive load stays near zero; each step is answerable in <10s. Progress is visible but never numbered like a form (no "step 3 of 9").
- **Never gate the preview behind an account.** Email is asked for exactly once, at checkout, where it's natural (receipt). Optional soft email capture on the preview screen ("save this song") for abandonment recovery — skippable, never blocking.
- **No autoplay, ever.** Play is always a deliberate tap (mobile browsers block autoplay with sound anyway; the tap is also the emotional beat).
- **The wait is content.** Lyrics materialize during generation — by the time the song is ready, the buyer has already read their memory turned into verse (investment escalates, abandonment drops).
- **Editing is reassurance, not homework.** Lyrics are shown as "here's her song — want to change anything?" with inline edit; the primary CTA approves implicitly ("Sounds right — let me hear it").
- **In-app browsers are the primary browser.** Most paid traffic opens in the TikTok/Instagram webview. Everything must work there: Stripe Checkout (works in webviews; Apple Pay may be absent → card fields always visible), no popups, no downloads, tap targets ≥44px. Test matrix includes TikTok iOS webview, IG iOS webview, Safari iOS, Chrome Android.
- **Mobile-first at 360px;** desktop is the enhancement (centered 480px funnel column, imagery breathes on the sides).
- **Recipient page is sacred** (PRODUCT.md principle 4): plays with zero friction, works on a 5-year-old Android browser, `<audio>` progressive MP3/M4A (no HLS dependency), lyrics visible, claim CTA only after the listen.
- **Performance budget:** funnel JS ≤ 150KB gz, LCP < 2.0s on 4G (ad traffic bounces fast), fonts preloaded + `font-display: swap`, audio preloaded during the offer step so the dim-scene starts instantly.
- **Accessibility:** WCAG 2.1 AA; keyboard-operable player; focus-visible rings (coral 50%); reduced-motion variants for all three named moves; lyrics double as captions.

---

## 3. Information architecture & user flows

### 3.1 Routes

| Route                                     | Register   | What                                                                                               |
| ----------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `/`                                       | brand      | Landing, re-pointed to storefront (hero CTA → `/create`; app download demoted to footer/secondary) |
| `/create`                                 | funnel SPA | Quiz → theater → preview → offer (client-routed steps, URL hash per step for resume/analytics)     |
| `/create/success`                         | funnel SPA | Post-checkout: order status → delivery (`?session_id=` from Stripe)                                |
| `/play/:shareId`                          | gift       | Existing public player page, upgraded with GiftRevealPlayer + web playback for gift shares         |
| `/gift/refund-policy`, updated `/legal/*` | static     | Commerce legal surface                                                                             |
| SEO pages (`/gifts/*`, occasion pages)    | brand      | CTA re-pointed: "Make their song — hear a preview free" → `/create?occasion=<slug>&utm…`           |

### 3.2 Buyer flow (happy path, step by step)

```
AD → /create?utm_…
 S0 Hook       "Who's this song for?" — single name field, zero chrome. (First
               input <5s from tap. Guest session created lazily on first submit.)
 S1 Relationship  ChoiceChips: Mum · Dad · Partner · Friend · Daughter/Son · Grandma/…· Someone else
 S2 Occasion   Chips incl. the verified truth: Just because / I love you · Birthday ·
               Anniversary · Thank you · Encouragement · Wedding · Missing you ·
               Mother's/Father's Day … + optional OccasionDate
 S3 Memory     MemoryField: "Tell us one real memory or what you'd say if it were
               easy." + optional "anything she always says?" (special_phrases)
 S4 Sound      Genre chips (from iOS style list) · mood · voice (male/female)
 S5 Theater    POST /tracks → version → lyrics/generate (streamed into the UI as
               they're written) → lyrics/approve → render_preview → poll /jobs/:id
               (60–90s; GenerationTheater; resume-safe)
 S6 Preview    LyricSheet + "Sounds right — hear it" → THE DIM → PreviewPlayer
               plays the chorus with her name. Replay free. Edit lyrics → regenerate
               path (guarded, see §9).
 S7 Offer      OfferCard: "Unlock the full song" — $19.99 gift bundle (full 60–90s
               song · lyric card · shareable video · lifetime link · plays anywhere).
               → Stripe Checkout (hosted; email + Apple Pay/GPay/card; Stripe Tax).
 S8 Success    /create/success: payment ✓ → "finishing her song" (render_full
               progress) → ready → SharePanel + "Your song also lives at this link
               / manage songs via the app or magic link".
 DELIVERY EMAIL  "Sarah's song is ready" → /play/:shareId + receipt.
```

**Resume paths:** every step persists to the guest session server-side (track row) + localStorage; returning within 7 days lands on the furthest step. Post-payment, everything is recoverable via the emailed magic link (account now exists with their email).

### 3.3 Recipient flow

```
Link/iMessage → /play/:shareId
 R0 Gift open   "Someone made you a song." → sender name + occasion, warm envelope
                moment (no spoilers: title/recipient name visible, lyrics hidden)
 R1 Listen      Tap play → THE DIM → GiftRevealPlayer, karaoke lyrics. Zero friction:
                no account, no app, any browser. Replays unlimited (lifetime link).
 R2 Keep        After ≥1 completed listen: ClaimCard "Keep this song forever — and
                make one back." → app store / OneLink (existing receiver-handoff
                attribution rh_… flow) → app claim (existing PIN/device binding).
 R3 Loop        In-app post-claim prompt (exists) → recipient becomes a creator.
```

Non-iOS recipient: R0–R1 identical (web playback), R2 shows "Get the app" (Android: waitlist/Play link when Skip build ships) + "or keep this link — it never expires."

### 3.4 Key states per screen (shape-discipline: every state designed, not defaulted)

| Screen     | States                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0–S4 quiz | default · typed/selected · validation (name required, memory ≥ 20 chars nudge — soft, never blocking beyond name) · restored-from-resume banner · moderation-blocked (warm copy: "we couldn't use part of that — try rephrasing", field-level) · rate-limited (rare; "give us a minute")                                                          |
| S5 theater | writing → lyrics-streaming → arranging → singing (staged) · slow (>2.5min: "taking longer than usual — stay or we can hold your place" + soft email capture) · failed (auto-retry ×1 silent, then warm error + retry CTA; no dead ends) · resumed (refresh mid-render re-attaches to job poll)                                                    |
| S6 preview | dim/playing · paused · replay · lyrics-edit mode · regenerate-pending · preview-cap-reached (2 free previews/guest: "you've heard two versions free — unlock to keep tuning")                                                                                                                                                                     |
| S7 offer   | default · returning-visitor (has un-purchased preview: "your song for Sarah is still here") · checkout-error/cancelled (return with state intact, "nothing was charged")                                                                                                                                                                          |
| S8 success | paid+rendering (progress) · ready (SharePanel) · render-taking-long (">3 min: we'll email you the moment it's ready" — email already captured) · render-failed (auto-retry ×3 → automatic refund + apology email; page shows the same honestly) · webhook-delayed (page polls order endpoint; "confirming payment…" ≤60s before support fallback) |
| /play gift | unopened · playing (dim) · listened (claim CTA) · claimed-elsewhere (still plays on web — lifetime; claim CTA becomes "already saved in the app") · revoked/refunded (warm unavailable page, no error jargon) · crawler (OG tags — already implemented server-side)                                                                               |

---

## 4. Offer & pricing

- **Launch offer:** Gift Bundle — full song (60–90s) + lyric card image + shareable video + lifetime play link. **$19.99 anchor, $14.99 launch test** (A/B via Stripe Prices; the repositioning doc's Etsy wedge test informs the winner). Currency handled by Stripe (Checkout localizes); page shows localized price via `/web/products` endpoint.
- **Guarantee:** "If it doesn't make them feel something, we'll refund it." (Refund automation exists for render failures; discretionary refunds via admin.)
- **App IAP untouched** at launch (different SKU: in-app song credits vs web gift bundle). No links from the iOS app to web checkout (avoids anti-steering review risk); the web never mentions in-app pricing.
- Two free preview generations per guest (see abuse §8); further tuning is post-purchase (full render params) or app territory.

---

## 5. Technical architecture

### 5.1 Shape

```
porizo.co (existing single Railway Fastify service — same origin, NO CORS needed)
├── public/…                     existing marketing + SEO pages (CTAs re-pointed)
├── /create  → web-funnel/dist   NEW Vite + React + TS SPA, mounted via @fastify/static
│                                (precedent: /web-player, /poem-viewer, /embed-player
│                                 mounts in src/plugins/http-bootstrap.js:36-83)
├── /api (existing routes)       tracks/lyrics/render/jobs/share — reused as-is
├── /web/* (NEW routes)          guest session · products · checkout · order status · Stripe webhook
└── worker (existing service)    render pipeline unchanged
```

**Why same-origin SPA (decision):** porizo.co already IS the API service (verified: the landing page is served by it), so mounting the funnel on the same origin eliminates the two integration land-mines the scouts found — the hard CORS allowlist (`CORS_ORIGIN`, boot-blocking, `src/plugins/http-bootstrap.js:95-99`) and the magic-link cookie origin scoping (`MAGIC_LOGIN_WEB_ORIGIN`, default auth.porizo.co). ⚠ VERIFY `MAGIC_LOGIN_WEB_ORIGIN` needs `https://porizo.co` set for post-purchase magic-link management pages. Why Vite+React: multi-step state machine + player + streaming lyrics warrant a real component model; team already ships React (Remotion, screenshot generator); built output is static files — no new deployment surface.

### 5.2 Identity: ONE account across web and app (extends the rebuilt magic-link system)

**Principle (per Ambrose, 2026-07-14): one login, one account, every surface.** The recently rebuilt magic-link account system is the identity backbone — the web does not get a parallel account system. The web variant already exists in that rebuild: `POST /auth/magic/request` (`platform:"web"`) → emailed link → `/auth/magic/exchange` → `__Host-porizo_session` cookie + `GET /auth/web/session` (`src/routes/auth.js:600–1193`). We extend it, we don't duplicate it.

- **Same `users` row everywhere.** A song bought on the web appears in the iOS app the moment the buyer signs in with the same email (same `user_id`, `track_library_entries` already written at track creation) — and vice versa. No sync layer; it's one account by construction.
- **Web sign-in** = the existing magic-link web flow, surfaced on `/create` ("Been here before? Sign in") and `/play` pages. Config: `MAGIC_LOGIN_WEB_ORIGIN` must include `https://porizo.co` (currently defaults to auth.porizo.co — env change ⚠ VERIFY).
- **Session→token bridge (small new endpoint):** existing API routes are Bearer-JWT only (`requireUserId`), while web login yields the `__Host-porizo_session` cookie. Add `POST /auth/web/token` — same-origin + CSRF-checked, exchanges a valid web session cookie for the standard short-lived access JWT (existing session infra; no new token semantics). The SPA then calls `/tracks` etc. exactly like the iOS app does.
- **Guest sessions are a bridge, not an account system:** `POST /web/session` (Turnstile-verified, IP-rate-limited) creates a real `users` row with `account_status='guest'` + standard JWT pair, so the anonymous funnel reuses every existing endpoint unchanged. Guests get zero song entitlements (deferred-spend preview path below; no `createFreeEntitlements` → no Sybil-gate interaction).
- **Convergence at purchase (guest → magic-link account):** Stripe Checkout returns the buyer email →
  - email is new: attach to the guest user via the same `user_contacts` path magic login uses (`source='stripe_checkout'` — **requires the CHECK-constraint migration; this exact constraint broke prod signups once**), set `account_status='active'`, and send the delivery email whose "manage your songs" link IS a magic-link sign-in — clicking it verifies email ownership and establishes the session. Email is **not** marked verified from Stripe alone (buyers can typo/enter someone else's address; the magic link is the verification event).
  - email belongs to an **existing account** (e.g., an iOS user buying on web): merge guest → existing atomically per the 9-table song-transfer checklist (tracks.user_id, track_library_entries, share_tokens.creator_id, audit_logs, entitlements; jobs need nothing) — single transaction, tested. The purchase lands in their one account; the app shows it on next open.
  - signed-in buyer (web session already present): no guest involved — checkout runs against their account directly.
- Guest GC: cron deletes guest users with no purchase + no activity > 30 days (existing deletion machinery; audit-safe).

### 5.3 Free preview without burning a song credit (server change, feature-flagged)

Today `render_preview` **spends** 1 song entitlement at start (`src/routes/tracks.js:900` → `consumeSongEntitlementInTransaction`, idempotent per version via `song_entitlement_consumed_at`) and `render_full` reuses that spend. The funnel needs the inverse: free preview, paid full.

**Change:** in `render_preview`, when `user.account_status === 'guest'` and flag `web_funnel_enabled` is on → **skip the entitlement spend** (deferred). `render_full` already "spends fresh if not consumed on this version" (verified `tracks.js:1121` path) — so the paid step naturally charges the gift-wallet token granted by Stripe. No change to `render_full` needed. Guardrails in §8.

### 5.4 Payments (greenfield — zero Stripe code exists in `src/`)

- **Stripe Checkout (hosted)** for MVP: Apple Pay/GPay/card + Stripe Tax + email collection + consent collection (marketing opt-in) with zero PCI surface. Payment Element embed is a later optimization (in-context checkout for the TikTok webview).
- New table `web_products(id, stripe_price_id UNIQUE, token_count, display_name, active)` — deliberately mirrors `gift_bundles` (migration `060_gift_bundles.sql`) so grant logic is shared.
- `POST /web/checkout` (auth: guest/user JWT): body `{track_id, track_version_id, price_key}` → creates `web_orders` row (`status='pending'`, unique `checkout_session_id`) → returns Checkout URL. `success_url=/create/success?session_id={CHECKOUT_SESSION_ID}`, `cancel_url` returns to S7 with state intact. Metadata carries `user_id, track_id, track_version_id, order_id`.
- `POST /web/webhooks/stripe` (raw-body signature verification): `checkout.session.completed` → idempotent by `checkout_session_id` → in one transaction: mark order `paid`, grant 1 token via `applyGiftWalletTransaction` (`src/routes/billing.js` helper, `source='stripe_checkout'`), upgrade/merge user (§5.2) → then kick the **post-payment orchestrator** (§5.5). Also handle: `checkout.session.expired` (mark abandoned), `charge.refunded` (mark refunded, revoke gift share), `charge.dispute.created` (flag user, revoke share, admin alert).
- **Reconciliation:** success page polls `GET /web/orders/:sessionId`; that endpoint, on `pending` + user-present, does a direct Stripe `checkout.sessions.retrieve` as webhook fallback (webhooks get lost). Plus a 15-min cron sweeping `pending` orders > 10 min old.

### 5.5 Post-payment orchestration (server-side, never trusts the client to finish)

On order `paid`: (1) `render_full` on the purchased version (spends the granted token; the existing job pipeline handles it — `src/workflows/runner.js`); (2) on full-ready: create share token via the existing service (`createOrGetShareToken`, `src/services/share-service.js:89`) with `share_type='gift'`, `claim_pin` disabled by default (buyer can enable later), UTM columns populated from the order; (3) send delivery email (`sendGiftDeliveryEmail` exists in `src/services/email-service.js`) + receipt; (4) mark order `delivered`. Steps are idempotent + resumable (order status is the state machine: `paid → rendering → delivered | failed → refunded`).

**Render-failure refunds (closes the no-refund gap the scout confirmed):** full render failed after pipeline retries → orchestrator retries render ×2 more → still failed: automatic Stripe refund, order `refunded`, apology email, admin alert. A paid customer must never need a support ticket to get their money back.

### 5.6 Web playback for gift shares (server change)

Today a plain browser gets 403 `APP_REQUIRED` on share audio (`rejectBrowserAppOnly`, `src/routes/sharing.js:2190` — only `share_type='demo'` or app-context headers pass). **Change:** shares with `share_type='gift'` (and later, any share the creator marks web-playable) pass the gate; `/play/:shareId` (already a full public HTML player page, `sharing.js:834`) gets the GiftRevealPlayer treatment. App-created "normal" shares keep current app-only behavior — the device-binding work stays intact; unification is a separate later decision. Funnel previews (pre-purchase) need no share at all: `GET /preview/:trackVersionId.m4a` is already public-by-UUID (`src/server.js:2305`).

### 5.7 New/changed surface summary

| Item                                         | Type                               | Notes                                                                                                                          |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /web/session`                          | new route                          | Turnstile + IP limits → guest user + JWT                                                                                       |
| `POST /auth/web/token`                       | new route                          | web-session cookie → access JWT (one-account bridge, CSRF-checked)                                                             |
| `GET /web/products`                          | new route                          | localized price display                                                                                                        |
| `POST /web/checkout`                         | new route                          | Stripe Checkout session                                                                                                        |
| `GET /web/orders/:sessionId`                 | new route                          | success-page poll + webhook fallback                                                                                           |
| `POST /web/webhooks/stripe`                  | new route                          | raw body, signature-verified, idempotent                                                                                       |
| `users.account_status`                       | migration                          | guest / active values (⚠ VERIFY existing column/values)                                                                        |
| `web_orders`, `web_products`                 | migration                          | order state machine + catalog                                                                                                  |
| `user_contacts` CHECK += `'stripe_checkout'` | migration                          | the magic-link-breaker lesson                                                                                                  |
| `share_tokens.share_type` += `'gift'`        | migration ⚠ VERIFY if CHECK exists |                                                                                                                                |
| `render_preview` deferred spend for guests   | code change                        | flag `web_funnel_enabled`                                                                                                      |
| `rejectBrowserAppOnly` gift pass             | code change                        | `sharing.js:2190`                                                                                                              |
| IP-keyed rate limits                         | code change                        | wire the existing-but-unused `ip:` primitive (`src/database/rate-limit-repository.js:3-21`)                                    |
| `web-funnel/` SPA + static mount             | new frontend                       | `http-bootstrap.js` pattern                                                                                                    |
| Env vars                                     | ops                                | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `WEB_FUNNEL_*` flags/budgets; `MAGIC_LOGIN_WEB_ORIGIN` check |

Integration reuse (zero change): `POST /tracks` Path-A fields (recipient_name, occasion, message, specific_memory, special_phrases, memory_answers…) → versions → `lyrics/generate` → `lyrics/approve` → `render_preview` → `GET /jobs/:id` poll → `preview_url` on the version → `render_full` → share. Moderation runs at track-create and lyrics-approve — always **before** money (verified gate order).

---

## 6. Analytics & attribution

- Funnel events via existing `POST /analytics/event`: `funnel_view, step_completed(step), preview_requested, preview_played, preview_completed, lyrics_edited, offer_viewed, checkout_started, purchase_completed(value), share_link_copied, gift_played, gift_listened_full, claim_cta_tapped` — each with guest/user id + UTM.
- **Meta Pixel already installed on porizo.co** (dataset 36564205179837496) → add standard events (`ViewContent`, `InitiateCheckout`, `Purchase` w/ value). Add **Meta CAPI server-side** `Purchase` from the webhook (webview pixel loss is severe in TikTok/IG browsers; server events are the reliable signal ads optimize on). TikTok pixel + Events API same pattern when TikTok spend starts.
- UTM: land → persist on guest session → stamp `web_orders` + `share_tokens` (columns already exist, migration 028).
- Weekly readout joins: spend (channel) → funnel steps → orders → recipient plays → claims (extends the existing measurement loop).

---

## 7. Legal & compliance

- Refund policy page (the guarantee + automatic-refund-on-failure), linked from OfferCard + receipt.
- Stripe Tax for sales tax/VAT; Stripe consent-collection checkbox for marketing email (Resend list only gets opted-in buyers).
- Privacy policy update: web orders, guest sessions, pixels/CAPI disclosure; cookie notice for pixel jurisdictions.
- Content: existing moderation gates unchanged; gift shares inherit takedown/revoke via share status.
- No voice-clone claims anywhere (standing constraint); no "in your voice" copy.

---

## 8. Abuse, cost & failure containment

Each free preview costs real money (~$0.07–0.15 provider spend). Controls, layered:

1. Turnstile on guest-session creation (invisible mode; hard mode on elevated risk).
2. IP-keyed limits (new wiring, existing primitive): guest sessions ≤ 5/day/IP, previews ≤ 10/day/IP; datacenter-ASN block list optional later.
3. Per-guest caps: 2 preview generations, 3 lyric regenerations; then the offer ("unlock to keep tuning").
4. Device continuity cookie; same device+IP re-creating guests inherits the caps.
5. **Global daily budget breaker:** `web_funnel_daily_preview_budget` flag (count or $) — trip → funnel switches to "leave your email, we'll hold your place" mode + admin alert. The funnel can never silently burn unbounded provider spend.
6. Provider failure ≠ user retry storm: theater auto-retry is capped; job-level retries are the pipeline's existing policy.
7. Stripe Radar defaults + dispute webhook → share revoke + user flag.

---

## 9. Pressure test — edge-case matrix

| #   | Case                                               | Handling (spec'd above)                                                                                                                                                            |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lyrics generation 422 (quality/fidelity low)       | Theater catches → "give us one more detail" micro-step feeding `add-details` fields → regenerate (counts against cap)                                                              |
| 2   | Moderation block at track create                   | Field-level warm error pre-spend, pre-payment; nothing charged ever                                                                                                                |
| 3   | Preview job fails                                  | Silent auto-retry ×1 → warm retry CTA; cap guards cost                                                                                                                             |
| 4   | **Payment succeeded, full render fails**           | Orchestrator retries ×2 → automatic Stripe refund + apology email + admin alert. Order state machine owns it                                                                       |
| 5   | Webhook lost/delayed                               | Success page polls order endpoint which falls back to direct Stripe session retrieve; 15-min reconciliation cron                                                                   |
| 6   | Double webhook / replay                            | Idempotent by unique `checkout_session_id`; grant + render kicked once                                                                                                             |
| 7   | User pays twice for same version (two tabs)        | Checkout creation reuses open `pending` order per (user, version); Stripe session reused or superseded                                                                             |
| 8   | Guest cookie/localStorage lost mid-funnel          | Server-side state on guest user + resume; post-payment always recoverable via email magic link                                                                                     |
| 9   | Safari ITP / private browsing                      | Token in memory+cookie fallback; worst case: quiz restarts (pre-investment loss only)                                                                                              |
| 10  | Buyer email = existing account                     | Atomic guest→existing merge per 9-table transfer checklist; buyer's app shows the song                                                                                             |
| 11  | Buyer closes tab during render (post-pay)          | Orchestration is server-side; delivery email arrives regardless                                                                                                                    |
| 12  | TikTok/IG in-app browser                           | Same-origin, no popups; Stripe Checkout redirect works in webviews; Apple Pay absent → card visible; explicit webview test matrix                                                  |
| 13  | Autoplay restrictions                              | No autoplay by design; audio element unlocked by the play tap                                                                                                                      |
| 14  | Recipient link forwarded before intended recipient | Web play is open by design (lifetime links, teaser philosophy); app _claim_ remains first-to-claim + optional PIN — binding integrity unchanged                                    |
| 15  | Recipient on Android/desktop                       | Full web playback; claim CTA becomes app-waitlist/Play link; link never expires                                                                                                    |
| 16  | Refund/chargeback after delivery                   | Share flips to warm unavailable page; user flagged; dispute evidence = delivery + play logs (share_access_log)                                                                     |
| 17  | Preview URL scraping/sharing                       | Unguessable UUID (existing posture); previews are watermark-candidates later; only chorus-length                                                                                   |
| 18  | Bot floods quiz (LLM cost)                         | Turnstile + IP caps + budget breaker (§8); lyrics generation is also per-guest capped                                                                                              |
| 19  | Render > 3 min post-payment                        | Success page sets expectation + email fallback (email guaranteed present post-pay)                                                                                                 |
| 20  | Render > 2.5 min pre-payment                       | Theater "hold your place" soft email capture; job continues; return link                                                                                                           |
| 21  | Stripe Checkout abandoned                          | `checkout.session.expired` → order `abandoned`; S7 restores; (opted-in emails only) recovery email later                                                                           |
| 22  | Price/App Store conflict                           | Different SKUs, no cross-referencing, no in-app links to web checkout (anti-steering posture)                                                                                      |
| 23  | `PREVIEW_ONLY` app-config flag on                  | Orchestrator checks before checkout is offered; funnel hides offer if full renders are disabled (never sell what can't render)                                                     |
| 24  | Concurrent flag flip mid-funnel                    | Session-start snapshot of flags; in-flight guests finish under entry rules                                                                                                         |
| 25  | XSS via memory/lyrics text                         | Lyrics/user text rendered as text nodes (React default) server pages already template-escape (⚠ VERIFY `/play` template escaping of title/names — `sharing.js:834` path)           |
| 26  | GDPR delete request from buyer                     | Existing account-deletion machinery covers upgraded users; guest GC covers the rest; Stripe retains its own records                                                                |
| 27  | Buyer enters an email they don't own at checkout   | Email attached but NOT auto-verified; account claimable only via magic link to that inbox (verification event); merge into an existing account keys on verified-contact match only |
| 28  | One person, two emails → two accounts risk         | Delivery email prompts sign-in with the purchase email (converges identity); admin merge as backstop; unavoidable residual if they insist on different emails                      |

---

## 10. Open decisions (deliberately deferred, with defaults)

1. **Launch price** $14.99 vs $19.99 — default: A/B from day one; Etsy wedge test may pre-answer.
2. **Scheduled delivery** ("send it on her birthday") — v1.1; `dispatch_at` column already exists on share_tokens.
3. **Lyric-card + video assets in bundle** — v1 ships lyric card (cover-generator exists: `src/services/cover-generator.js`) and share.mp4 (exists: `/share/:shareId/share.mp4`); "video" in offer copy must match what ships.
4. **Unifying app-share web playback** (all shares web-play-first) — after gift shares prove out; product decision with device-binding implications.
5. **Display font evolution** (§2.2 call-out) — post-launch brand pass.
