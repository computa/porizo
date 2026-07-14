---
title: "feat: Web-first pivot — execution plan"
date: 2026-07-14
type: feat
origin: docs/plans/2026-07-14-repositioning-review-gift-first-web-funnel.md
depth: deep
---

# Web-First Pivot — Execution Plan

The repositioning doc decided **what** (gift-first web brand at market price, apps as keepsake/studio). The spec (`specs/web-funnel-spec.md`) decides **how it works**. This doc decides **in what order, with whose time, against which gates.** Companion build order: `docs/plans/2026-07-14-002-feat-web-funnel-implementation-plan.md`.

Solo-founder reality: one builder (Ambrose + Claude), ~$150–500/mo discretionary spend until revenue justifies more. Every workstream below is sized for that.

---

## Workstreams at a glance

| WS  | Name                      | Outcome                                                         | Window         |
| --- | ------------------------- | --------------------------------------------------------------- | -------------- |
| A   | Demand & price validation | Proof people pay ~$20 for our song, before the funnel exists    | Week 1–3       |
| B   | Build the storefront      | The funnel live behind a flag, E2E on Stripe test mode          | Week 1–4       |
| C   | Creative engine           | 3–5 reaction-style ads + permission pipeline for real reactions | Week 1–ongoing |
| D   | Soft launch & tune        | Real traffic, real purchases, funnel instrumented and iterated  | Week 4–6       |
| E   | Scale & seasonal          | Spend scales on ROAS; Christmas machine live by Nov 1           | Week 6–Nov 1   |
| F   | Loop & apps               | Recipient claim leak fixed; Android decision                    | Week 6+        |

---

## WS-A: Demand & price validation (starts NOW, no code dependency)

1. **Etsy wedge listing** (from the repositioning doc — now operationalized): "Personalized Song Gift — their name & your story in a real song, delivered same day" at **$19.99**. Fulfilment is manual: buyer's Etsy message answers → create the song in-app/admin → deliver MP3 + `/play` link. Same-day delivery is itself a differentiator on Etsy (top shops quote 24h+).
   - Effort: ~half a day to list; minutes per order.
   - Also validates: delivery-by-link UX with real strangers before our own funnel ships.
2. **Keyword truth**: pull Google Keyword Planner / SEMrush volumes + CPCs for: custom song, custom song gift, personalized song, song for mom/grandma, anniversary song, song with her name in it. (The one number research couldn't verify; shapes WS-E's Google layer.)
3. **Stripe + Turnstile accounts** provisioned (test + live keys into Railway env) — WS-B dependency, zero-cost.
4. **Pricing decision input**: Etsy sales at $19.99 → launch web at $19.99; Etsy silent but traffic exists → test $14.99; total silence → pause WS-D spend and investigate positioning before burning ad budget (kill-gate below).

**Gate A (week 3):** ≥10 Etsy sales OR ≥$100 revenue → price validated. 0 sales at both price points with ≥200 listing visits → STOP: the willingness-to-pay thesis fails; reconvene on impulse-pricing/volume strategy before WS-D spends a dollar.

## WS-B: Build (weeks 1–4)

Execute the implementation plan in its dependency order: U1–U3 (identity + free preview, staging E2E unpaid) → U4–U6 (Stripe + orchestrator + refund automation) → U7 (gift playback) → U8–U11 (SPA) → U12–U13 (analytics + CTAs) → U14 (hardening gate).

- **Definition of "built":** the U14 launch-readiness checklist passes — including the webview purchase matrix and the render-fail→automatic-refund E2E. Not before.
- **Design gates inside the build:** impeccable `critique` + `audit` on landing/funnel//play; the AI-slop test on the landing ("is this distinguishable from the modal AI gift site?" — the dim is the answer); screenshot baselines locked.
- Deploy posture: everything ships to prod continuously behind `web_funnel_enabled=off`; the flag flip IS the launch.

**Gate B (end week 4):** staging E2E green ×2 (happy + refund paths), webview matrix pass → flip-ready.

## WS-C: Creative engine (parallel from week 1 — the funnel is worthless without traffic)

