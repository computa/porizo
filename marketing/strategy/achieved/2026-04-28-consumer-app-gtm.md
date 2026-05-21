# Consumer App GTM — Porizo (2026-04-28)

**Author context:** Apple Search Ads spec compliance was completed today. After 7 days of paid traffic ($15/day, 4 campaigns) the data is unforgiving: 1.3k impressions, ~16 taps (1.0% TTR is OK), but 1 install and effectively 0 verified registrations. The bottleneck is no longer media — it's product-funnel + content.

---

## 1. The framework: 4-layer GTM stack for consumer apps

Consumer apps live or die on a *sequenced* loop. Skipping layers and starting with paid ads is the indie-failure pattern Porizo is currently in.

| Layer | Purpose | Cost | When |
|---|---|---|---|
| **L1. Magic-moment product flow** | First 60s = wow, no walls. Defer auth + heavy enrollment. | $0, eng time | Week 0 |
| **L2. Content / UGC engine** | Reaction-reveal TikToks, Reddit drops, founder-led posts. *Demand creation.* | $0 cash | Week 1 |
| **L3. ASO + landing-page SEO** | Owned + compounding. Capture intent ("song for mom"). | $0, eng + copy time | Week 1-2 |
| **L4. Paid amplification** | Only after L1+L2+L3 prove which message converts. ASA + Meta to scale winners. | $$$ | Month 2+ |

**Sequencing rules:**
- Don't skip layers. Paid into a leaky funnel just burns cash faster.
- Hold paid spend ≤ $5/day until L1 fix ships — current effective CPI > $50.
- Mother's Day is a 10-day exception (see §6).

---

## 2. Why consumer apps die at L1 (registration funnel)

