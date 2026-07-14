# Positioning Review: From "App Store App" to "Song Gift Brand"

Date: 2026-07-14 · Owner: Ambrose · Status: PROPOSED (step-back review requested)
Supersedes the _acquisition center of gravity_ of `2026-07-14-appstore-visibility-turnaround-plan.md`; store-side hygiene from that plan (Phase 0) survives.

## 1. What the evidence says (all verified 2026-07-14)

### Internal (prod DB)

| Signal                               | Value                                                                                               | Read                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Users → created ≥1 song              | 40/79 (**51%**)                                                                                     | Activation is healthy                                                |
| Repeat creators                      | 14/40 (**35%**), 6.7 songs/creator                                                                  | People who arrive, stay and use it heavily                           |
| Share tokens claimed                 | 49/111 (**44%**)                                                                                    | Recipients open what they're sent                                    |
| Claims → recipient accounts          | 9/49 (**18%** — the big leak)                                                                       | Loop breaks at signup, not at interest                               |
| Recipient accounts → became creators | **5/9**, 4 re-shared                                                                                | The loop closes once someone signs up                                |
| Top occasions                        | i_love_you (60), celebration (60), thank_you (22), encouragement (20) vs birthday (27), wedding (2) | Product truth = _saying something to a person_, not calendar gifting |

### Market (research briefs, sources in session notes)

