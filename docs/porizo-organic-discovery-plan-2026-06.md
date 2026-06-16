# Porizo Organic Discovery Plan — June 2026

**Goal:** Get _regular users who don't already know Porizo_ to discover it organically.
**Owner:** Ambrose (solo/tiny team). **Horizon:** 90 days, compounding after.

---

## 1. Where we actually are (the honest baseline)

Google Search Console, last 3 months:

| Metric                     | Value             | What it means                                          |
| -------------------------- | ----------------- | ------------------------------------------------------ |
| Total clicks               | **2**             | Effectively zero organic discovery                     |
| Total impressions          | **244**           | Tiny — barely being shown                              |
| "porizo" query impressions | **146 / 244**     | 60% of all impressions are our **own brand name**      |
| Non-branded impressions    | **~98 / quarter** | Almost nobody finds us by intent ("song gift", etc.)   |
| Avg position               | 8.6               | Misleading — it's on no-volume long-tail/branded terms |

**Diagnosis (verified, not guessed):** pages are technically clean (200, unique
copy, canonical, in sitemap, robots allows) and the blog is genuinely good
(24 posts, some citing real research). The blocker is **domain authority +
discovery**, not content or tech. A young domain with a near-empty backlink
profile gets: pages parked in "Crawled – currently not indexed" → not ranked →
no impressions → no discovery. We are **not in the SEO race yet**, not losing it.

**Strategic consequence:** the lever is _off-page authority + getting linked/seen_.
SEO is a **3–6 month compounding play** — there is no overnight switch, and
Google's Indexing API does **not** work for marketing pages. So we run the slow
SEO engine **and** faster direct-discovery channels in parallel.

---

## 2. The mental model

Three organic engines feed discovery. This plan drives all three:

1. **Search (SEO)** — authority via backlinks + indexed, well-linked content. Slow, compounding, the focus of this doc.
2. **Referral/community** — gift-guide media, Reddit, directories, Product Hunt. _Faster_ — real traffic in weeks, and it feeds #1 (links → authority → indexing).
3. **Viral loop** — every gift song exposes a new recipient (tracked separately; see `tasks/todo.md` viral-loop work). The cheapest discovery engine this product has — keep it healthy alongside this.

Key insight: **the directory/PR/community work (engine 2) is also how we fix
engine 1.** Each external link to a blog/landing page is the fastest way to get
Google to index and trust it. They are not separate projects.

---

## 3. Tactics, ranked by ROI for _this_ product

(From 2026 research — full sources in the research thread. Post-2024 spam updates
killed PBNs, mass guest posts, and directory spam; cold email + TikTok DMs are
dead for us specifically.)

