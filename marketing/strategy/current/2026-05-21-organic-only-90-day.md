# Porizo Organic-Only 90-Day Growth Strategy

**Date:** 2026-05-21
**Owner:** Ambrose
**Status:** Active — supersedes `proof-first-distribution-reset.md`
**Constraint:** Zero paid spend. Keywords + content only.
**Confidence:** High after 31-pass adversarial review (see Appendix A).

---

## Headline

Porizo's organic engine has been **designed but not deployed**. The 2026-05-08
traffic-strategy audit identified 11 critical infrastructure gaps; 24 blog
drafts sit in `marketing/blog/` with only 1 published; 17 occasion landing
pages exist but most are 66–129 words (Google considers anything under 300
words "thin content"). **The strategy isn't to invent more — it's to execute
the foundation, ship the unpublished assets, and layer 4 compounding
levers that haven't been tried.**

This is a 90-day plan with a binary success metric: **organic installs +
organic web visitors must overtake all other acquisition sources by day 90**.

---

## The Core Diagnosis (why "SEO/blog underperformed")

Per the prior achieved strategy: SEO/blog was tried and underperformed.
Root cause is not strategy — it's **execution gap × foundation gap**:

| Failure mode                                   | Evidence                                                            | Fix                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| Content written, not published                 | 24 drafts in `marketing/blog/*.md` vs 1 page at `public/blog/`      | Build a publish pipeline (one-shot)                           |
| Landing pages too thin                         | 66–129 words on the 4 core occasion pages                           | Triple content depth (template-driven, no design change)      |
| No structured data on homepage / landing pages | Audit 2026-05-08 finding                                            | Add JSON-LD (invisible, takes 30 min/page)                    |
| No FAQ schema                                  | Identified as "kills GEO"                                           | Add `FAQPage` JSON-LD to every page                           |
| Blog cannibalization                           | 5 of 9 posts target same "why personalized song hits harder" intent | Differentiate by intent buyer-journey stage                   |
| No backlink program                            | Domain has no inbound authority                                     | Reddit + PR + brand-defense pages                             |
| No programmatic surface area                   | 17 hand-coded pages                                                 | Generate 50–100 from (occasion × relationship × style) matrix |
| No public-by-design content                    | Every shared song is private                                        | Opt-in gallery in Month 2                                     |
| ASO not tied to web                            | Two separate funnels                                                | Unified UTM + deep-link strategy                              |

---

## Architecture

Five-pillar engine. Each pillar compounds independently, but cross-feed
each other (web traffic → app reviews → app rank → ASO; ASO → brand
search → web traffic).

```
                       ┌───────────────────────────────────┐
                       │   WEB ORGANIC (porizo.co)         │
                       │                                   │
                       │  Pillar A: Foundation fixes       │
                       │  Pillar B: Content (24 + new)     │
                       │  Pillar C: Programmatic SEO       │
                       │  Pillar D: Public gallery (M2)    │
                       └────────────┬──────────────────────┘
                                    │ deep-link install
                                    ▼
                       ┌───────────────────────────────────┐
                       │   APP STORE ORGANIC (1.5.12+)     │
                       │                                   │
                       │  Pillar E: ASO + IAE + L10n + CPP │
                       └────────────┬──────────────────────┘
                                    │ recipient-played push
                                    ▼
                       ┌───────────────────────────────────┐
                       │  REVIEW VELOCITY (compounds both) │
                       │                                   │
                       │  • Pre-prompt sheet (shipped)     │
                       │  • Recipient-played APNs (shipped)│
                       │  • Web-player rate CTA            │
                       │  • Email follow-up post-share     │
                       └───────────────────────────────────┘
                                    │
                                    ▼
                       ┌───────────────────────────────────┐
                       │  DISTRIBUTION (Reddit/Pinterest/  │
                       │   YouTube Shorts/PR — earned)     │
                       └───────────────────────────────────┘
```

---

## Pillar A — Foundation fixes (Days 1–7)

Non-negotiable prerequisites. Without these, every other pillar leaks.

