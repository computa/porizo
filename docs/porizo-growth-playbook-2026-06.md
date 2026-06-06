# Porizo Growth Playbook — Viral Loop, Winners' Tactics, Gift-Bundle Pivot

**Date:** 2026-06-03 · Companion to `porizo-recovery-plan-2026-06.md`.
Fills the three gaps Ambrose flagged: (1) deep research on why the viral loop fails + how to fix it, (2) what _recent winners_ did that Porizo isn't, (3) a concrete one-off gift-bundle test. Incorporates the correction that **Porizo cannot currently do voice cloning** ("your voice" tech not ready).

---

## 0. The repositioning forced by the voice correction

Porizo **cannot deliver "a song in your voice" today** — the tech isn't ready. Consequences:

- **Stop promising it.** Audit App Store + marketing copy for any "your voice / sing in your voice / voice clone" language. It's a false promise (trust + App Store rejection risk) and competitors (AI Singer) own that claim anyway.
- **The wedge is NOT voice.** It is **speed + price + emotion**: _"The $150–330, 4–7-day custom-song gift (Songfinch/Songlorious) — instantly, for the price of a coffee."_ That price/speed gap is the hook for both TikTok and SEO.
- This **kills "Issue 5: voice moat"** as previously framed (commit-or-drop). Replaced below: position on instant emotional gifting, not voice.

---

## 1. Why the viral loop fails — and the redesign (research-backed)

**Data:** 39 recipients → 26 full listens → 26 saw "Save this song in Porizo" → **1 click → 0 installs/registrations.** K-factor ≈ 0. The loop is implemented but contributes nothing.

### Root causes (all present)

1. **Wrong offer.** "Save" is custodial and selfish-feeling; the recipient _already heard the song for free_, so saving a copy adds ~nothing. Winning gift loops use **reciprocity**: "make one back."
2. **Forced friction.** Any signup/PIN before value caps conversion (value-first onboarding converts ~2.5× better).
3. **Broken attribution.** A bare Smart App Banner (`web-player/index.html:39`, no `app-argument`) loses sender context across the App Store install → installers land on a generic home screen, not "make one back for [Sender]." Deferred deep linking is mandatory, not optional.
4. **No incentive.** No-reward recipients convert 8–12%; two-sided reward 15–22%.
5. **No social proof / dead-ends** (PIN gates, generic "Download the app").

### The redesign (prioritized)

1. **(Copy-only, ship first) Swap the offer:** "Save this song" → **"Make one back for [SenderFirstName] →"** at `web-player/index.html:140` (teaser) and `:289` (post-play), and the iOS `ShareClaimView.swift:209` text → real button. Cheapest test, largest expected lift; independently measurable by click-rate.
2. **Two-sided incentive:** "[Sender] sent you a song — **make your first one free**, and [Sender] gets a free one too when you finish." (give-get; targets 8–12% → 15–22%.)
3. **Deferred deep linking via AppsFlyer OneLink** (we already run AppsFlyer — config, not new SDK): generate share links as OneLink URLs carrying `deep_link_value=make_back` + `share_token`/sender id; on first launch route into the pre-filled "make one back for [Sender]" flow. This is the real engineering blocker; copy ships without it but registration-attribution stays 0 until it's wired.
4. **Defer signup** until the recipient taps "generate" (let them pick occasion/recipient/message first).
5. **Social proof** on landing + claim (⭐ rating + "X songs made" + 2–3 recipient quotes) — ~18% lift.
6. **Remove dead-ends:** any PIN-before-value, any generic context-less "Download the app."

**Realistic target:** recipient install+register c = 10–15% → K ≈ 0.10–0.15 (a real compounding supplement, not full virality). Instrument and A/B the CTA swap first.

**Case-study pattern:** every strong loop (BeReal, Locket, NGL, Remini, Lensa) gates install behind _something the recipient wants for themselves_ — make their own version / unlock an answer — never "save someone else's content." Porizo must make the recipient want **their own song to give**, not to keep this one.

---

## 2. What recent winners did that Porizo isn't (the gap list)

**The category was won on content + distribution, not tech.** Songfinch (human songwriters, 4–7 day wait, $199–264) beat everyone via TikTok. Suno/Remini won on instantly-shareable output + trend cycling.

### The winning engine (Songfinch, copyable today)

- **Channel:** TikTok organic UGC → Spark Ads amplification. ($0→$250K in 30 days; 24% lower CPC, 33% lower CPM than other platforms; later $3M/month.)
- **Format (THE format):** the **emotional reaction-reveal** — film the recipient's face the moment they hear their song ("I made my dad cry"). Raw, real, in-app — _not_ polished brand ads. Songfinch found this was their single most impactful format.
- **Seeding:** micro-creators (2K–50K followers), free credits, ~10% hit rate; put **$100–200/day Spark Ads behind the one winning clip**, scale only on 2×+ ROAS.
- **Cadence:** ≥3–5 posts/week (3–4/day if quality holds) on a brand/burner account — volume = cheap lottery tickets; first-hour engagement decides virality.

### Monetization that works (transactional, not subscription)