- **Two price poles:** human-written $45–$200 (Songfinch $199.99, ~$40M rev, 150K songs; Songlorious $45–195) vs **AI commodity $12–$30 on Etsy** — top AI-song shops have 13.2K and 6.1K reviews at **$19.99**. The market has already priced the AI song gift at ~$20. Porizo charges $1.99 — **10x below the proven clearing price**.
- **Songfinch has no app.** The category leader is a web checkout fed by Meta/TikTok paid + emotional **reaction-video UGC** (their TikTok creative: −24% CPC, −33% CPM; they raised daily spend 5,200% on it). Same web-first pattern for Wonderbly (Facebook = #1 channel after 20K WOM start), Crown & Paw (Meta + Google Shopping), Lovepop (SEO + micro-influencer seeding).
- **web2app is how small apps become big:** 82% of top-grossing apps monetize on web; RevenueCat 2026: 41% web-revenue adoption in top tier vs **1.3% in the smallest tier (31x gap)**. Benchmark funnel: ~13% reach paywall, ~3% purchase; Apple Pay in-funnel +20–30% conversion.
- **App Store organic is a ceiling, not a lever:** ~1,024 unique impressions/mo for us (96% search); Apple added more paid slots above organic (Mar 2026); ranking now weights retention. Nobody searches the App Store for a gift.
- **Cameo's collapse is the category's warning:** $100M rev → −80%, because occasion gifts are one-and-done and their flywheel (celebrity audiences) wasn't ours to copy. The structural answers: recipient loop, many-recipients-per-sender, occasion calendar.
- **Competitor watch:** giftsong.net (iOS, Apr 2026) leads with voice-cloned songs — the exact positioning we've ruled out (no tech + rejection risk). Suno ($300M ARR) owns "AI music creation tool"; not our lane. The gift lane at ~$20 web/Etsy has no dominant brand yet.
- **Seasonality:** gift categories do ~⅓ of annual revenue Oct–Dec; Valentine's ~$27.5B US; Songfinch's biggest pushes are Mother's/Father's Day. Our own Mother's Day week (7K impressions vs 300 baseline) confirms it reaches us too.

## 2. The diagnosis

The vision (message-first personal songs, recipient as the emotional anchor, viral recipient loop) is **validated by usage** — 51% activation, 35% repeat, 44% claim rate. What failed is a **distribution assumption**: that a gift product gets discovered in the App Store. Every winner in this category is a _gift brand with a web front door_; the app is where the product is experienced, not where it is found. We also mispriced: $1.99 can't fund any paid channel ($1.39 net vs ~$1.06 CPI leaves nothing), while the market pays $19.99 for the identical artifact on Etsy — margin that funds the exact UGC playbook the leader runs.

## 3. Positioning options considered

**A. Status quo, executed harder** — "Song Gift Maker" app, ASO + ASA climb (the existing turnaround plan). Kill as _primary_ strategy: the reachable pool is ~1K searchers/mo; even tripling it doesn't make a business. Keep only the $0 store hygiene.

**B. Gift-first web brand at market price — RECOMMENDED.** Porizo is _a gift you buy_, not _an app you download_. Web front door (quiz funnel: who's it for → occasion → your memory → hear a preview → pay → delivered as an unwrappable gift experience). Priced at the proven $9.99–$19.99 gift point as a bundle (full song + lyric card + shareable video). The iOS app becomes the creation studio and the recipient's keepsake surface. Acquisition: reaction-video UGC on TikTok/Meta → web checkout. This is the pattern every scaled comp validates, and web pricing is outside Apple's 30%.

**C. Emotional-messaging utility ("say what's hard to say").** Truest to our usage data (i_love_you/thank_you/encouragement dominate) and higher-frequency than calendar gifting — but "how do I say I love you" has weak commercial search intent and no $20 price anchor. **Verdict: not the commercial category, but the creative voice.** The ads and the funnel copy speak C ("some feelings are too big for a card"); the checkout sells B (a gift).

### Positioning statement (B powered by C)

> For anyone with something to say to someone they love — an occasion, or just because — **Porizo turns your memories into a real song with their name in it, in minutes.** Unlike $200 songwriter services or DIY AI tools, it's an affordable finished _gift_: delivered as a moment the recipient opens, keeps forever, and can answer with a song of their own.

Category occupied: **the song gift at the personalized-gift price point (~$20), bought on the web, experienced in the app.** Store tagline "Song Gift Maker" stays; the web headline is the emotional line.

### Platform architecture (confirmed 2026-07-14, validated live by yourlittlehum.com)

Live comp: **Little Hum** (yourlittlehum.com — Shopify store + quiz funnel at app.yourlittlehum.com, "35,000+ customers", email/private-link delivery, 7-day turnaround, reaction-video social proof, **no mobile app at all**).

- **Web = storefront.** Quiz funnel → pay → song delivered as a link. The buyer never needs to install anything.
- **Share link = delivery, web-play-first.** The recipient link must play in ANY browser (Android/desktop included) so the gift moment never hits an install wall. ⚠️ Change required: current share landing is app-only (device-binding rework) — relax to web-play with "Keep this song forever → get the app" as the claim upgrade.
- **Apps = keepsake + studio + repeat engine.** iOS now; Android later via the existing Skip Fuse plan (`2026-06-30-001`) — NOT a blocker for the web launch. The apps are the moat vs Little Hum (their product ends at a link; ours gives the song a home and lets the recipient answer with a song of their own).
- **Sharpest funnel wedge vs comps:** instant free preview + minutes-not-days delivery (Little Hum: 7 days, no preview; Songfinch: $199, 4–7 days).

## 4. Execution plan

### Phase R0 — Cheapest possible price/demand validation (weeks 1–2, ~$0)

1. **Etsy wedge test.** List "Personalized Song Gift — their name & your story in a real song, delivered in 24h" at $19.99 (undercut nothing; match the clearing price). Etsy already aggregates the demand (5K+ listings, 13K-review shops); zero funnel build. Fulfil through the existing pipeline; deliver MP3 + Porizo share link (recipient experience intact → loop still fires).
2. **Keyword truth.** Pull exact volumes/CPCs from Google Keyword Planner for: custom song, custom song gift, personalized song, song for mom, song with her name in it, anniversary song gift. (Both research agents flagged this as the one unverifiable number.)
3. **Reaction-creative pipeline.** Ask the 14 repeat creators + recipients (in-app prompt / email) for permission-based reaction clips; storyboard 3–5 reaction-style UGC ads (Hook-25 is kinetic-type — good, but the category's proven format is _someone crying at their song_).
4. Keep from old plan: attach new screenshots to 1.5.27, featuring nomination, icon PPO — $0, do once, stop iterating store assets.

- **Gate:** ≥10 Etsy sales at $19.99 (or ≥$100 revenue) in 3 weeks → price point confirmed for Phase R1. Zero sales at any price → the $20 anchor is wrong for AI-perceived quality; test $9.99 before concluding.

### Phase R1 — Web front door (weeks 2–6)

5. Landing + quiz funnel on porizo.co: recipient → occasion → 2–3 memory prompts → **hear a 15s preview free** (we already have the cheap-preview pipeline — this is our structural edge; Songfinch can't preview, Etsy sellers take 24h) → Apple Pay/Stripe checkout $14.99–19.99 gift bundle.
6. Build hand-rolled on the existing Fastify backend (we own rendering + share tokens already; FunnelFox/Adapty only if speed demands).
7. Delivery = existing share-token recipient experience; buyer optionally installs the app (studio), recipient gets the app-wall → claim flow we already shipped.
8. **Fix the loop leak** found in the data: 49 claims → 9 accounts (82% drop). Post-listen CTA "make one for someone you love — hear it free," magic-link signup (just fixed in prod), measure claim→account weekly.
9. Pricing coexistence: app IAP stays $1.99 for now (it's the in-app creator hook); the web sells the _gift bundle_ (song + lyric card + video + gift delivery), so the offers differ by packaging, not just price. Revisit IAP once web price is proven.

- **Gate:** funnel visit→purchase ≥1.5% (benchmark ~3%) at ≥$9.99 → open paid spend.

### Phase R2 — Paid ignition on reaction UGC (weeks 6–12)

10. Meta + TikTok, $10–20/day, creative = permission-based reaction clips + preview-quiz hook ("we put her name in a song — watch her face"). Optimize to web purchase (clean attribution, no SKAN fog).
11. Creator seeding per the median-views rule; offer free gift songs to micro-creators for reaction content; TikTok Shop listing when GMV mechanics make sense.
12. **Economics that make this possible:** $19.99 web − ~3% Stripe − ~$0.25 COGS ≈ **$19 margin → CAC breakeven ~$19 vs $1.39 today (14x headroom)**.

- **Gate:** blended CAC < $10 at ≥$14.99 AOV over 2 weeks → scale toward seasonal calendar; else pause spend, iterate creative only.

### Phase R3 — Seasonal machine + repeat engine (Aug → Nov 1 hard deadline)

13. Calendar: Grandparents Day (Sep) dry-run → **Christmas (the ⅓-of-year window)** → Valentine's → Mother's Day. Seasonal funnels (occasion-specific quiz variants), In-App Events, CPPs — reuse `seasonal-aso` skill; everything live by Nov 1.
14. Repeat engine (the anti-Cameo work): occasion reminders for people you've gifted ("Sarah's birthday is in 2 weeks — this year, verse 2"), multi-recipient prompts, gift cards for the "I want to gift the experience" buyer.
15. B2B/weddings flank (planners/DJs, corporate) only after consumer funnel is proven — Songfinch validates the line exists.

### Measurement

Weekly: web funnel (visits → preview → purchase), CAC/AOV by channel, claim→account→creator loop rates from prod DB, Etsy sales, plus the existing rank-track + ASC timeseries (now as a secondary channel). Friday `/marketing status` verdict per phase.

## 5. Kill criteria / honesty checks

- R0: no Etsy sales at $19.99 *and* none at $9.99 in 6 weeks → the willingness-to-pay thesis is wrong; the product competes at impulse pricing and needs a volume/free-tier strategy instead of a gift-brand strategy.
- R2: CAC > $25 across 3 creative iterations → paid social doesn't work for us at this AOV; fall back to pure organic UGC + seasonal + marketplace (Etsy) presence.
- Loop: if claim→account stays <25% after the R1 fixes, the recipient loop is not a growth engine — treat shares as retention, not acquisition.
- Standing constraint: **no voice-clone positioning ever** (giftsong.net can have that risk); no hard price claims in creative (storefront-dependent).
