# Porizo Revision Action Plan — Merged Diagnosis (Claude + Codex)

**Date:** 2026-06-03 · Companion to `why-porizo-failed-diagnosis-2026-06.md`.
Merges the DB-verified distribution thesis with Codex's store-page + voice-moat findings, after cross-examining both against production data and the live Apple listing.

---

## The merged thesis (what survived cross-examination)

Porizo's failure is **dominantly a distribution failure** (proven by funnel data: ~26 genuine users, 1 churned payer in 98+ days), now sharpened by two findings Codex surfaced and I verified:

**PROVEN PRIMARY causes**

1. **Channels were built but never shipped** — ~$133 paid → ~15 installs; Reddit 0/8, creators 0 DMs, TikTok 1 video, cold email 8% of list. ~95% of designed at-bats untaken.
2. **The viral loop is dead** — 39 song recipients → 39 listened → **0 registered**. The recipient "Make one for someone you love" is dead text; no referral, no recipient→creator path.
3. **The App Store page is broken for iPhone (NEW, verified)** — live US listing (v1.5.14) has **0 iPhone screenshots** (5 iPad only) and **1 rating**. Result: ASA bought 119 taps → only **15 installs (12.6% tap→install vs ~50% norm)**. Of the few who arrived, most bounced on a blank page.

**STRATEGIC / STRUCTURAL (real, but secondary or unproven at n≈26)** 4. **The "your voice" moat is bypassed** — first song silently defaults to AI voice (`WarmCanvasFlowView.swift:1640-1647`); only **3 active voice profiles** exist. Porizo collapses into a generic AI song maker where Suno-scale apps win on trust/awareness. 5. **Monetization mismatch** — a one-off gift sold as a subscription. The infra to fix this **already exists** (`gift_bundles`, `gift_orders`, `gift_wallet`, `song_transactions`) — it's a re-prioritization, not a rebuild. 6. **Commoditization** — bare mechanic already cloned (GiftSong, $4.99/wk).

**RESIDUAL UNKNOWN** — song emotional quality: **no rating/feedback mechanism exists**, so quality is unmeasured. Must instrument.

**Refuted Codex claims:** "no free preview / straight to full render" (DB shows 114 previews); business-model mismatch as the _primary_ cause (DB shows acquisition volume is the binding constraint, not packaging).

---

## Actionable revision list (prioritized by impact × proven × cost)

### WEEK 1 — Free, proven, do immediately (stop the bleeding)

- [ ] **Upload iPhone screenshots to the live listing.** They already exist (`marketing/appstore/screenshots/current/6.9/`). 0 iPhone screenshots is live RIGHT NOW — every iPhone visitor sees nothing. Single highest-ROI action. Verify first screenshot has a hook caption.
- [ ] **Fix listing consistency:** confirm Father's Day date (US 2026 = **June 21**), ensure "preview free" claim matches flow, app subtitle/positioning consistent.
- [ ] **Get off 1 rating:** in-app review prompt for delighted users + personally ask your ~26 existing users + the churned payer. Social proof is conversion oxygen.
- [ ] **Repair the viral loop:** make recipient "Make one for someone you love" a real CTA → deep-link into create flow; add recipient→creator attribution + "reply with a song." Proven dead (39→0); cheapest growth engine you have.
- [ ] **Add a post-song rating + feedback prompt** — you currently have ZERO quality signal. This also feeds the review ask.

### WEEK 1–2 — Ship the distribution you already built

- [ ] Post the **8 ready Reddit drafts** (r/giftideas, r/SideProject, etc.).
- [ ] Send **creator outreach** via email/IG (not TikTok DM — blocked). Rank by median views, not followers.
- [ ] Resume the **cold-email send** (92% of the 4,431 list untouched); wire open/click tracking.
- [ ] Post the **TikTok/Reels content** (Father's Day video is rendered and ready).
- [ ] **Restructure paid:** kill broad + "Painkiller" lanes; run ONLY exact high-intent seasonal/gift terms (`mother's day song`, `gift song`, `birthday gift`) with completion/purchase kill-gates. Concentrate spend on gift-season peaks, not flat year-round.

### WEEK 2–4 — Realign model & moat (structural)

- [ ] **Make one-off gift tokens / bundles the PRIMARY purchase**; demote subscription to an optional creator tier. (Infra already built — `gift_bundles`/`gift_orders`/`gift_wallet`.) Consider a premium "human-polished" tier (Songfinch model) for high-intent buyers.
- [ ] **Resolve the voice-moat decision — pick one:** (a) lead with "a song in YOUR voice," surface enrollment earlier and make it lighter than 6 phrases; or (b) stop centering voice in messaging while defaulting to AI. Today you dilute the moat _and_ don't deliver it.
- [ ] **Build occasion-based repeat loops:** saved recipients, birthday/anniversary reminders, "next gift" prompts. The only honest retention path for a gift product — turn one-off into a recurring-occasion relationship.

### ONGOING — Instrument so the next decision is data-driven

- [ ] Restore/verify ASC analytics; pull product-page conversion + install-source + activation funnel (Codex couldn't; this closes the last loopholes).
- [ ] Listen to a sample of real users' rendered songs to sanity-check emotional quality.

---

## The encouraging part

You have **not** disproven demand for personalized song gifts (Songfinch $5M+, the category is real). You've proven that **the current packaging never got a fair test**: a broken iPhone store page, an unshipped marketing engine, a switched-off viral loop, and a diluted moat. Most of the Week-1 fixes are free and the transactional infra is already in your schema. The cheapest experiments (store page + viral loop + ship the ready channels) haven't been run — which means the most likely-to-work levers are still untouched.
