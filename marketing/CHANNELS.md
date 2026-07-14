# Marketing Channel Ledger

One section per channel: what we did (dated), what it produced, what's next, and the gate that kills or scales it. **Update after every channel action; the Friday `/marketing status` loop reads this file.** Strategy: `docs/plans/2026-07-14-001-feat-web-first-pivot-execution-plan.md`. Format per entry: `YYYY-MM-DD — action → result (or "pending")`.

## Google — organic (SEO)

- Status: **LIVE, priority 1 of the Google layer** (best CPC-free capture of the exploding gift lane)
- Done:
  - pre-2026-07 — programmatic SEO pages built (`public/gifts/*`, occasion pages, songfinch-alternative) → indexed; conversion role was app-download (weak)
  - 2026-07-15 — keyword truth pulled (see `marketing/web/google-keyword-volumes-2026-07-14.md`): gift-intent lane 1k–10k/term US, +900% YoY on 3 of 5 terms → validates lane; pages already target it
- Next: U13 re-points all page CTAs to `/create` funnel; then watch Search Console clicks → funnel starts
- Gate: none (free channel); measure CTA click-through after re-point

## Google Ads — paid

- Status: **RESEARCH ONLY — no spend** (account 467-070-1950, AUD, no campaigns)
- Done:
  - 2026-07-15 — Keyword Planner volume pull, 18 terms, US (browser-harness; skill: `/google-ads`) → lane validated; channel order set: SEO → Shopping/PLA → exact-match low-bid; plaque-bundle adjacency discovered
- Next: nothing until WS-D Meta gate passes (CAC < $15); then Shopping feed + exact-match cluster per skill
- Gate: opens only after Meta soft-launch gate; then standard CAC < $15 @ ≥$14.99 AOV

## Meta (Facebook/Instagram) — paid

- Status: **CONFIGURED, PAUSED** — pixel live on porizo.co (dataset 36564205179837496), SKAN/AppsFlyer wired (2026-05-28), no ads running
- Done:
  - 2026-05 — SKAN campaign infra + AppsFlyer partner setup → proven install tracking
  - 2026-07-14 — Hook-25 ad creative rendered (9:16 + 16:9) → ready, unpublished
- Next: WS-D soft launch $15/day on web-purchase optimization (CAPI from U12), 2–3 creatives, wk 4 of pivot
- Gate: CAC < $15 @ ≥$14.99 AOV with ≥15 purchases → scale; > $25 after 3 creative iterations → stop paid

## TikTok — organic + paid

- Status: **ASSETS READY, dormant** (paid waits for Meta proof — one variable at a time)
- Done:
  - 2026-06 — reels pipeline + music rule (one continuous track); creator qualification by median views; DMs blocked → email/IG outreach
  - 2026-07-14 — Hook-25 TikTok cut rendered → unpublished
- Next: WS-C reaction-clip permission pipeline (14 repeat creators); paid only after WS-D gate
- Gate: inherits WS-E; creator seeding measured by clips delivered per gifted song

## App Store — organic (ASO)

- Status: **HYGIENE ONLY per pivot** (reach ceiling ~1K unique impressions/mo, 96% search; conversion healthy at ~5%)
- Done:
  - 2026-06/07 — rank tracking (`scripts/aso/rank-track.mjs`): #1–2 US/GB/AU on `* song gift` long-tail; lane has no volume (~114 ASA auction impr/mo)
  - 2026-07-07 — rank regression audit + fix → recovered
  - 2026-07-14 — reaction-first screenshot set generated (uncommitted); featuring nomination drafted; rating prompt verified firing
- Next: attach screenshots to 1.5.27, submit nomination, icon PPO — once, then stop iterating store assets
- Gate: no further investment beyond hygiene; seasonal In-App Events + CPPs return in WS-E as secondary surface

## Apple Search Ads — paid

- Status: **PAUSED** (evidence run only)
- Done:
  - 2026-06/07 — probe: 53.8% tap→install, ~$1.06 CPI on gift terms; volume ceiling confirmed (~114 auction impr/mo in our lane) → channel can't deliver volume regardless of efficiency
- Next: nothing; revisit only for seasonal spikes (WS-E) where store volume temporarily exists
- Gate: closed by evidence 2026-07-14 (repositioning doc)

## Etsy — marketplace

- Status: **WEDGE TEST PENDING** (WS-A — the price-validation channel)
- Done:
  - 2026-07-14 — market verified: made-to-order AI song listings, top shops 13.2K/6.1K reviews at $19.99, "ready in 24h" standard → our same-day + preview beats the category
- Next: Ambrose lists at $24.99 with $19.99 sale price; manual fulfilment via app/admin; deliver MP3 + `/play` link
- Gate: ≥10 sales or ≥$100 in 3 wks → price validated; 0 sales at two price points with ≥200 visits → STOP paid plans, rethink pricing

## Cold email — outbound

- Status: **DEAD — do not resume** (2026-06-06: 2,284 sent → 4 clicks → 0 registrations)
- Gate: closed; only revisit with a fresh verified list AND a new angle (per memory)

## Email — lifecycle/transactional

- Status: **INFRA LIVE (Resend), lifecycle minimal**
- Done: magic-link, welcome, share-followup, gift-delivery templates exist in `src/services/email-service.js`
- Next: funnel delivery email (U6), opted-in buyer list from Stripe consent (U4) → seasonal sends (WS-E)
- Gate: none yet; list must be 100% purchase-consented

## Web funnel — owned (porizo.co)

- Status: **BUILDING** (`docs/plans/2026-07-14-002-feat-web-funnel-implementation-plan.md`)
- Done:
  - 2026-07-14 — spec + plans committed (b1c714c); Meta pixel already on site; smart banner live
- Next: U1–U3 (identity + free preview) → U4–U6 (Stripe) → SPA → soft launch wk 4
- Gate: launch-readiness checklist (U14) before any traffic; funnel targets in spec §1

## Recipient loop — owned (viral)

- Status: **SHIPPED, LEAKY** — 49 claims → 9 accounts (18%) → 5 created → 4 re-shared
- Next: web-play-first gift shares (U7) + post-listen claim CTA; measure claim→account weekly (WS-F)
- Gate: claim→account < 25% after fixes → treat shares as retention, not acquisition