- Direct comp **Say It With A Song: $4.99/song, $9.99/3 credits.** AI Singer $6.99/mo. Human incumbents $150–330 one-off.
- **Sell the gift, gate at the reveal** (after a watermarked preview). One-off converts well; **personalized paywall (recipient's name) +17%**; **animated paywall 2.9×** vs static.
- Stack **add-on upsells** (premium animated art, longer cut, rush, physical card — Songlorious's model) to raise AOV without a subscription.

### THE GAP LIST (what every winner does that Porizo isn't) — prioritized

**P0 — the engine, this week**

1. **Reaction-reveal content at volume.** Winners' #1 install driver. Porizo has 1 video → **produce/source 20–50 reaction-reveal clips.** Format: setup → play → film their face/tears.
2. **Micro-creator seeding.** Porizo seeded 0 → **seed 10–20 micro-creators (2K–50K)** free credits, brief them on the reveal format, get usage rights.
3. **Posting cadence.** 1 video total → **≥1 reveal/day** on a brand burner account.

**P1 — amplify, within 2 weeks** 4. **Spark Ads on the winning creator clip** ($100–200/day), not brand-made ads. Authentic creator > brand ad. 5. **Credit-pack anchor** ($4.99 single / $9.99 3-pack pattern) so the single looks cheap. 6. **Add-on upsell stack** (art/length/rush/physical) for AOV.

**P2 — compounding, within a month** 7. **SEO comparison capture:** publish/insert "instant AI alternative to Songfinch" content; intercept people balking at $200 + 7-day waits. 8. **Native shareable output:** auto-export the reveal as a captioned vertical post-ready video so every buyer becomes a distributor (Suno/Remini's "output is the ad"). 9. **Trend/style cycling:** periodic new occasion/style "drops" (Father's-Day style, roast-song) as fresh TikTok hooks (Remini's model). 10. **Reddit** reaction reveals in r/MadeMeCry + gift subs (cheap, organic).

**The three to copy NOW:** reaction-reveal content at volume + micro-creator seeding + Spark Ads on the winner. That _is_ the Songfinch engine, and it's affordable.

---

## 3. Gift-bundle one-off test (the payment experiment Ambrose wants to run)

**Status:** infra exists (`gift_bundles`, `gift_orders`, `gift_wallet`, `song_transactions` — `migrations/pg/056`, `085`) but **no one has ever tried it.** Make it the primary purchase and test.

### Test design

- **Make the one-off gift the primary paywall CTA**, subscription demoted to a secondary "creator" tier (or hidden during the test).
- **Pricing to test:** single gift **~$7–12**, with a **3-pack anchor (~$15–20)** making the single look like a steal. (Comp: Say It With A Song $4.99 / $9.99-for-3.)
- **Paywall placement:** sell the gift **at the reveal**, after a free watermarked preview (value-first). Personalize with the recipient's name (+17%); use an animated paywall (2.9×).
- **Add-ons (phase 2):** premium art, longer song, rush, physical card.
- **Success metrics:** preview→purchase conversion rate; AOV; purchases/week. Baseline is ~0 (untried), so any signal is learning.
- **Measurement dependency:** the `daily_aggregates` rollup is broken (Issue 9a) — track purchases directly from `gift_orders` / `gift_wallet_transactions` / `purchase_receipts` until fixed.

---

## 4. Revised integrated priorities (supersedes Issue 5; complements the recovery plan)

| When      | Action                                                                           | Source       |
| --------- | -------------------------------------------------------------------------------- | ------------ |
| This week | Swap recipient CTA "Save"→"Make one back" + two-sided free-song incentive        | §1.1–1.2     |
| This week | Remove all "your voice" promises from store/marketing                            | §0           |
| This week | Stand up reaction-reveal content engine (20–50 clips) + start ≥1/day             | §2 P0        |
| This week | Stand up gift-bundle as primary paywall (test)                                   | §3           |
| ≤2 weeks  | Seed 10–20 micro-creators; Spark Ads on the winner                               | §2 P0–P1     |
| ≤2 weeks  | Wire AppsFlyer OneLink deferred deep link (attribution)                          | §1.3         |
| ≤1 month  | Credit-pack anchor + add-on upsells; SEO "vs Songfinch"; native shareable export | §2 P1–P2, §3 |

---

## Sources (selected)

Viral loop: [LinkTrace deferred deep links](https://linktrace.in/blog/deferred-deep-links-implementation-guide/), [AppsFlyer OneLink/deferred](https://www.appsflyer.com/products/deep-linking/deferred-deep-linking/), [Adapty value-first 2.5×](https://adapty.io/blog/how-to-fix-your-onboarding-flow/), [bloop double-sided incentives 15–22%](https://bloop.plus/blog/best-referral-incentives/), [AppsFlyer K-factor](https://www.appsflyer.com/glossary/k-factor/), [Now Playing Apps smart-banner app-argument](https://nowplayingapps.com/deep-link-from-smart-app-banner/).
Winners: [Pilothouse Songfinch case study](https://www.pilothouse.co/clients-success/songfinch-case-study), [TikTok for Business Songfinch](https://ads.tiktok.com/business/en-US/inspiration/songfinch-north-america), [Custom Song Songlorious](https://www.customsong.co/songlorious-after-shark-tank/), [TechCrunch Suno $300M ARR](https://techcrunch.com/2026/02/27/ai-music-generator-suno-hits-2-million-paid-subscribers-and-300m-in-annual-recurring-revenue/), [Accio Remini trend](https://www.accio.com/business/remini_tiktok_trend), [Say It With A Song](https://www.sayitwithasong.app/en/pages/home), [Adapty pricing models](https://adapty.io/blog/app-pricing-models/), [Startup Spells micro-creator seeding](https://startupspells.com/p/tiktok-shop-playbook-micro-influencers-whitelisting-product-seeding), [Buffer TikTok cadence](https://buffer.com/resources/how-often-should-you-post-on-tiktok/).
