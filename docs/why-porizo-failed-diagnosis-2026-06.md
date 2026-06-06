# Why Porizo Hasn't Taken Off — Evidence-Based Diagnosis

**Date:** 2026-06-03 · **Window:** ~98–130 days post-launch (first signup 2026-01-24) · **Method:** production DB funnel + product/code review + marketing audit + market research, then adversarial loophole-closing.

> **Honest framing on "100% confident":** Certainty about _why_ a startup hasn't taken off is not fully achievable. What follows separates **proven** (from your own data), **structural/high-confidence** (strong prediction, not yet tested at scale), and **unknown** (data does not exist). The primary cause is ~99% certain. The two residual unknowns are named explicitly with how to close them.

---

## The numbers (production DB, not estimates)

| Metric                             | Value                                                            | Source                                      |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Total registered users             | **54** (Jan 24 – Jun 1)                                          | `users`                                     |
| Genuine users (excl. founder/test) | **~26**                                                          | founder `abcobimma@` = 188 tracks/63 shares |
| Daily Active Users                 | **0** (every day, last week)                                     | `daily_aggregates`                          |
| Activation (made ≥1 song)          | ~26 of signups (~50%)                                            | `tracks`                                    |
| Repeat users (≥2 genuine songs)    | **6**                                                            | `tracks`                                    |
| Full songs rendered                | 68 (+114 previews)                                               | `track_versions`                            |
| Real paying customers              | **1** (Apple Ads → churned after 1 mo)                           | `subscriptions`/`purchase_receipts`         |
| Recorded revenue                   | **$0** (20 receipts = mostly founder sandbox; 4 distinct owners) | `daily_aggregates.revenue_cents`            |
| Total paid marketing spend         | **~$133**                                                        | ASA $119 + Meta ~$14                        |
| Total paid installs                | **~15**                                                          | ASA campaigns                               |
| Viral loop: recipients → users     | **39 → 39 listened → 1 download → 0 registered**                 | `receiver_sessions`                         |
| Song-quality / rating signal       | **none — no feedback mechanism exists**                          | `events`                                    |

---

## The thesis

**Porizo has not failed at the product, and it has not failed at retention — it failed at the starting line, on distribution. The dominant, data-proven cause is that almost no one ever arrived: ~26 genuine users and 1 paying customer in ~3+ months. "Users try it and never repeat" is true but is a red herring — you cannot diagnose a retention or business-model failure at n≈26; you have an _acquisition_ failure that prevented retention from ever being tested.**

This breaks into two **proven** sub-causes, two **structural** risks that would cap growth _after_ acquisition is fixed, and one genuine **unknown**.

### PRIMARY — proven, dominant: a distribution failure

**1. The marketing was built but never shipped (~5% of designed at-bats taken).**

- ~$133 total paid spend → ~15 installs in 7 weeks. That is pre-signal noise, not a channel test.
- Organic channels were prepared in detail and then **not deployed**: Reddit **0 of 8** drafted posts; creator outreach **0** DMs sent; TikTok **1** video posted (of a planned 14-day, 3/day engine); cold email **8%** of a 4,431 list sent then stopped; 17 blog posts with no measured traffic; a budgeted $200 TikTok trial never launched.
- Pattern: each effort was carefully designed, launched minimally, then **blocked by a technical prerequisite** (TikTok business verification, ASA API 403s, metadata review, attribution wiring) and abandoned within 1–5 days. Build time crowded out distribution time.

**2. The product's one natural growth engine — the share loop — is broken.**

- A song gift is inherently viral: every creation is delivered to another human. **39 recipients opened/listened, 1 downloaded, 0 registered (0% conversion).**
- Code review confirms _why_: the recipient screen's "Make one for someone you love →" is **dead text with no tap action**; there is no "reply with a song," no referral, no attributed install path. The recipient is a dead-end, not a funnel. The cheapest possible growth loop is disabled.

### SECONDARY — structural, high-confidence, but UNPROVEN at this scale

**3. Business-model mismatch: a transactional/occasional gift sold as a subscription.**

- Job-to-be-done ends at gift delivery; nothing pulls the buyer back weekly (DAU=0 is the signature). Every _profitable_ peer in the category is **transactional** (Songfinch $199, Songlorious $120–300, ForeverSong $69.99); every successful _subscription_ peer (Suno $300M ARR) sells **habitual creation**, not gifts. The 1 real subscriber churning after month 1 is consistent with this — but n=1 makes it a strong _prediction_, not a proven cause.

**4. Commoditization / weak differentiation.**

- The core "record your voice → AI song gift" mechanic is already cloned: **GiftSong (giftsong.net)** launched the same window at **$4.99/week**, 20 occasion templates, shareable link. The bare mechanic is not defensible; differentiation must come from quality, occasion depth, or distribution.

