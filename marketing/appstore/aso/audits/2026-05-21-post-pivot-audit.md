# Porizo ASO Audit — Post-Pivot (2026-05-21)

App: Porizo (App ID 6758205028) · US · iOS · v1.5.12 LIVE since 2026-05-20T20:24:30Z
Previous baseline: `ASO-audit-report.html` (run while 1.5.11 was live).

---

## Headline

The AI-generator-lane metadata pivot is **live on the App Store** as of last night.
Apple has begun indexing — Porizo already ranks **#5 for "song gift"** (with only
1 review) and **#1 for the brand term "porizo"**. The pivot is working on the
metadata side. The remaining ceiling on growth is the **review-count chasm**:
Porizo has 1 review while every top-9 `ai song generator` competitor has
**4,700 – 257,000 reviews**.

```
Overall ASO Score: 67/100  (was ~55/100 pre-pivot)

Title:              9/10  █████████░   (was 5/10 — added "AI")
Subtitle:           8/10  ████████░░   (was 4/10 — added AI+Voice+Gifts)
Keyword Field:      7/10  ███████░░░   (was 6/10 — added "generator")
Description:        7/10  ███████░░░   (unchanged — could add AI mention earlier)
Screenshots:        6/10  ██████░░░░   (5 iPad, iPhone status uncertain)
Preview Video:      0/10  ░░░░░░░░░░   (none — same as before)
Ratings & Reviews:  1/10  █░░░░░░░░░   (1 review @ 5.0★ — unchanged)
Icon:               7/10  ███████░░░   (unchanged)
Keyword Rankings:   5/10  █████░░░░░   (new: #5 "song gift", #1 brand)
Conversion Signals: 8/10  ████████░░   (was 3/10 — promo + whatsNew filled)
```

---

## Live state (verified via iTunes Lookup + asc CLI)

| Field              | Value                                                                                                                                   | Δ from 1.5.11                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Title              | **Porizo: AI Song Gift Maker** (27/30 chars)                                                                                            | +"AI"                                     |
| Subtitle           | **Personal AI Song & Voice Gifts** (30/30 chars)                                                                                        | rewritten                                 |
| Keywords (100/100) | `generator,music,birthday,personalized,custom,text,lyrics,mom,dad,anniversary,wedding,proposal,couple`                                  | broadened from gift-niche to AI-generator |
| Promotional text   | "Make a personal song for Dad in his voice or yours. Preview free — finish it for Father's Day, June 15."                               | was empty                                 |
| What's New         | "New for Father's Day — make a song for Dad in his voice or yours. Add their name and a memory, preview free, and send before June 15." | was "Stability Improvement."              |
| Age rating         | 12+                                                                                                                                     | unchanged                                 |
| Rating             | 5.0 / 1 review                                                                                                                          | unchanged                                 |
| Last updated       | 2026-05-20                                                                                                                              | new                                       |

---

## Live keyword rankings (verified via iTunes search API, 2026-05-21)

| Term                                   |                    Porizo rank | Top-3 (review count, rating)                                        |
| -------------------------------------- | -----------------------------: | ------------------------------------------------------------------- |
| `porizo` (brand)                       |                      **#1** ✅ | —                                                                   |
| `song gift`                            |                  **#5** ✅ NEW | 1. WishAI (3), 2. GiftSong (1), 3. GiftSong (2)                     |
| `ai song generator`                    |                not in top 9 ⚠️ | 1. Suno (257k, 4.89★), 2. Muzio (16k, 4.77★), 3. Donna (85k, 4.74★) |
| `gift song` (paid ASA)                 | data only — $0.67 CPI on EXACT | —                                                                   |
| `birthday gift ideas` (paid ASA BROAD) |        $3.91 CPI, 1 install/7d | —                                                                   |

**Interpretation:** the pivot is half-indexed. "song gift" surfaced because the
new title contains both words exactly. "ai song generator" hasn't ranked us yet —
likely because Apple's 48-72h re-indexing window is still in progress AND because
3 of the top 4 competitors have 12,000–257,000 reviews vs our 1.

---

## Factor-by-factor

### 1. Title (9/10, weight 20%) — biggest improvement

- **Now**: "Porizo: AI Song Gift Maker" (27/30 chars)
- **Was**: "Porizo: Song Gift Maker"
- Adds "AI" — the highest-volume vertical
- Brand kept (defensible for direct search)
- 3 chars of room left — could add one more letter (e.g., "AI Song Gift Maker+" no, looks bad). Better to leave as-is.

### 2. Subtitle (8/10, weight 15%) — second biggest improvement

- **Now**: "Personal AI Song & Voice Gifts" (30/30 chars — fully used)
- **Was**: "Personalized songs in minutes" (29 chars, generic, no AI signal)
- Adds "Voice Gifts" — our exclusive differentiator vs Suno/Donna/Muzio (none clone voice)
- Note: subtitle keywords are also indexed; "voice" not in keyword field is fine.

