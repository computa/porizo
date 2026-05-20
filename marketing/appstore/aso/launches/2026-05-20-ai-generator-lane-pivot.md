# ASA Action Plan — AI-Generator Lane Pivot (2026-05-20)

Generated from 8 days of live ASA data (2026-05-12 → 2026-05-20).
Grounded in `marketing/appstore/aso/spend-history/daily.json` and the new
keyword research at `ASO-keyword-research-report.html` /
`marketing/appstore/aso/keywords.json`.

## Diagnosis — where the money went

| Metric (8 days)                       | Value                                     |
| ------------------------------------- | ----------------------------------------- |
| Total spend                           | $92.87                                    |
| Total installs (paid)                 | 13                                        |
| Blended CPA                           | $7.14                                     |
| Spend wasted on zero-install keywords | $51.74 (56%)                              |
| Star performer                        | `mother's day song` EXACT — $0.08 CPA     |
| Sleeper hit                           | `gift song` EXACT — $0.67 CPA, 3 installs |

The current Probe campaign is mostly painkiller-niche (pet songs, baby, apology).
The AI-generator lane that the new 1.5.12 metadata targets has **zero EXACT
coverage** — every "ai song" / "song generator" search is currently going to
broad-match, which scrubs intent.

---

## ACTION 1 — DEMOTE 4 paid losers (in `Probe US Painkiller` campaign)

Pause these keywords. They produced $51.74 in spend with 0 installs across
8 days. Re-launch at lower max-CPT in 30 days only if external signal
changes (or skip entirely).

| Keyword (BROAD)               | Ad group                                    | Apple keyword ID      |  Spend |  Imps | Taps | Inst | Action                                                                           |
| ----------------------------- | ------------------------------------------- | --------------------- | -----: | ----: | ---: | ---: | -------------------------------------------------------------------------------- |
| `personalized gifts` (plural) | Porizo - Category                           | 2264549443¹           | $17.13 |   118 |   14 |    0 | **PAUSE** — overlaps with singular which converts                                |
| `meaningful gift`             | Porizo - Category                           | _(look up in ASA UI)_ | $15.96 |    57 |   13 |    0 | **PAUSE** — vague intent, no purchase signal                                     |
| `my voice song app`           | Probe US Painkiller / Voice-Clone Discovery | _(look up)_           | $11.01 | 1,913 |    9 |    0 | **PAUSE** — high imps but wrong audience (likely karaoke/recording app searches) |
| `i miss you song`             | Probe US Painkiller / Long-Distance         | _(look up)_           |  $7.64 |   933 |    6 |    0 | **PAUSE** — entertainment intent, not gift intent                                |

¹ Approximate ID — Apple keyword IDs are visible in the ASA UI keyword list. Cross-reference by term.

**Expected budget freed**: ~$50/mo at current pace (assuming similar trend). Redirect into the new EXACT-match group below.

### How to execute in the ASA UI

1. `https://app.searchads.apple.com` → Campaigns → `Porizo - Category` (or `Probe US Painkiller`)
2. Ad group containing the keyword → Keywords tab
3. Select the keyword row → **Pause** (top-right action)
4. Repeat for all 4
5. Add a Note on each paused row: "Paused 2026-05-20 — 8d, 0 installs"

---

## ACTION 2 — LAUNCH new EXACT-match ad group: "AI-Generator Lane"

This is the new lane the 1.5.12 metadata pivot opens up. None of these terms
are live in any current campaign — pure addition.

### Campaign placement

Add this ad group to the existing **`Probe US Painkiller`** campaign (campaign ID `2143835551`).
The campaign-level daily budget ($20/day) absorbs new ad groups; you don't
need a new campaign.

### Ad group settings

| Setting         | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Ad group name   | `AI-Generator Lane`                                             |
| Storefront      | United States                                                   |
| Bid strategy    | Manual CPT                                                      |
| Default max CPT | **$1.50** (vs $0.75 in probe — EXACT match deserves higher bid) |
| Match types     | **EXACT ONLY**                                                  |
| Audience        | All users                                                       |
| Schedule        | All day, all days                                               |

### Keywords (paste into ASA bulk-add as CSV)

```csv
keyword,match,max_cpt
ai music generator,EXACT,1.50
ai song generator,EXACT,1.50
ai song maker,EXACT,1.50
ai music maker,EXACT,1.50
ai song creator,EXACT,1.20
ai music gift,EXACT,1.20
ai song app,EXACT,1.00
ai music app,EXACT,1.00
song generator app,EXACT,1.00
ai text to song,EXACT,1.00
ai song for birthday,EXACT,1.20
ai song for anniversary,EXACT,1.20
ai song for wedding,EXACT,1.20
birthday song generator,EXACT,1.20
gift song generator,EXACT,1.20
```

### Negatives to add to the campaign

```csv
keyword,match
karaoke,BROAD
remix,BROAD
cover song,BROAD
free music download,BROAD
mp3 download,BROAD
youtube music,BROAD
spotify,BROAD
```

These suppress the "my voice song app" → karaoke / recording app confusion that
killed install rates in the broad-match probe.

---

## ACTION 3 — Promote 1 winner to its own EXACT (optional, recommended)

`mother's day song` EXACT is currently a $0.08 CPA star — but seasonality is past.
Add equivalent EXACT for upcoming Father's Day (June 15) and the next four occasions.

```csv
keyword,match,max_cpt
fathers day song,EXACT,2.00
father's day song,EXACT,2.00
song for dad,EXACT,1.50
song for fathers day,EXACT,2.00
graduation song,EXACT,1.50
```

Place in a new ad group named **`Seasonal Father's Day 2026`** (or reuse the
existing `Mother's Day` ad group if it still exists, paused).

---

## Expected impact (next 30 days)

| Lever                       | Effect                                                   |
| --------------------------- | -------------------------------------------------------- |
| Pause 4 losers              | -$50/mo waste                                            |
| Launch AI-gen EXACT (15 kw) | +$30-60/mo spend, target $3-5 CPA on 10-20 installs      |
| Father's Day EXACT (5 kw)   | +$15-30/mo spend, target $1-3 CPA pre-June 15            |
| **Net**                     | Comparable spend, expected 2-3× installs vs current week |

Pre-condition for installs to actually convert: the new 1.5.12 title
("Porizo: AI Song Gift Maker") + subtitle ("Personal AI Song & Voice Gifts") + new
keyword field must be LIVE on the store. They're prepped in ASC (versionId
`5226bb3e-6f59-47b4-a9c6-554cea226728`, PREPARE_FOR_SUBMISSION) but require
build 124 attachment + Apple review (~24-48h) before they reach users. Until
then, new ASA traffic lands on a listing titled "Personalized songs in
minutes" — relevance mismatch will hurt conversion.

**Recommendation**: ship the binary first (B3 — Distribution cert), then
launch this ASA campaign 24h after metadata goes live.

---

## File references

- `marketing/appstore/aso/spend-history/daily.json` — raw ASA telemetry
- `marketing/appstore/aso/keywords.json` — 315-keyword bank with effectiveness scores
- `ASO-competitor-analysis-report.html` — Suno/Donna/Muzio gap analysis
- `ASO-keyword-research-report.html` — full keyword research methodology
- `marketing/appstore/aso/launches/2026-05-12-phase1-painkiller-probe-LIVE.md` — current state of live ad groups