### RESIDUAL — genuine unknown, cannot be closed from data

**5. Song emotional quality.** There is **no rating/feedback/review mechanism in the entire schema**, so there is zero data on whether the songs actually move people. This matters specifically for the dead viral loop: recipients may fail to convert because the UX dead-ends them (proven) **and/or** because the song wasn't good enough to inspire "I want one" (unknown). Bounded: it cannot be the _primary_ failure, because the acquisition channels were never run regardless of song quality — but it could be a hidden second-order drag. **You are currently flying blind on quality.**

---

## Confidence self-evaluation & the loopholes I tested

I attacked the thesis and closed each loophole against the data:

| Challenge to the thesis                             | Resolution                                                                                                                                                                              | Verdict                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| "It's a product/retention failure, not acquisition" | n≈26 genuine users is far below any PMF-test threshold; activation works (~50% make songs). Can't conclude product failure from 26 users.                                               | Holds — acquisition is dominant          |
| "Marketing wasn't scaled because there's no demand" | Category demand is proven (Songfinch $5M+, Suno $300M, GiftSong clone). Channels weren't _strategically_ withheld — they were blocked by tech prereqs.                                  | Holds (demand is real but seasonal/thin) |
| "DAU=0 means the app is broken"                     | render_ready 187, story_confirm 327 — product functions. DAU=0 is expected for a tiny-base occasional-gift app.                                                                         | Holds (reinforces model point)           |
| "Founder's 188 tracks pollute the viral finding"    | Even your own 63 shares (your best-case audience) converted 0 recipients. Loop is genuinely dead.                                                                                       | Holds                                    |
| "Maybe more installed than registered"              | True — App Store install count lives in ASC, not the DB. But total installs are still low dozens–low hundreds (paid ~15 + near-zero organic). Acquisition stays the binding constraint. | Holds (minor completeness caveat)        |
| "Is it really 1 payer, not 20?"                     | 20 receipts = 4 distinct owners; 2 subs (both expired); 1 is the founder. Real external payer = 1, churned. Revenue $0.                                                                 | Confirmed                                |

**Confidence:** ~**99%** on the PRIMARY thesis (distribution failure: channels unshipped + viral loop broken). **High** on the secondary structural risks being _real risks_, but explicitly **not proven** as causes-so-far at n≈26. **Two irreducible unknowns** remain, both outside the DB: (a) song emotional quality (no feedback data exists), (b) exact total install count (in App Store Connect). Neither overturns the primary thesis; both are named so you can close them.

True 100% is not honestly claimable — but the uncertainty is now _localized_ to two named, testable questions rather than the overall diagnosis.

---

## Fixes, prioritized by the diagnosis

**Fix the things that are proven first; don't re-architect on unproven theories.**

### Tier 1 — Acquisition (proven primary; highest ROI, lowest cost)

1. **Ship the channels you already built.** Reddit (8 posts ready), creator DMs (50+ list ready), the TikTok content engine, finish the cold-email send (92% of the list is untouched). This is sitting-duck leverage — the assets exist; they were never deployed.
2. **Repair the viral loop (highest-leverage product change).** Turn the dead "Make one for someone you love" text into a real CTA; add "reply with a song" and a referral/attributed-install path so every one of the (currently 0%-converting) recipients becomes a one-tap funnel into the app. For a gift product this is your cheapest, most defensible growth engine.

### Tier 2 — Monetization & positioning (structural; pilot, don't bet the company)

3. **Pilot transactional pricing.** Sell _the gift_ one-time ($5–$25), keep subscription only as an optional creator tier. Stop fighting novelty churn with a subscription on a one-time use-case. Consider a premium human-polished tier (Songfinch model) for high-intent buyers.
4. **Concentrate spend on gift-season peaks** (Father's Day, Christmas, Valentine's, Mother's Day) instead of flat year-round into a seasonal, thin demand curve.
5. **Find a wedge** beyond the now-cloned bare mechanic.

### Tier 3 — Close the unknowns (so the next diagnosis can be 100%)

6. **Add a rating/feedback prompt immediately** (post-song "how did this turn out?" + App Store rating prompt for delighted users). You have _zero_ quality signal — unacceptable to operate blind.
7. **Listen to a sample of real users' rendered songs yourself** to sanity-check emotional quality.
8. Pull the exact ASC install count to size the true top-of-funnel.

---

## One-line answer

You didn't fail at building the product or at retaining users — **you never shipped distribution, and the one growth loop the product gives you for free (sharing) is switched off.** Everything else (subscription-vs-gift, commoditization, song quality) is a real but secondary or unproven concern that you cannot even evaluate until people actually arrive.