1. **Permission pipeline for real reactions** (the category's proven creative): in-app + email ask to the 14 repeat creators and recent recipients — "share the reaction, get a song credit." Target: 5 usable clips by week 4.
2. **Interim ad set** (before real reactions exist): 3 concepts ×2 cuts from existing assets — (a) Hook-25 kinetic recut with funnel CTA + end-card "hear a preview free", (b) screen-capture ad: the funnel itself making a song for "Mum" with the dim + preview moment (product-as-ad — we're the only ones who can show _hearing it before paying_), (c) UGC-style selfie ad (scripted, honest: "I made my mum a song in 4 minutes, watch").
3. All creative rules stand: no voice-clone claims, no hard price claims, one continuous music bed.
4. Landing-message match: each ad concept gets a matching `/create` entry variant (headline param) — message continuity from ad → funnel.

**Gate C (week 4):** ≥6 ad variants ready + pixels/CAPI verified in Events Manager test mode.

## WS-D: Soft launch & tune (weeks 4–6)

1. Flip `web_funnel_enabled` for 100% (it's dark traffic anyway — nobody knows the URL).
2. **Meta first** ($15/day, Advantage+ off, 2–3 creatives, purchase optimization on CAPI events; US+UK+CA+AU). TikTok waits until Meta proves the funnel (one variable at a time).
3. Watch daily (the funnel analytics from U12): visit→quiz start, quiz→preview, preview→purchase, CAC, webview failure anomalies, provider-cost per visitor (budget breaker headroom).
4. Iterate in 3-day cycles: copy/step-order/offer-framing changes only — no structural rebuilds inside the soft-launch window.
5. Support loop: delivery emails answered same-day; every confused buyer message becomes a funnel copy fix (solo-founder advantage: founder support = research).

**Gate D (end week 6):** blended **CAC < $15 at ≥$14.99 AOV** with ≥15 purchases → WS-E scale. CAC $15–25 → hold spend, iterate creative 2 more weeks. CAC > $25 across 3 creative iterations → stop paid; funnel stays live for organic/Etsy/SEO traffic; revisit channel strategy (this was a kill criterion in the repositioning doc — honor it).

## WS-E: Scale & seasonal (weeks 6+, hard deadline Nov 1)

1. Scale Meta on ROAS; introduce TikTok with the real reaction clips (Songfinch's −24% CPC channel); creator seeding per the median-views rule (gift free songs to micro-creators for reaction content).
2. **Google layer** (from WS-A keyword data): Shopping/PLA + exact-match search on "custom song gift" cluster → funnel; SEO pages already re-pointed (U13).
3. **Seasonal machine** (merges the App-Store plan's Phase 3 — now web-first): occasion funnel variants (`/create?occasion=christmas` with tailored copy/imagery), seasonal ad flights, email list warm-up (opted-in buyers), App Store In-App Events + CPPs as the _secondary_ surface. Calendar: Grandparents Day (Sep 7, dry run) → Thanksgiving → **Christmas (the ⅓-of-year window; everything live by Nov 1)** → Valentine's → Mother's Day.
4. Pricing A/B ($14.99 vs $19.99) resolves with ≥50 purchases of data.

**Gate E (Dec 26):** Christmas fortnight revenue ≥ 5× October baseline → the seasonal thesis holds; plan 2027 around the gifting calendar. If not → 2027 strategy leans creator/UGC-led over paid.

## WS-F: Loop & apps (week 6+, after funnel data exists)

1. **Recipient loop instrumentation**: gift played → listened-full → claim-CTA → app install → claim → created-back; fix the biggest leak (today: claim→account 18%).
2. **In-app "make one back" moment** post-claim (exists — measure, then sharpen).
3. **Android go/no-go** (the Skip Fuse plan): triggered when web data shows ≥20% of recipients on Android hitting "get the app" — until then the lifetime web link serves them.
4. App Store hygiene continues passively (screenshots/nomination from the previous plan — done once, not iterated).

---

## Weekly operating cadence

- **Friday `/marketing status`:** funnel numbers (U12 events), spend/CAC by channel, Etsy sales, recipient-loop rates, gate status per workstream — one honest verdict each.
- **One structural change per week max** post-launch (the July ASO regression lesson: churn costs more than patience).
- Budget guardrails: ad spend capped by gate status; provider spend capped by the budget breaker; both alert before they stop.

## Kill criteria (carried + extended)

1. WS-A: no willingness-to-pay signal → no paid traffic, full stop (cheapest possible failure).
2. WS-D: CAC > $25 after 3 creative iterations → paid social isn't our channel at this AOV.
3. WS-F: claim→account < 25% after the web-play-first fix → the loop is retention, not acquisition; value shares accordingly.
4. Standing: no voice-clone positioning; no fake urgency; verify production claims with live signals before calling anything "launched."

## What this plan deliberately does NOT do

- No Android build before recipient data demands it. No TikTok Shop until TikTok organic/paid proves the audience. No subscription product. No in-app links to web checkout (anti-steering). No new ASO investment beyond the already-built Phase-0 assets. No second marketplace (Amazon Handmade etc.) until Etsy signal is read.