### 3. Keyword Field (7/10, weight 15%) — incremental win

- **Now** (99/100): `generator,music,birthday,personalized,custom,text,lyrics,mom,dad,anniversary,wedding,proposal,couple`
- **Was** (94/100): `birthday,anniversary,wedding,mom,dad,love,custom,music,poem,romantic,keepsake,valentine`
- **Wins:** added "generator" (#1 AI-lane word), "text", "lyrics", "proposal", "couple"
- **Losses:** dropped "love", "poem", "romantic", "keepsake", "valentine" — Valentine's was seasonal, OK; "poem" matters less now that poem feature is de-emphasized
- **Opportunity:** swap one weak word for "voice" — currently subtitle-only, doubling up in field would add weight. e.g., drop "couple" → add "voice".

### 4. Description (7/10, weight 5%)

- Hook lines 1-2 mention "AI song gift" ✅
- Steps format is scannable
- ⚠️ No social proof (1 review is too few to flaunt)
- ⚠️ No CTA — ends on privacy/terms URLs
- ⚠️ "AI" appears only once — Android plays keyword density games even iOS-less but iOS still rewards relevance

### 5. Screenshots (6/10, weight 15%) — needs human check

- iTunes Lookup shows: **5 iPad**, **0 iPhone** screenshots — but Apple's Lookup API often under-reports iPhone shots. asc CLI returns 0 sets for both 1.5.11 and 1.5.12, suggesting they're being inherited from an earlier version internally.
- **Action: open `https://apps.apple.com/us/app/porizo/id6758205028` in a real iPhone browser and confirm what users see.** If iPhone shots are missing, that's a P0 bug — iPhone is 95% of installs.
- Best practice is 10 screenshots, 6.7" and 6.9" sets. Currently uncertain.

### 6. App Preview Video (0/10, weight 5%) — unchanged blind spot

- None on file. Apple gives 10% conversion lift on average for apps with a 15-30s video.
- Cost to produce: 1-2 hours screen capture + edit.

### 7. Ratings & Reviews (1/10, weight 15%) — biggest blocker on growth

- 1 review, 5.0★. Pre-prompt rating sheet shipped in 1.5.12 (`5c71f28`) — will fire from today.
- **Competitor floor**: 4,700 reviews (Jukebox, smallest top-9 in `ai song generator`).
- **Gap**: 4,700× — at organic install rate of ~1/day, recovery is years; at boosted ASA rate of ~10 installs/day with 5% prompt conversion, it's ~2 years.
- **Acceleration paths**:
  1. The recipient-played APNs push (`adb717a`) is the strongest signal we have — every gift that lands triggers the pre-prompt. Push notification engagement is 3-5× higher than in-app engagement.
  2. Apple Search Ads is currently $52 CPI — too high. Lower to ~$3 by killing Broad and using the EXACT lanes we set up.

### 8. Icon (7/10, weight 5%) — unchanged

- Not auditable from API data. Recommend reviewing distinctiveness against the 9 competitors that now appear in `ai song generator` search; many use generic music-note icons.

### 9. Keyword Rankings (5/10, weight 10%) — pivot starting to land

- See ranking table above. The "song gift" #5 placement is a brand-new acquisition vs the old listing.
- Re-check this audit on 2026-05-23 after Apple's 48-72h re-index completes for `ai song generator` and `ai music generator`.

### 10. Conversion Signals (8/10, weight 5%) — biggest +Δ of the lighter factors

- Promotional text + What's New now both carry the Father's Day hook
- No In-App Events configured — could surface the Father's Day deadline
- No Custom Product Pages — could use one targeted at the `ai song generator` ASA traffic

---

## Competitive position (post-pivot)

| App         | Title                          | Reviews |   Rating | Has voice clone? |
| ----------- | ------------------------------ | ------: | -------: | :--------------: |
| **Suno**    | Suno — AI Songs & Music        | 257,054 |    4.89★ |        No        |
| **Donna**   | Donna AI Song & Music Maker    |  85,519 |    4.74★ |        No        |
| **MyTunes** | MyTunes : AI Music Generator   |  36,113 |    4.31★ |        No        |
| **Mozart**  | AI Song Generator: Mozart      |  26,633 |    4.34★ |        No        |
| **Muzio**   | AI Song Music Generator: Muzio |  16,257 |    4.77★ |        No        |
| **Soniva**  | AI Song Maker - Soniva Music   |  14,047 |    4.76★ |        No        |
| **Zona**    | AI Song Generator - Zona       |  12,585 |    4.70★ |        No        |
| **Vibe**    | AI Song Generator : Vibe       |   6,092 |    4.47★ |        No        |
| **Jukebox** | AI Song Generator - Jukebox    |   4,698 |    4.73★ |        No        |
| **Porizo**  | **Porizo: AI Song Gift Maker** |   **1** | **5.0★** |     **YES**      |

The voice-clone moat is real but invisible from the store grid. **Until rating
count crosses ~500, organic ranking for "ai song generator" will not be competitive.**

The opportunity Porizo _can_ own today:

- `song gift` family terms — Porizo is rank #5 already and Suno/Donna don't have "gift" in title
- `gift song generator` — purpose-built EXACT keyword in new ASA lane
- `ai song for [occasion]` — three EXACT keywords already live in our new lane

---

## 30-day priorities (in execution order)

### Quick wins this week (P0)

1. **Visually confirm iPhone screenshots are present on 1.5.12**
   Open the store page on a real iPhone or simulator. If missing → emergency
   upload from `marketing/appstore/screenshots/current/6.9/` (5 Warm Canvas slides).

2. **Swap one keyword: drop `couple` → add `voice`**
   Current: `generator,music,birthday,personalized,custom,text,lyrics,mom,dad,anniversary,wedding,proposal,couple` (99 chars)
   Proposed: `generator,music,birthday,personalized,custom,text,lyrics,mom,dad,anniversary,wedding,proposal,voice` (98 chars)
   Reasoning: "couple" overlaps with "wedding"/"anniversary"; "voice" doubles down on our moat. promotionalText-style live edit available; no Apple review.

3. **Set promotional text rotation calendar**
   Father's Day promo is live until June 15. Pre-stage:
   - 2026-06-16 → wedding-season hook
   - 2026-07-01 → graduation/independence hook
     These can be pushed without review via `asc metadata push --version 1.5.12 ...`.

### High-impact this week (P1)

4. **Lower ASA Broad-match bids by 50%**
   7-day data: $52.54 spend, 1 install ($52 CPI). The EXACT-match AI lane needs
   budget room to ramp; cap Broad to $0.75 max CPT (currently $1.50).

5. **Pivot Mother's Day ad group → Father's Day Exact**
   Mother's Day EXACT was the star ($0.08 CPI). Recreate for Father's Day:
   `fathers day song`, `father's day song`, `song for dad`, `song for fathers day` — all EXACT at $2.00 max CPT.

6. **Verify ASC Analytics scope on the Porizo API key**
   Current "Porizo Reports" key returns 404 for the app and lacks Analytics
   scope. Without it we can't see organic-impression-by-keyword. Codex can rotate
   key permissions; this is a 5-minute fix that unlocks weekly insight reporting.

### Strategic this month (P2)

7. **Ship Custom Product Page** targeted at ASA AI-generator traffic
   Different first-screenshot focused on the "AI music in seconds" hook (Suno's
   wedge) instead of the gift hook. URL parameter `?ppid=...` directs ASA clicks
   to it. Lift expected: +15-25% conversion on AI-gen ASA traffic.

8. **Produce 15-25s App Preview Video**
   Top screenshot → voice-conversion demo → gift-arrival reaction. Apple gives
   +10% conversion on average. Costs 1-2 hours.

9. **Translate metadata to top 3 secondary markets** (CA, UK, AU) **and IN, BR**
   Currently English-only. Adding 4 more locales doubles the keyword-indexing
   surface area. The pivoted title+subtitle translates cleanly.

10. **Drive ratings via the new pre-prompt system + post-share APNs**
    The recipient-played push (`adb717a`) is the strongest review-acquisition
    moment in the product. Tune thresholds further if data shows the 5-play
    trigger is too high.

---

## What to re-check on 2026-05-23 (48h post-pivot indexing)

| Term                 | Expected Porizo position | Threshold to escalate                                 |
| -------------------- | ------------------------ | ----------------------------------------------------- |
| `ai song generator`  | top 30 by 2026-05-25     | if still not indexed → audit keyword field stop-words |
| `ai music generator` | top 30                   | same                                                  |
| `song gift maker`    | top 10                   | already trending                                      |
| `gift song`          | top 10                   | already paid; verify organic                          |
| `personalized song`  | top 20                   | "personalized" is in keywords                         |

Save the iTunes search-API snapshot used in this audit; diff weekly.

---

## Artifacts

- This audit: `marketing/appstore/aso/audits/2026-05-21-post-pivot-audit.md`
- Prior baseline: `ASO-audit-report.html` (root of repo)
- Fresh ASA telemetry: `marketing/appstore/aso/inputs/asa-2026-05-21.csv` (7-day window)
- Live metadata snapshot: `/tmp/asc-12/` (asc metadata pull from earlier)
- Keyword bank: `marketing/appstore/aso/keywords.json` (315 kw with effectiveness scores)
- Spend dashboard: `marketing/appstore/aso/spend-history/dashboard.html`