| #   | Tactic                                                                                                              | Owner                | Effort              | Time-to-impact | Risk          |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------- | -------------- | ------------- |
| 1   | **AI/product directory blitz** (Product Hunt, There's An AI For That, Futurepedia, AlternativeTo, SaaSHub, Toolify) | Ops (turnkey kit ✅) | Low                 | 2–4 wks        | Very low      |
| 2   | **Source-request platforms** (Featured.com + Source of Sources, then Qwoted)                                        | Ops (turnkey kit ✅) | Low–Med daily habit | 2–8 wks        | Very low      |
| 3   | **Gift-guide / roundup outreach** (seasonal, pitch 4–6 wks early)                                                   | Ops (turnkey kit ✅) | Med–High            | 2–6 mo         | Low           |
| 4   | **Internal linking + indexing hygiene**                                                                             | Code (me)            | Low                 | 1–4 wks        | None          |
| 5   | **"State of Personalized Song Gifts" data study** (our own usage data)                                              | Code+Content (me)    | Med                 | 1–4 mo         | Low           |
| 6   | **"Songfinch alternative" capture** (AlternativeTo + on-site comparison page)                                       | Code+Ops             | Low                 | 2–6 wks        | Very low      |
| 7   | **Reddit community building** (r/gifts, r/birthday, r/AItools)                                                      | Ops (turnkey kit ✅) | High                | 3–6 mo         | Med if rushed |
| 8   | **Product Hunt coordinated launch** (one-time event)                                                                | Ops (kit ✅)         | Med–High            | 4–8 wks prep   | Low           |

---

## 4. Workstreams by owner

### A. Code / automation — _I implement these (this repo)_

- [x] **Gift cluster cross-linking + comprehensive hub** (shipped earlier today — 25 `/gifts/*` pages now mesh + `/gifts/` hub lists all occasion pages).
- [ ] **IndexNow auto-submission** — `scripts/seo/submit-indexnow.mjs` pings Bing/Yandex/Naver with all sitemap URLs (key endpoint already exists). Same-day Bing indexing = a real secondary traffic channel + "this page exists" signal.
- [ ] **Blog → cluster cross-linking** — blog posts currently link 3 sibling posts + 1 landing CTA; add links to the `/gifts/` hub + the matching occasion page so blog authority flows into the money pages and vice-versa.
- [ ] **Songfinch-alternative comparison hardening** — `/songfinch-alternative` exists; add a structured comparison table + `Product`/`FAQPage` schema to win the comparison query and the AlternativeTo listing.
- [ ] **Homepage deep-link breadth** — homepage links 10 pages; surface a "popular songs by occasion" block linking the cluster so the highest-authority page passes equity down.

### B. Content / linkable assets — _I build/draft_

- [ ] **Data study** — extract real "most-requested occasions / styles / send-timing" from our DB (`tracks.occasion`, `jobs`) → write a short cited report at `/blog/state-of-personalized-song-gifts-2026`. Zero survey cost; it's our own data; journalists cite original data. This is our single best _linkable asset_.
- [ ] **Directory press kit** — ready-to-paste listing copy for every platform → `marketing/seo/directory-press-kit.md` _(being drafted now)_.

### C. Manual ops — _you execute; I provide turnkey kits so it's send/click_

- [ ] **Directory blitz** — submit Tier-1 manually this week, space Tier-2 over 2–3 months (kit ✅).
- [ ] **Featured.com + Source of Sources** — join, set keyword alerts, answer within ~1hr (kit: keyword list + 3 reusable response snippets ✅).
- [ ] **Gift-guide outreach** — target list + 2 pitch templates + seasonal calendar (kit ✅).
- [ ] **Reddit** — season accounts now; 90/10 helpful-first; subreddit list + comment templates (kit ✅).
- [ ] **Product Hunt** — plan as a launch event once directories + a few links are in place.
- → All of the above live in `marketing/seo/outreach-playbook.md` _(being drafted now)_.

---

## 5. 90-day sequenced roadmap

**Weeks 1–2 — Foundations (mostly code + setup, fast wins)**

- Ship code: IndexNow submission, blog cross-linking, Songfinch comparison, homepage breadth.
- Submit Tier-1 directories (Product Hunt profile, There's An AI For That, Futurepedia, AlternativeTo, SaaSHub).
- Create Featured.com + Source of Sources accounts; set keyword alerts.
- GSC: Request-Indexing the 5–8 highest-intent pages manually.

**Weeks 3–6 — Engine on**

- Daily: answer 1–3 source-request queries (compounds quietly).
- Build + publish the data-study report; pitch it to gift/AI journalists.
- Begin Reddit account seasoning (genuine participation, no promo yet).
- Space out Tier-2 directory submissions.

**Weeks 7–12 — Outreach + launch**

- Gift-guide outreach for the next seasonal window (whatever is 6+ weeks out).
- First transparent Reddit "I built this" post in r/SideProject; start 90/10 in r/gifts.
- Product Hunt launch (coordinate genuine upvoters; do NOT brigade).
- Re-measure GSC; double down on whatever moved.

---

## 6. Metrics & targets (review monthly in GSC)

Don't chase clicks first — chase **leading indicators** that precede clicks:

| Metric                               | Now      | 30d  | 90d                  |
| ------------------------------------ | -------- | ---- | -------------------- |
| Referring domains (Ahrefs/GSC Links) | ~handful | +10  | +30                  |
| Pages indexed (GSC Coverage)         | low      | +50% | most cluster indexed |
| Non-branded impressions / mo         | ~30      | 300  | 1,500                |
| Non-branded clicks / mo              | ~0       | 10   | 75                   |

If non-branded **impressions** climb, indexing+authority is working even before
clicks follow. That's the signal to watch first.

---

## 7. Hard truths / guardrails

- **No overnight result.** Branded "porizo" traffic ≠ discovery. Watch non-branded impressions.
- **Don't spam-validate GSC** or mass-submit directories — both are manipulation signals now.
- **Voice-cloning copy must be removed** before any PR/directory push — it's a false promise + App Store risk (`project_no_voice_cloning_tech`). Pitching media with a claim we can't deliver backfires. (Separate cleanup task — do before outreach.)
- **Reddit/community is high-risk if rushed** — season accounts, help first.
