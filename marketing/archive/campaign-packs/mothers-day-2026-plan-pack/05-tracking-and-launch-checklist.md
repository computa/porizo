# Tracking + Launch Checklist

**Window:** Day 0 = today (May 8). Mother's Day = Sunday May 11.

---

## DAY 0 (TODAY, May 8)

### Pre-flight (must be done before any traffic)
- [ ] Deploy Tier 1 + Tier 2 + Tier 3 changes (`git add public/ src/routes/legal.js && git commit && railway up`)
- [ ] Verify deploy: `curl -sI https://porizo.co/songfinch-alternative | head -1` returns `HTTP/2 200`
- [ ] Verify schema renders: visit https://porizo.co/mothers-day-song, view source, confirm JSON-LD block present
- [ ] Verify sitemap published: `curl -s https://porizo.co/sitemap.xml | grep -c "<loc>"` returns ≥18
- [ ] Verify llms.txt expanded: `curl -s https://porizo.co/llms.txt | wc -c` returns ≥6000
- [ ] Submit updated sitemap to Google Search Console (`https://porizo.co/sitemap.xml`)
- [ ] Submit updated sitemap to Bing Webmaster Tools

### Analytics (if not already)
- [ ] Confirm GA4 or Plausible is firing on porizo.co
- [ ] Confirm `/download` clicks are tracked as a conversion event
- [ ] Open App Store Connect → App Analytics → enable "App Referrer" if not on
- [ ] Note baseline: current 7-day visitors, current 7-day installs

### Asset prep (record + design today)
- [ ] Film Video 1 (your-voice surprise) — script in `01-tiktok-shorts-reels-scripts.md`
- [ ] Film Video 2 (POV format)
- [ ] Film Video 3 (group-song format) — needs 3+ family contributors; if not feasible, do a 4th variant of Video 1 instead
- [ ] Edit all 3 in CapCut (vertical 9:16, no TikTok-internal text overlays)
- [ ] Design 5 Pinterest pins (Canva templates → 1080×1620 PNG) — specs in `02-pinterest-pins.md`
- [ ] Draft Reddit post — copy-paste ready in `03-reddit-post.md`
- [ ] Set up Apple Search Ads campaigns (3 ad groups) — specs in `04-apple-search-ads.md`. **Don't activate yet** — schedule for Friday morning.

---

## DAY 1 (Fri May 9)

### Morning (8-10am PT)
- [ ] **Reddit post:** Submit to r/SideProject. Reply to every comment within 1 hour for the first 4 hours.
- [ ] **TikTok / Shorts / Reels:** Native upload Video 1 to all 3 platforms. Different captions per platform (variations in `01-tiktok-shorts-reels-scripts.md`).
- [ ] **Pinterest:** Pin 1, Pin 2, Pin 3 to "Mother's Day Gift Ideas" board. Space 4 hours apart.
- [ ] **Apple Search Ads:** Activate all 3 ad groups. Daily budget caps already set.

### Evening (6-8pm PT)
- [ ] Repost Video 1 to TikTok with new caption (yes, repost — TikTok rewards same-day re-uploads with different caption)
- [ ] Pin: Pin 4 (comparison)

### Tracking snapshot end-of-day (in spreadsheet)
- TikTok / Shorts / Reels: video plays, engagement rate, profile visits
- Pinterest: pin impressions, saves, clicks
- Reddit: upvotes, comments, link clicks
- ASA: impressions, taps, installs
- porizo.co: unique visitors, /download clicks, /mothers-day-song visits

---

## DAY 2 (Sat May 10)

### Morning
- [ ] **TikTok / Shorts / Reels:** Native upload Video 2 to all 3 platforms
- [ ] **Pinterest:** Pin 5 (recipe-card style)
- [ ] **Reddit:** Reply to overnight comments on Friday's post (engagement window)