Compounding drop-off, mid-range benchmarks ([Amra & Elma](https://www.amraandelma.com/funnel-drop-off-rate-statistics/), [Zuko](https://www.zuko.io/blog/25-conversion-rate-statistics-you-need)):

| Step | Loss | Cumulative survival |
|---|---|---|
| Install → first launch | ~10% | 90% |
| Auth wall | 30-50% | 45-63% |
| Multi-step enrollment (6+ steps) | 30-50% | 22-44% |
| First "value moment" reached | — | **~20-40% of installers** |

For Porizo's current flow (auth → 6-10 phrase voice enrollment → create), the math suggests **20-25% of installers ever hear a song**. The other 75-80% are silent churn before measuring anything else.

### Auth provider friction (lowest → highest)
1. Sign in with Apple — Face ID, ~2s, zero typing
2. Google One-Tap
3. Phone OTP (>5% SMS-delivery failure, >30s typical time)
4. Email + password (10%+ password-field abandonment)

Adding social login lifts sign-up **20-40%** ([OwnID](https://www.ownid.com/blog/the-impact-on-user-experience-and-conversion-rates)).

### "Show value before sign-up" is the dominant pattern
Apps that defer the auth wall ship measurable wins:

| App | Pre-auth value | Trigger to sign up |
|---|---|---|
| TikTok | Full algorithmic feed | Like / follow / comment |
| Duolingo | Full first lesson | "Save your progress" (soft, "Later" button) |
| Lensa | One AI avatar preview | "Want more / unblur" |
| Cal AI | Quiz + macro plan | Trial paywall |
| Pinterest (Casey Winters) | Curated topic feed | Save a pin |

**Documented A/B wins:**
- Duolingo delayed sign-up: signup +20% relative, **D1 retention +20%** ([Taplytics](https://taplytics.com/blog/duolingo-ab-test-onboarding/))
- Duolingo "Later" button replacing red "Discard": **+8.2% DAU** ([First Round](https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker/))

### Voice enrollment best practice
ElevenLabs Instant Voice Clone needs ~30s of audio. The norm is *minimum-viable enrollment first, deeper enrollment as upgrade*. Porizo's 6-10 phrase upfront is the outlier — and an L1 friction point worth attacking.

---

## 3. Demand-creation channels (L2) ranked for Porizo

| # | Channel | Likely 2-week impact | Effort | Why it fits |
|---|---|---|---|---|
| 1 | **TikTok organic, reaction-reveal** | 3-10k views/post, 50-300 installs if hit lands | High (3 posts/day, 14 days) | The product IS the hook — recipient reactions to a song sung in your voice are inherently shareable. Nomadtable did $30k MRR, Tryp 20k+ downloads, both founder-led TikTok. |
| 2 | **Reddit organic** | 100-1k click-throughs per accepted post | Medium | r/SideProject, r/giftideas, r/Mommit, r/AskWomenOver30. Lead with the song, not the app. |
| 3 | **ASO + landing-page SEO** | Compounds 3-12 months | Low-medium (one-time) | Owned channel; Mother's Day-specific search volume is high in May. |
| 4 | **Pinterest gift boards** | Long-tail seasonal | Low | Pinterest "Mother's Day gift ideas" boards drive Etsy gift behavior. Porizo fits. |
| 5 | **Micro-creator gifting** | 3-10 reaction posts | Medium | DM 20 mom/relationship micro-creators (5-50k), give credits, ask for "mom's reaction." |
| 6 | **PR angle** | Lottery ticket | High | "Hallmark for the AI era" or "make your mom cry in 60 seconds" framing. Cardgenie/Vouchr got press doing this. |

**Ranked-out for now:** Meta Ads (already shipped SDK but burned $78 with 0 conversions; needs L1 fix first), Google UAC (same), influencer paid posts ($$$).

---

## 4. ASO + landing page (L3) — concrete shifts

### App Store front-door
- **Title/subtitle now → Mother's Day-aware variant:** "Porizo: Song Gift for Mom" through May 12, then revert.
- **Subtitle keyword refresh:** "personalized song", "song for mom", "birthday song", "anniversary gift".
- **Screenshot priority:** ship the "Make her cry in 60s" headline as slide 1 if A/B allowed. The Cal-AI-style bold-headline redesign already in `tasks/todo.md` aligns with this.
- **CPP v2 review status:** spec calls out v2 CPPs in WAITING_FOR_REVIEW. Don't run paid Mother's Day until they approve OR fall back to default product page with the new screenshots.

### Landing page — `porizo.co/mothers-day`
- 3 sample songs embedded above the fold
- "Make hers in 90s" CTA → smart-link to App Store
- Pinterest-pinnable hero image
- Schema markup for searchability

---

## 5. Porizo-specific 2-week plan ($0 incremental)

### L1 — magic-moment product fixes (highest leverage)
1. **Defer auth wall.** Let a fresh user tap *Create* → sample message → song result with stock voice in <60s. *Then* present Apple Sign-In with copy "Save this song." Expected lift by analogy to Duolingo: +15-25% sign-up, +15-20% D1 retention.
2. **Defer voice enrollment.** Frame the 6-10 phrase enrollment as an upgrade ("Make it sound like you") triggered AFTER first song heard. Use a 1-phrase quick clone or stock voice for the first song.
3. **Ship the funnel analytics events** already specced in `tasks/todo.md` (Funnel Analytics Wire-Up — auth_completed, create_started, create_completed, first_song_completed). Without these we can't measure the L1 fixes.

### L2 — content engine
4. **3 TikToks/day for 14 days from 1-3 accounts.** Hook formula: *"I made my mom cry with this in 60s 😭"* → screen-record app → play song → cut to mom's reaction. Reaction-reveal is the proven viral format ([Newsweek HAVEN case](https://www.newsweek.com/entertainment/biggest-song-social-media-made-ai-11079291)).
5. **4 Reddit posts** in week 1: r/SideProject (launch), r/Mommit, r/AskWomenOver30, r/giftideas. Lead with a real song. Don't pitch the app.
6. **DM 20 micro-creators** — free credits + "post your mom's reaction." Aim for 3 posts.

### L3 — ASO + landing
7. **Ship `porizo.co/mothers-day`** — 3 sample songs, "Make hers in 90s" CTA, schema markup.
8. **App Store metadata refresh** for Mother's Day window.

### L4 — paid (minimized)
9. **Cut ASA to $3/day Brand-only defense** for the next 7 days while L1 fixes ship.
10. **Mother's Day reactivation:** at T-7 days, push only the Mother's Day campaign back to $10/day with exact-match high-intent ("mothers day song", "song for mom") IF v2 CPPs are approved by then.

---

## 6. Mother's Day micro-window (10 days, May 11)

| When | Action |
|---|---|
| **T-10 → T-7** (now) | 3 reaction TikToks/day. Push `porizo.co/mothers-day` on Pinterest + r/Mommit + r/giftideas. Ship L1 magic-moment fix. |
| **T-7 → T-3** | Pause Discovery + Gift Category. Reallocate to Mother's Day exact-match at $10/day. CPP v2 should be approved by now (submitted Apr 28). |
| **T-3 → T-1** | Last-minute panic angle: *"Forgot Mother's Day? Make a song in 90 seconds."* (~30% of holiday purchases happen the final week — [Klaviyo](https://www.klaviyo.com/blog/mothers-day-emails)) |
| **T-0** | DM every TestFlight beta + supporter to post a reaction. |

---

## 7. Verdict on Apple Search Ads

**At $15/day across 4 campaigns: cargo-culting.** Practical floor for ASA learning is ~$500/mo. Below that, variance > signal. ASA only works once (a) ASO metadata gives Apple relevance signal, lowering CPT, and (b) you can measure LTV per keyword.

**Action:** keep Brand at $2-3/day for defense. Pause Discovery + Gift Category until L1 ships. Holding Mother's Day for the 10-day window per §6.

---

## 8. Prioritized bet list (3-5 most leveraged moves)

| # | Bet | Cost | Effort | Expected impact (4 weeks) |
|---|---|---|---|---|
| 1 | **Defer auth + enrollment in onboarding** (L1) | $0 | 2-3 eng days | +15-25% activation, +15-20% D1 retention. Compounds every channel below. |
| 2 | **TikTok reaction-reveal series, 14 days** (L2) | $0 | ~14 hrs/week | 0-1k installs (lottery ceiling 5-10k); first organic install signal. |
| 3 | **Mother's Day landing page + ASO refresh** (L3) | $0 | 1-2 days | 50-300 installs over 10-day window; compounds for next year. |
| 4 | **Cut ASA from $15 → $3/day Brand-only** | -$12/day saved | 5 min | Stops bleeding while L1 ships. Redeploy to creator gifting (#5). |
| 5 | **Micro-creator gifting (20 DMs)** (L2) | $0 (credits) | 3 hrs | 3-5 reaction posts; one could break out. |

Bets 1+4 are no-brainer ship-this-week. Bet 3 is the Mother's Day timing-locked move. Bets 2+5 are higher variance but the only realistic path to demand creation at this stage.

---

## 9. What NOT to do

- ❌ Increase ASA spend before L1 ships
- ❌ Launch Meta Ads at meaningful spend before L1 ships (current Meta SDK is correctly instrumented but funnel will leak)
- ❌ Hire a paid agency or growth consultant ($3-10k/mo) — the bottleneck is product/funnel, not media
- ❌ Build new features beyond what L1 demands — fix activation first
- ❌ Run influencer paid posts >$500/post — micro-creator gifting tests the channel first

---

## 10. References

- [2025 TikTok Organic Growth Report](https://www.socialgrowthengineers.com/2025-tiktok-organic-growth-report-lessons-trends-and-the-road-to-2026)
- [Apple Search Ads Indie Guide — Sonar](https://trysonar.app/blog/apple-search-ads-guide)
- [HAVEN viral AI song — Newsweek](https://www.newsweek.com/entertainment/biggest-song-social-media-made-ai-11079291)
- [Mother's Day Marketing Playbook — Klaviyo](https://www.klaviyo.com/blog/mothers-day-emails)
- [Funnel drop-off statistics — Amra & Elma](https://www.amraandelma.com/funnel-drop-off-rate-statistics/)
- [Login friction kills conversion — Corbado](https://www.corbado.com/blog/login-friction-kills-conversion)
- [Casey Winters / Pinterest activation — Appcues](https://www.appcues.com/blog/casey-winters-pinterest-user-onboarding)
- [Lenny Rachitsky — activation metric](https://www.lennysnewsletter.com/p/how-to-determine-your-activation)
- [Duolingo A/B win — Taplytics](https://taplytics.com/blog/duolingo-ab-test-onboarding/)
- [Reverse trials — OpenView](https://openviewpartners.com/blog/your-guide-to-reverse-trials/)
- [Reddit launch playbook — Founder to Founder](https://readfoundertofounder.com/p/how-i-used-reddit-to-get-our-first-1-000-customers)

---

*Next step: confirm with user which of the 5 prioritized bets to start, then break each into a `tasks/` plan.*
