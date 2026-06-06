# Porizo Recovery Plan — Issues + Implementation Plans

**Date:** 2026-06-03 · Owner: Ambrose · Status: DRAFT (pending review)
**Basis:** Merged, cross-examined diagnosis (Claude funnel data + Codex store-page/voice findings). Companion to `why-porizo-failed-diagnosis-2026-06.md` and `porizo-revision-action-plan-2026-06.md`.

## Verified evidence baseline (so plans target real problems)

- 54 total users (Jan 24–Jun 1); **~26 genuine** (founder = 184 tracks/63 shares).
- Activation works: 24 non-founder users made ≥1 track; 68 full renders; events show 219 render-starts, 187 render-ready.
- Repeat: only 6 non-founder users made ≥2 tracks — **untestable at this n** (not a proven retention failure).
- Monetization: ~1 external subscriber (expired Jun 1) + gift_purchase across ≤4 users; recorded revenue ≈ $0.
- Viral loop: 39 receiver sessions, 26 completions, **26 CTA views → 1 click → 0 registrations**.
- Voice moat: tracks `ai_voice 185 / user_voice 57`; only **3 active voice profiles**.
- App Store (live, Apple lookup v1.5.14): **0 iPhone screenshots**, 5 iPad, **1 rating**.
- Paid: ~$133 total → ~15 installs; broad/Painkiller wasted, exact gift/seasonal converted.
- **Data caveat:** `daily_aggregates` rollup is broken (renders/shares/subs = 0 vs live events) — do not trust it; use `events`/`users`/`tracks`/`receiver_sessions`.

**Thesis (settled):** Primary failure = **distribution** — almost no traffic reached real users, and the little that did hit weak conversion surfaces (broken iPhone store page, non-converting recipient loop, hidden voice moat). Subscription mismatch & retention are real but **secondary / unproven at this volume**.

---

## Priority map

| P   | Issue                           | Why now                      | Cost |
| --- | ------------------------------- | ---------------------------- | ---- |
| P0  | 1. iPhone App Store page broken | Live conversion killer; free | XS   |
| P0  | 2. Recipient loop converts ~0   | Cheapest growth engine, off  | S    |
| P1  | 3. Marketing channels unshipped | Assets exist, undeployed     | S    |
| P1  | 4. Paid bought wrong demand     | Wastes scarce budget         | XS   |
| P1  | 5. Voice moat hidden/diluted    | Kills differentiation        | M    |
| P1  | 6. Monetization mismatch        | Caps LTV; infra exists       | M    |
| P2  | 7. No repeat/occasion loop      | Only honest retention path   | M    |
| P2  | 8. No song-quality signal       | Flying blind on quality      | S    |
| P2  | 9. Broken analytics rollup      | Can't measure funnel         | S    |

---

## P0 — Conversion surfaces

### Issue 1 — Live iPhone App Store page is broken

**Problem:** Apple lookup (v1.5.14) returns **0 iPhone screenshots** (5 iPad only) and **1 rating**. iPhone visitors see nothing → ~87% bounce (ASA 119 taps → 15 installs = 12.6% vs ~50% norm).
**Success metric:** ≥5 iPhone 6.9" screenshots live (only **5 assets exist** today — add a 6th if desired); tap→install ≥ 35%; ratings ≥ 10.
**Implementation:**