### Evening
- [ ] **TikTok / Shorts / Reels:** Native upload Video 3 (or Video 1 variant if group song wasn't feasible)
- [ ] Repin top-performing Pinterest pin to "DIY Gift Ideas" board

### Decision point — 6pm Saturday
Of the 3-6 videos posted so far, identify the one with the highest **engagement rate** (likes+comments+shares / plays). If any video is ≥3% engagement, reserve $50 of TikTok Spark spend for Sunday.

---

## DAY 3 (SUNDAY MAY 11 — MOTHER'S DAY)

### Morning (6-8am PT — last-minute search peak)
- [ ] Re-share whichever video hit ≥3% engagement on TikTok with caption: "Last 12 hours of Mother's Day. Made in 3 minutes."
- [ ] Pin a new "Last hours of Mother's Day" themed pin

### Activate Spark Ads (8am PT)
- [ ] $50 TikTok Spark Ads on the highest-engagement video
- [ ] Audience: women 28-55 US, interest "Mother's Day", "personalized gifts", "Songfinch" lookalike
- [ ] Run 24 hours

### Capture content for Week 2
- [ ] **Every** real Porizo Mother's Day delivery today: ask the gifter for permission to film/share the recipient reaction. Aim for 5 new reaction clips by midnight.
- [ ] These become Week 2 content (replay TikTok cycle the following week)

### Evening
- [ ] Post results thread on Twitter/X: "We helped X moms hear a song from their kids today. Here are some reactions." (anonymized + permissioned)

---

## DAY 4 (MON MAY 12) — REVIEW + REPLAN

### Morning analysis
- [ ] Pull all metrics into one spreadsheet:

```
Channel        Spend  Impressions  Engagement  Clicks  Visits  Installs  CPI/CPV
TikTok org     $0
TikTok Spark   $50
Shorts org     $0
Reels org      $0
Pinterest org  $0
Pinterest ads  $0 (deferred)
Reddit org     $0
ASA           $20-25 (3-day spend)
TOTAL         ~$75
```

### Decisions for Week 2
- Top-performing video → Spark spend +$50 on Wed/Sat
- Bottom 2 Pinterest pins → kill, build 2 new variants
- ASA: review per-keyword CPI, pause anything >$15 CPI, raise bids on top performers
- Reddit: if r/SideProject post hit ≥50 upvotes → schedule r/AiBuilders post for Tuesday May 13

---

## ALWAYS-ON TRACKING (post-launch, weekly)

| Metric | Source | Cadence |
|---|---|---|
| Organic search clicks per page | Google Search Console | Weekly |
| Indexed pages | Google Search Console (Coverage) | Weekly |
| Schema validation | https://search.google.com/test/rich-results | After every deploy |
| Pinterest pin impressions | Pinterest Analytics | Weekly |
| TikTok video performance | TikTok Analytics | Daily during campaigns |
| ASA per-keyword CPI | Apple Search Ads dashboard | Weekly |
| App Store Connect installs by source | App Store Connect → Analytics → Sources | Weekly |

### Kill criteria (apply weekly)
- Any paid channel with CPI > $15 for 14 days → cut
- Any organic content type with engagement rate < 1% for 30 days → kill format, try new
- Any landing page with 0 organic clicks 60 days post-deploy → check indexing in GSC; if indexed but not ranking, rewrite

---

## WHAT TO DO IF MOTHER'S DAY UNDER-PERFORMS

If the May 8-11 push generates < 5 installs from new SEO + organic channels combined:
1. Verify deploy succeeded (HTTP 200 on all new pages, schema in source view, GSC sitemap submitted)
2. Verify videos were uploaded NATIVELY to each platform (not cross-posted with watermarks)
3. Verify Reddit post wasn't shadow-removed (check while logged out)
4. Re-test ASA with $50 added — competitor brand-defense should yield SOMETHING
5. If still nothing in 14 days → product/conversion problem, not channel problem. Audit /download → install funnel and onboarding completion rate.

The Mother's Day window is a **forcing function** for content production, not a make-or-break revenue moment. The 5+ reaction videos captured Sunday become the foundation for Father's Day (June 21) — that's the real prize.

---

## DEFERRED (NOT THIS WEEK)

- Google Ads — needs $300+/month to be meaningful
- Email list — wait until 1k/mo organic visitors
- Influencer outreach — wait until you have 10+ reaction clips as social proof
- Refer-a-friend in-app mechanic — needs 5k+ users for viral coefficient
- Blog cannibalization fix — see `tasks/blog-cannibalization-fix.md`, needs GSC data first
