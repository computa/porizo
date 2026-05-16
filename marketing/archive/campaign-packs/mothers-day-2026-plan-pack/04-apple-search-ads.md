# Apple Search Ads — Setup & Keyword Spec

**Budget:** $100/month total
**Goal:** App Store installs from competitor brand-defense + long-tail discovery searches
**Why ASA over Google:** App Store users have 50% higher install intent than web searchers. ASA average CPI in the personalized-song niche runs $4-12 (reasonable for $100 to test).

**DO NOT bid on head terms** ("custom song", "personalized song" alone) — Songfinch/Songlorious bid these to $30+ CPI and own them. We harvest the cheaper specifics.

---

## CAMPAIGN STRUCTURE (3 ad groups)

### Ad Group 1 — Competitor Brand Defense (60% of budget = $60/mo)

**Why:** Highest intent. Someone searching "songfinch" in the App Store is already convinced they want a personalized song. Cheapest CPI in this category.

**Match type:** Exact match (don't broad-match competitor names — wastes spend on irrelevant queries)

**Keywords:**
- `songfinch`
- `songfinch app`
- `songlorious`
- `songheart`
- `foreversong`
- `tunedforyou`
- `cameo song`
- `cameo songs`
- `cameo personalized`

**CPC bid:** Start at $1.50, raise to $3 if no impressions in 48h

**Creative set:**
- Default (App Store listing) is fine for v1
- Optional: custom product page emphasizing "in YOUR voice" as the moat (requires App Store Connect product page setup)

**Negative keywords:**
- `free`, `clone`, `download for free`, `apk`, `mod`

---

### Ad Group 2 — Long-tail Voice/Speed Differentiator (25% = $25/mo)

**Why:** Captures users searching for the moat directly. Very low competition.

**Match type:** Exact + Phrase

**Keywords:**
- `ai song in my voice`
- `personalized song in my voice`
- `song with my voice`
- `voice clone song`
- `instant song generator`
- `fast song maker`
- `last minute song gift`
- `quick song gift`

**CPC bid:** Start at $1.00

---

### Ad Group 3 — Occasion-Specific (15% = $15/mo)

**Why:** Mother's Day window is now. After May 11, shift this budget to Father's Day prep.

**Match type:** Phrase match

**Keywords:**
- `mothers day song`
- `birthday song app`
- `birthday song generator`
- `anniversary song`
- `wedding song generator`
- `graduation song`

**Negative keywords:**
- `lyrics`, `download`, `mp3`, `youtube` (these signal users looking for existing songs, not gift creation)

**CPC bid:** Start at $1.50; cap at $2.50 (these are slightly more competitive than Ad Group 2)

---

## SETUP STEPS (in App Store Connect)

1. Sign in to [Apple Search Ads Advanced](https://searchads.apple.com)
2. Create campaign → US storefront → "Search Results" placement
3. Daily budget: $3/day per ad group (auto-adjusts on weekends)
4. Set Cost Per Tap (CPT) bid as above
5. **Critical:** Enable "Search Match" OFF for Ad Groups 1 & 2 (we want exact targeting). Enable for Ad Group 3 to discover related occasion terms.
6. Attribution: enable Apple's API attribution + link to Branch / Adjust if you have one
7. Schedule: Run continuously; review every 7 days

---

## KILL CRITERIA (review weekly)

| Metric | Threshold | Action |
|---|---|---|
| CPI > $15 sustained 7 days | High | Cut keyword/group |
| TTR (tap-through rate) < 1% | Medium | Refresh creative or pause |
| Conversion rate < 25% (taps → installs) | Medium | Audit App Store listing — likely not the ad |
| Spend > $7/day | High | Lower CPC bids 20% |
| Installs ROAS < 1 (D7 retention × LTV) | Critical | Pause group |

---

## EXPECTED RESULTS (90% confidence)

- Ad Group 1 (competitor defense): 3-8 installs/wk at ~$5-8 CPI
- Ad Group 2 (voice/speed): 1-3 installs/wk at ~$3-7 CPI
- Ad Group 3 (occasion): variable — surges around holidays; otherwise quiet
- **Total expected:** 12-30 installs/month from $100 spend = $3-8 average CPI

This is significantly cheaper than Meta/Google because Apple Search Ads conversion rate (taps → installs) sits ~50% in personalized-song category vs ~3-5% for web ads.

---

## SECONDARY: GOOGLE ADS (DEFERRED, NOT FUNDED)

Document for future use; do NOT spend budget on Google in May. Google's web-to-app attribution is weaker than ASA's, and the $100/mo doesn't stretch across two networks.

When ready (likely after Mother's Day to test summer occasions):
- Google Search Ads: target `songfinch alternative`, `personalized song in my voice`, `ai song generator`
- Google Performance Max: feed your 7 new SEO landing pages as audience signals
- Budget: minimum $300/mo to be statistically meaningful