1. **Confirm v1.5.14 is "Ready for Sale"** first — screenshot-only edits to a live version are approved without binary review; any other state blocks this.
2. Confirm assets at `marketing/appstore/screenshots/current/6.9/` — **5 PNGs present** (hero/pick/tell/hear/share); verify 6.9" spec (1320×2868 / no alpha).
3. Upload via `asc` CLI (App ID `6758205028`) to the **live** version's iPhone display set; re-validate listing.
4. Verify post-publish via `curl "https://itunes.apple.com/lookup?id=6758205028&country=us"` → `screenshotUrls` length ≥ 5. **This is the proof gate.**
5. Audit promo text / release notes for stale dates (US Father's Day 2026 = **June 21**) in `marketing/appstore/metadata/`.
6. First screenshot must carry a one-line hook caption (gift framing).
   **Files/tools:** `asc` CLI; `marketing/appstore/screenshots/current/6.9/`, `marketing/appstore/metadata/`.
   **Effort:** XS (hours). **Risk:** screenshots may have been uploaded to a draft/other locale, not live — confirm which version is live first.

### Issue 2 — Recipient (viral) loop converts ~0

**Problem:** Loop is implemented (web player post-play/teaser/app-bar CTAs + iOS claim view) but the **offer is wrong** ("Save this song in Porizo"). 26 CTA views → 1 click → 0 registrations. iOS `ShareClaimView` "Make one for someone you love" is non-interactive text.
**Success metric:** recipient CTA click-rate ≥ 15%; ≥1 recipient→registration per ~20 sessions (matched_user_id > 0).
**Implementation:**

1. Replace offer copy everywhere: "Save this song" → **"Make one back"** / "Reply with a song" / "Create one for someone you love."
2. iOS `ShareClaimView.swift` **line 209** (`pinEntryView` state): the `Text("Make one for someone you love →")` is non-interactive — make it a real Button → deep-link into create, pre-seeded with sender as recipient. **Gap:** the `previewClaimable`/`previewReadOnly` states (WKWebView) have **no "make one" CTA at all** — decide whether to add one or rely on the web player CTA.
3. Web player `web-player/index.html`: change copy at **line 140** (teaser) and **line 289** (post-play) from "Save this song in Porizo" → "Make one back"; CTA → App Store.
4. **Attribution is the real blocker, not copy.** Smart App Banner at `web-player/index.html:39` passes no `app-argument`, so `receiver_session_id` cannot survive the App Store install → `matched_user_id` stays 0 regardless of copy. Ship copy change FIRST (independently measurable by click-rate), then wire **deferred deep linking** (AppsFlyer DDL/Branch) as a separate workstream.
5. Pre-fill the new creator's flow ("make one back for [sender]") to remove cold-start.
   **Files:** `PorizoApp/PorizoApp/ShareClaimView.swift:209`; `src/routes/sharing.js`; `web-player/index.html` (lines 39, 140, 289); `receiver_sessions` attribution.
   **Effort:** copy change S (~hours); attribution wiring M (separate). **Risk:** without deferred deep linking, recipient→registration attribution stays 0 — but click-rate lift is still real and measurable.

---

## P1 — Distribution & monetization

### Issue 3 — Marketing channels built but never shipped

**Problem:** ~95% of designed at-bats untaken: Reddit 0/8 drafts, creators 0 DMs, TikTok 1 video, cold email 8% of 4,431.
**Success metric:** 4 channels live with tracked output for 14 consecutive days; first attributed organic installs > 0.
**Implementation:**

1. Reddit: publish the 8 ready drafts on a schedule; founder-story angle; reply templates.
2. Creators: send outreach via **email/IG** (TikTok DM blocked); rank by median views; track in `marketing_contacts`/tracker.
3. Short-form: post the rendered Father's Day Reels + a posting cadence (repurpose Remotion outputs).
4. Cold email: resume send (current `next_index: 340` of 4,431) at 80/day; wire open/click tracking.
   **Files:** `marketing/` (drafts, channels), `scripts/` email runner, `cold_email_*` tables.
   **Effort:** S (mostly execution). **Risk:** silent-failure pattern repeats (templates were once `.railwayignore`-excluded). **Pre-clear, as checkable items:** (a) cold-email templates included in Railway deploy (`.railwayignore` whitelist), (b) daily send job scheduled/triggered in prod, (c) open/click webhook endpoints wired.

### Issue 4 — Paid bought the wrong demand

**Problem:** Broad/"Painkiller" lanes wasted ($34.90 → 0); exact gift/seasonal converted (mother's day song, gift song, birthday gift).
**Success metric:** blended paid CPI ≤ $5 on retained keywords; 0 spend on 0-install broad terms.
**Implementation:**

1. Pause broad/Painkiller/AI-generator lanes in ASA; keep only exact high-intent gift/seasonal.
2. Add purchase/completion-based kill-gates (auto-pause keyword at $X spend / 0 installs).
3. Concentrate budget on gift-season peaks; trim flat year-round spend.
4. Meta: hold at current test; judge after video delivers (separate analyzer).
   **Files:** `scripts/aso/` (rerank/apply), `scripts/ads/`.
   **Effort:** XS. **Risk:** seasonal demand is thin — paid alone won't scale; pair with organic.

### Issue 5 — Stop promising "your voice" (tech not ready) + reposition

**CORRECTION (Ambrose, 2026-06-03):** Porizo **cannot do voice cloning yet** — the tech isn't available. The earlier "hidden moat / commit-or-drop" framing is void. This is now a **risk-removal + repositioning** task, not a moat decision.
**Problem:** Any "in your voice / sing in your voice / voice clone" copy on the store or in marketing is a **false promise** → trust damage + App Store rejection risk + wrong user expectations. Competitor AI Singer already owns the "your voice" claim.
**Success metric:** zero "your voice" promises live; positioning shifted to **speed + price + emotion** ("the $200, 7-day Songfinch gift — instantly, ~$9").
**Implementation:**

1. Audit + remove all voice-cloning claims from App Store metadata, web, and ad copy (`marketing/appstore/metadata/`, marketing assets).
2. Reposition messaging around instant emotional gifting + the price/speed gap vs Songfinch/Songlorious (see `porizo-growth-playbook-2026-06.md` §0, §2).
3. Keep AI-voice as the (only) delivery; do not surface "My Voice" selection or enrollment until the tech exists.
   **Files:** `marketing/appstore/metadata/`, marketing copy; `VoiceModeSelectionView.swift` / `WarmCanvasFlowView.swift` (ensure "My Voice" isn't promised/exposed).
   **Effort:** S (mostly copy). **Risk:** if any live screenshot/subtitle implies voice cloning, it's a latent rejection trigger — fix with the Issue 1 screenshot pass.

### Issue 6 — Monetization mismatch (subscription on a one-off gift)

**Problem:** Occasion gift sold as subscription; 1 sub churned after a month. Transactional peers profit; sub peers sell habitual creation.
**Success metric:** one-off gift purchase = primary CTA; ≥X one-off purchases/week; sub framed as optional.
**Implementation:**

1. Make **one-off gift tokens/bundles the primary purchase** — infra already exists (`gift_bundles`, `gift_orders`, `gift_wallet`, `song_transactions`). Re-prioritize, not rebuild.
2. Reframe paywall: lead with "buy this gift" ($5–$25); subscription = secondary "creator" tier.
3. Optional premium "human-polished" tier (Songfinch model) for high-intent buyers.
   **Files:** `StoreKitManager.swift`, `subscription-manager.js`, paywall screens, gift infra in `migrations/pg/056_gift_scheduling_and_wallet.sql` + `085_gift_order_recipient_name.sql` (`gift_bundles`/`gift_orders`/`gift_wallet`). _(Note: `plan_products` does not exist in the schema — removed.)_
   **Effort:** M. **Risk:** App Store IAP product config + review; pilot before full cutover.

---

## P2 — Retention & instrumentation

### Issue 7 — No repeat/occasion loop

**Problem:** No reminders, no saved recipients, no "next gift" nudge. `LocalNotificationService` only fires render-complete.
**Success metric:** ≥X% of buyers set a saved recipient/occasion; reminder→return rate measurable.
**Implementation:** saved recipients model; birthday/anniversary reminders (local + push); "next occasion" prompts post-gift; re-engagement push.
**Files:** new recipients model; `LocalNotificationService.swift`; push infra (`devices`, OneSignal).
**Effort:** M. **Risk:** retention is structurally capped for gifts — set realistic targets; don't over-invest before acquisition works.

### Issue 8 — No song-quality / feedback signal

**Problem:** No rating/feedback mechanism in schema; quality unmeasured (residual unknown in diagnosis).
**Success metric:** ≥60% of finished songs get a rating; quality baseline established.
**Implementation:** post-song "how did this turn out?" prompt (👍/👎 + optional note); store as event/table; gate App Store review prompt on positive rating.
**Files:** create-flow completion screen; new `song_feedback` event/table; review-prompt logic.
**Effort:** S. **Risk:** prompt fatigue — the web player **already has a `rating-cta` overlay** (`web-player/index.html:300` "Loved this song? / Rate Porizo") that fires after the post-play CTA. Map the existing overlay chain (post-play → rating-cta) before adding another layer or you triple-prompt the same user. Single, well-timed ask.

### Issue 9 — Broken analytics rollup

**Problem:** `daily_aggregates` renders/shares/subs/DAU = 0 while `events` shows real activity. Funnel is partly unobservable.
**Root cause (verified):** `src/jobs/compute-daily-aggregates.js` uses **SQLite `?` placeholders, never ported to PostgreSQL** (`$1,$2`), so every date-filtered metric silently returns 0 in prod. It's an on-demand admin-triggered job, not a daemon. (Also verify `subscriptions`/`credit_transactions` tables exist in prod — only fragments found in `migrations/pg/016–018`.)
**Two SEPARATE problems — split:**

- **9a. Fix the rollup:** rewrite `compute-daily-aggregates.js` to PG placeholders, OR rebuild the funnel as SQL views over `events`/`users`/`tracks`/`receiver_sessions`; backfill. **Effort: M** (not S — it's a port, not a cron).
- **9b. Restore ASC analytics access:** App Store Connect permission/API setup — different owner, different path. **Effort: S.**
  **Files:** `src/jobs/compute-daily-aggregates.js`; `events` views.

---

## Suggested sequencing

- **This week (P0 + measurement):** Issue 1 (screenshots) + Issue 2 (recipient offer copy) + Issue 8 (feedback prompt) + **Issue 9a (fix the rollup) — promoted into this sprint**: P1 metrics (paid CPI, organic installs, recipient click-rate) are unmeasurable until the funnel is fixed. Run P1 blind otherwise.
- **Next (P1 distribution):** Issue 3 + Issue 4 in parallel with P0.
- **Then (P1 structural):** Issue 5 reposition (remove voice claims) → Issue 6 transactional pivot. Issue 2 attribution wiring (deferred deep link) here.
- **Later (P2):** Issue 7 after acquisition shows life; Issue 9b (ASC access) when convenient.

> **See `porizo-growth-playbook-2026-06.md`** for the viral-loop redesign, the recent-winners gap list (reaction-reveal UGC + micro-creator seeding + Spark Ads), and the gift-bundle one-off test — the offensive plays that complement these defensive fixes.

## Open decisions for Ambrose (block some plans)

1. ~~Voice moat: Option A or B?~~ **RESOLVED:** voice tech not ready → remove all voice promises, reposition on speed+price+emotion (Issue 5).
2. **Confirm: make one-off gift bundles the primary purchase** (Ambrose: yes, wants to try — infra exists, untried). Pricing to test: single ~$7–12 + 3-pack anchor ~$15–20.
3. **Approve standing up the reaction-reveal UGC + micro-creator seeding engine** (the #1 thing winners do that we don't).