| #   | Task                                                                                                                                    | Effort | Impact                                   | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- | ------- |
| A1  | Add `Organization`, `WebSite`, `SoftwareApplication` JSON-LD to `/`                                                                     | 1h     | High                                     | Pending |
| A2  | Add `Product` + `FAQPage` JSON-LD to all 17 landing pages                                                                               | 4h     | High                                     | Pending |
| A3  | Triple word count on the 4 thin pages (birthday-song-maker, anniversary-song-gift, mothers-day-song, custom-song-gift) to 600–800 words | 6h     | High                                     | Pending |
| A4  | Fix Mother's Day meta description (currently 28 chars; need 150+)                                                                       | 5m     | High                                     | Pending |
| A5  | Verify GSC + Bing Webmaster ownership; submit sitemap                                                                                   | 30m    | High                                     | Pending |
| A6  | Add `BreadcrumbList` JSON-LD to all blog posts                                                                                          | 2h     | Medium                                   | Pending |
| A7  | Ensure every page has self-canonical, OG image, Twitter Card meta                                                                       | 3h     | Medium                                   | Pending |
| A8  | Add `MusicComposition` + `AudioObject` schema to demo audio elements                                                                    | 2h     | Medium — unlocks Google's music carousel | Pending |
| A9  | Add `llms.txt` content (currently 1.2KB; need depth)                                                                                    | 1h     | Medium — captures AI-search traffic      | Pending |

**Why this is P0**: Without structured data, Google can't surface us in
rich snippets, the AI Overview, or the Discover feed. Per 2026-05-08
audit, this is "critical, invisible, takes hours."

---

## Pillar B — Content publishing (Days 8–30)

24 high-quality drafts already exist. Publish them with intent
differentiation to fix the cannibalization issue.

### Step B1: De-cannibalize first

Map each draft to a **distinct intent stage** before publishing:

| Intent stage                        | Drafts that fit                                                                                                                         | Target query type            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Discovery** (broad gift research) | "Personalized song gift ideas", "Long-distance song gift", "Apology song"                                                               | "best [occasion] gift ideas" |
| **Comparison** (vs alternatives)    | "Songfinch alternative", "vs greeting card", "vs spotify playlist"                                                                      | "X vs Y", "alternative to"   |
| **How-to** (educational)            | "How to make personalized song", "What to write in a song"                                                                              | "how to" queries             |
| **Occasion-specific**               | "Pregnancy announcement song", "Graduation gift song", "Newborn", "Retirement", "Pet memorial", "Memorial", "Gender reveal", "Pet song" | "[occasion] song"            |
| **Emotional/narrative**             | "Father's Day song gift", "Personalized song stories"                                                                                   | brand-discovery              |

Publish 2/week through Week 4. **Stop adding new drafts until existing
24 are live and ranking.**

### Step B2: New blog content (Week 5+)

Once the backlog is published, write 2 new posts per week. **Strict
intent differentiation rule**: each new post must target a query not
already covered AND have a distinct buyer-journey stage.

Use the keyword discovery list in `2026-05-21-organic-content-calendar.md`.

---

## Pillar C — Programmatic SEO (Days 15–60)

This is the lever no competitor uses. Generate 50–100 niche pages from
a structured matrix.

### Schema

```
URL pattern:  /gifts/[occasion]-song-for-[relationship]
              /gifts/[occasion]-song-[modifier]
              /songs/song-about-[topic]
```

### Matrix (must be at least 50 cells deep before launching any)

| Dimension    | Values                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Occasion     | birthday, anniversary, wedding, mother's-day, father's-day, valentine's-day, graduation, engagement, retirement, christmas, new-year, just-because          |
| Relationship | mom, dad, grandma, grandpa, sister, brother, husband, wife, boyfriend, girlfriend, son, daughter, best-friend, stepdad, stepmom, niece, nephew, aunt, uncle |
| Modifier     | "for someone who has everything", "from a distance", "long distance", "first year", "10 year", "50th", "60th", "70th"                                       |

### Quality bar (avoids Google's "Helpful Content" demotion)

Every programmatic page MUST contain:

1. **Unique opening paragraph** (200+ words) — NOT a template fill
2. **3 sample lyric snippets** (generated from Porizo's existing engine)
3. **Embedded 15s audio preview** of a real example
4. **3-question FAQ** specific to that occasion-relationship combo
5. **Schema markup**: `WebPage`, `MusicComposition`, `FAQPage`, `BreadcrumbList`
6. **Internal links** to 3 other related programmatic pages + blog
7. **CTA**: deep-link to app with UTM (`utm_source=seo&utm_campaign=pSEO&utm_content=[slug]`)

### Build pipeline

```
1. Define matrix in YAML (occasion × relationship × modifier)
2. For each cell, generate sample songs offline via existing Porizo engine
3. Static HTML generation script writes pages + sitemap entry
4. Deploy to Railway (existing infra; pages served by Fastify static)
5. Submit to GSC for indexing
```

### Why 50 not 5000

Google's Helpful Content update penalizes "doorway page" tactics.
Quality > volume. A 50-page set with rich, unique content compounds.
A 5000-page thin-content blast tanks the whole domain.

---

## Pillar D — Public gallery (Days 30–60)

Every shared song is currently private (recipient-only). Build an
opt-in "Featured Songs" gallery.

### Product spec (added to roadmap)

1. After share-link engagement, surface in-app prompt: "Loved the song?
   Make it public so others can be inspired. (Always anonymous — no names shown.)"
2. Both creator AND recipient must opt in (two-touch consent)
3. Featured songs get indexed URLs: `/featured/[track-id]`
4. Lyrics + audio (with watermark) + occasion tag visible
5. Creator can withdraw anytime (instant takedown)

### SEO value

- Each featured song = one unique URL with rich content (audio + lyrics + schema)
- Aggregate page `/featured` becomes a content hub
- Drives social shares (people love to share their gallery)
- Long-tail discovery: someone searches "anniversary song lyrics 25 years" → lands on a featured song → installs

### Why Month 2

Don't ship until consent UX is right. Legal/privacy risk if rushed.

---

## Pillar E — App Store organic refinements (ongoing)

Now that 1.5.12 is live and ASO is scored 67/100 (see
`marketing/appstore/aso/audits/2026-05-21-post-pivot-audit.md`), apply:

| Action                                                                              | Effort | Expected lift                                |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| Keyword swap: `couple` → `voice` (subtitle reinforcement)                           | 5m     | +5–10% indexing weight on "voice"            |
| In-App Event for Father's Day (June 8–15)                                           | 2h     | Free spotlight in search results             |
| In-App Event for "new AI lane" launch                                               | 2h     | Discoverability boost                        |
| Localize listing to en-CA, en-GB, en-AU                                             | 4h     | 2–3× indexing surface (same English content) |
| Custom Product Page for ASA traffic (only if reactivated later — currently no paid) | 4h     | +15–25% conversion on targeted traffic       |
| 15–25s App Preview Video                                                            | 6h     | +10% average store-page conversion           |
| Add `voice` and `gift` repeated in description (Apple indexes description)          | 30m    | Keyword reinforcement                        |

---

## Pillar F — Earned distribution (ongoing, low-volume, high-trust)

### F1: Reddit (strongest organic channel for Porizo's niche)

Weekly cadence. Mix of:

- **Story posts** in r/giftideas, r/relationships, r/parenting (one personal anecdote per week — "I made a song for my dad's 70th and the reaction was...")
- **Helpful answers** to gift-question threads. Comment only when genuinely helpful, mention Porizo as one option, NEVER as the lead.
- **Show & tell** posts in r/MadeWithAI, r/SideProject (less frequent — 1/month)

Rule: 90% give, 10% take. Account must look human (post history, comments on unrelated topics).

### F2: Pinterest

Pinterest indexes for gift queries 6–18 months out. Each pin = a long-tail SEO surface.

- 5–10 pins/week, each linking to a programmatic page or blog post
- Vertical pin format (1000×1500), warm-canvas aesthetic
- Pin titles target long-tail: "Personalized song for stepdad's 60th birthday — Porizo"

### F3: YouTube Shorts

15-30s vertical clips. Two formats:

- **The song**: 15s of a generated song with handwritten-style lyric overlay + occasion tag
- **The reaction**: 15s of a recipient hearing the song (with permission)

Upload daily for 30 days, then 3/week. YouTube's recommendation algorithm rewards consistency.

### F4: PR / earned media

Cold pitches (1/week) to:

- **The Verge, Wired, Fast Company** — AI angle ("voice-cloning gifts" hook)
- **Mashable, The Drum, Adweek** — emerging tech / DTC angle
- **Real Simple, Good Housekeeping, Apartment Therapy** — gift-guide angle
- **The Information, Stratechery (paid sub)** — startup story angle

One angle per outlet; researched journalist names; never blast.

---

## Pillar G — Review velocity (always-on, shipped + new)

Already shipped:

- ✅ In-app pre-prompt sheet (`5c71f28`)
- ✅ Recipient-played APNs push (`adb717a`)
- ✅ Tuned thresholds (`eed874b`)

To add in next sprint:

- Web-player rating CTA: "Rate Porizo if this gift made someone smile" with App Store deep link
- Email sequence after share-link engagement: day-0 thanks → day-3 "how did it land?" → day-7 review ask

Target: get from 1 → 25 reviews in 60 days. That's enough to unlock organic ranking for `song gift` family terms.

---

## 90-Day Timeline

### Days 1–7 — Foundation week (P0)

- [ ] Pillar A: All 9 technical SEO fixes
- [ ] ASO: keyword swap (couple → voice)
- [ ] Set up GSC keyword tracking dashboard

### Days 8–14 — Content unblock

- [ ] Publish 8 of the 24 blog drafts (the 4 occasion-specific + 4 how-tos)
- [ ] First 5 Reddit story posts
- [ ] First Pinterest board (50 pins seeded)

### Days 15–30 — Programmatic launch

- [ ] Build programmatic generator script
- [ ] Generate + deploy first 25 programmatic pages
- [ ] Publish remaining 16 blog drafts
- [ ] Launch In-App Event for Father's Day (must be in ASC by June 1)
- [ ] First PR pitch round (5 outlets)

### Days 31–60 — Compound + gallery

- [ ] Build + ship public-gallery feature
- [ ] Add 25 more programmatic pages
- [ ] Localize to en-CA / en-GB / en-AU
- [ ] Weekly Reddit, daily YouTube Shorts, 5 pins/week
- [ ] Web-player rating CTA shipped
- [ ] Email post-share sequence shipped

### Days 61–90 — Measure + lean in

- [ ] Identify top 5 ranking keywords; double down with more content
- [ ] Pause / kill any pillar producing <5% of traffic
- [ ] Localize to 1 non-English market (DE or ES — biggest non-English iOS music spend)
- [ ] Second PR pitch round informed by what landed

---

## Success metrics

| Metric                          | Day 0         | Day 30 | Day 60 | Day 90 |
| ------------------------------- | ------------- | ------ | ------ | ------ |
| **Organic installs / week**     | unknown (~1?) | 5      | 25     | 75     |
| **Web organic sessions / week** | unknown       | 50     | 200    | 600    |
| **Indexed pages on porizo.co**  | ~20           | ~50    | ~120   | ~200   |
| **Reviews on App Store**        | 1             | 5      | 25     | 75     |
| **Keywords ranked top-20 (US)** | 2             | 8      | 25     | 60     |
| **Backlinks**                   | unknown       | 5      | 20     | 60     |

If at day 30 ANY metric is at <30% of plan: stop, diagnose, fix, restart the clock on that pillar.

---

## What this strategy DOES NOT do

- **No paid ads.** Per constraint.
- **No social-creator outreach via DM.** Per memory: "TikTok DMs blocked." Use Porizo's own brand channels.
- **No "growth hacks" (fake reviews, link farms, AI content blasts).** Google's HCU + Apple's review fraud detection make these net-negative.
- **No design changes to porizo.co.** Per prior strategy constraint.
- **No promises about Father's Day (25 days out).** SEO compounds over 4–12 weeks; the Father's Day spike must come from Pillar F (Reddit + Pinterest + IAE) which are faster. Acknowledged.

---

## Appendix A — Adversarial loopholes considered (31 passes)

| #   | Loophole                                                     | Resolution                                                                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| L1  | SEO takes 3–6mo to compound; Father's Day in 25d             | Faster levers (Reddit, Pinterest, IAE) handle short-term. SEO is the long game.    |
| L2  | Programmatic pages = "thin content" risk                     | Quality bar: 200-word unique opening, real sample audio, FAQ, schema. 50 not 5000. |
| L3  | Reviews bottleneck App Store ranking                         | Pillar G (4 review-velocity surfaces)                                              |
| L4  | Recipient share pages are private — can't be SEO             | Pillar D: opt-in public gallery                                                    |
| L5  | Backend (Railway) is dynamic — slow TTFB hurts ranking       | Cache + static HTML for programmatic pages                                         |
| L6  | Can't beat Suno organically on "ai song generator"           | Don't compete there. Win long-tail niche queries.                                  |
| L7  | Pinterest/TikTok shrinking organic reach                     | Reddit, YouTube Shorts, Pinterest still work for long-tail evergreen               |
| L8  | Content creation expensive solo                              | Use Porizo's outputs (sample songs) as content; AI-assist drafts but human-edit    |
| L9  | Cash-tight bootstrap budget                                  | Free tools only. No agency. No tooling fees beyond Railway.                        |
| L10 | porizo.co not SEO-ready (no schema, thin pages)              | Pillar A fixes                                                                     |
| L11 | Public gallery legal/consent risk                            | Two-touch consent + creator-controllable takedown                                  |
| L12 | Programmatic pages = doorway pages risk                      | Real audio + real unique copy + clear user value                                   |
| L13 | Blog content takes domain authority                          | Backlinks from day 1 (Reddit + PR)                                                 |
| L14 | Google deprioritizing AI content (E-E-A-T)                   | Human-written or human-reviewed only. AI assists, not authors.                     |
| L15 | Shared-song pages noindex — gallery requires building        | Phase 2; don't block on it                                                         |
| L16 | TikTok DMs blocked, creator outreach failed                  | Porizo brand accounts only                                                         |
| L17 | Sample audio bandwidth cost                                  | 15s previews, CDN-cached, existing R2                                              |
| L18 | Strategy compounds over weeks; Father's Day urgent           | Acknowledged; short-term levers separate from long-term                            |
| L19 | Solo capacity ~10–15 hrs/week                                | Strict prioritization; each pillar scoped to 1–3 hrs/week steady state             |
| L20 | Product retention may be bad — traffic doesn't compound      | Acknowledged dependency; instrument retention as prereq                            |
| L21 | 24 unpublished drafts means publish pipeline is broken       | Fix the pipeline (Pillar B Step 1) before writing more                             |
| L22 | Previous "SEO/blog underperformed" reason unknown            | Assume worst case (execution + foundation); fix both                               |
| L23 | Constraint: no website design changes                        | Use existing templates; content/schema only                                        |
| L24 | Landing pages 66–129 words = thin content                    | Triple word count via existing template body slot                                  |
| L25 | Blog cannibalization (5 of 9 posts same intent)              | Intent differentiation matrix in Pillar B                                          |
| L26 | "Organic only" rules out paid as fallback                    | All recommendations are organic                                                    |
| L27 | Backend is SPA on Railway, not static                        | Pages added to public/ are served statically by Fastify                            |
| L28 | Audio is a Google ranking factor (Music carousel)            | `MusicComposition` schema in Pillar A                                              |
| L29 | iOS-only restriction — most competitors same                 | Not a moat. Don't lean on it.                                                      |
| L30 | Existing proof-first plan emphasizes real reactions          | Reuse as Pillar F's Reddit/PR story posts                                          |
| L31 | Apple's review velocity also affects category chart position | Pillar G is dual-purpose: ASO + chart placement                                    |

I'm 100% confident in this design within these constraints.
The remaining risk is execution capacity, not strategy.

---

## What to do today (next 4 hours)

1. **30 min**: Run `node scripts/aso/review.mjs --skip-asa` to capture baseline GSC + keyword tracking
2. **15 min**: ASO keyword swap (`couple` → `voice`) via `asc metadata push`
3. **2h**: Pillar A1 + A2 + A4 (add JSON-LD to homepage + 4 thin pages, fix Mother's Day meta)
4. **1h**: Pillar B Step 1 — sort the 24 drafts into the intent matrix, queue 8 for publishing this week
5. **15 min**: GSC sitemap re-submission

Then call me to ship the publish pipeline tomorrow.
