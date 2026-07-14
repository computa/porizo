# App Store Visibility & Usage Turnaround Plan

Date: 2026-07-14 · App: Porizo (`6758205028`) · Owner: Ambrose
Companion to: `2026-07-11-app-store-demand-and-attention-execplan.md` (engine build); this doc is the strategy + sequenced bets with kill gates.

## Evidence (all verified 2026-07-14)

- 30d unique funnel: **1,024 impressions (96% Search) → 52 page views → 53 downloads (~5%)**. Conversion healthy; **reach is the bottleneck**. Weekly impressions 230–435 vs 7K in Mother's Day week (May 11) and ~5K weeks in March.
- We rank **#1–2 US/GB/AU across the entire `* song gift` long-tail** — but the lane has almost no volume (ASA could only find **114 auction impressions/month** there). We are **not indexed** for `ai song generator` / `birthday gift ideas`; `birthday song` is US #19.
- **Ratings: 1 (US), 1 (AU), 1 (CA), 0 (GB).** Competitor GiftSong (4 months old, 7 ratings) outranks us on our own queries — direct evidence ratings are the ceiling. Rating prompt verified wired (6 call sites, fires on first success event) — the problem is _few users reach a success event_, which is the activation problem below.
- ASA gift terms: 53.8% tap→install, ~$1.06 CPI. Mother's Day 7K-impression week converted at only ~0.9% tap-through (weak card creative at the time).
- Revenue/download ≈ $0.30–0.60 at $1.99 → paid cannot self-fund yet; treat spend as velocity/research with hard caps.

## Strategy

Own the lane → raise the ceiling → catch the spike. Priorities per Ambrose: **(1) get people to the app, (2) get them to use it**; monetization only after both move.

## Phase 0 — Conversion assets in place (this week, $0)

- [ ] Attach new reaction-first screenshot set (`marketing/appstore/screenshots/generator-designed/exports/6.9|6.5`) to ASC 1.5.27; fix app-preview poster frame (currently "Pick who it's for").
- [ ] Include 2–3 icon variants in the 1.5.27 binary; start native PPO icon A/B after release.
- [ ] Submit the drafted featuring nomination (`marketing/appstore/aso/featuring-nomination-1.5.27.md`) with 1.5.27.
- [ ] Baseline activation funnel from prod DB: downloads → signup → first track created → first preview played → first share (tracks/jobs/share_tokens tables). This is the "get them to use it" metric — we currently do not know where new users stall.

## Phase 1 — Acquisition: climb one real-volume lane (weeks 1–3, cap $150)

- [ ] ASA: fund a `birthday song` cluster (exact + broad discovery, $0.70–1.00 CPT); keep `gift song` exact protected per 2026-07-07 audit; negatives on wasteland terms. Purpose: install velocity + true query-volume map — NOT profit.
- [ ] Metadata (one change, 14-day window, `rank-track.mjs` before/after): work `birthday` + `song` adjacency into subtitle/keyword field to support the climb from US #19.
- [ ] **Gate:** ≥2 target terms improve organic rank within 3 weeks → continue; else cut to $3/day and shift budget to Phase 3 creators.
- Explicit non-goal: `ai song generator` lane (not indexed, Suno owns it, ASA gets 0 impressions there). Revisit only after 50+ ratings.

## Phase 2 — Activation: make new users reach the success moment (weeks 1–4, parallel)

Reach × activation is what compounds: every activated user = a share sent (recipient loop) + a fired rating prompt (rank + conversion).

- [ ] From Phase 0 baseline, fix the single biggest stall in download → first-preview (candidates: signup friction, create-flow length, preview wait time).
- [ ] Recipient loop: measure claim→creator conversion for the shipped recipient-first flow (F1/F2 device-binding work); one improvement per 2-week window.
- [ ] Targets: first-session song-creation rate and share rate, tracked weekly in `/marketing status`. Ratings 1 → 50 in 60 days is the downstream proof this is working.

## Phase 3 — Catch the spike (continuous; hard deadline Nov 1)

- [ ] Seasonal machine per gifting moment (Grandparents Day → Thanksgiving → **Christmas** → Valentine's → Mother's Day): In-App Event + occasion CPP + seasonal metadata rotation (`seasonal-aso` skill). Mother's Day proved the store delivers 7K-impression weeks; last time we caught ~1% of it.
- [ ] Off-store demand: creator/UGC seeding per median-views rule + Hook-25 assets; goal is direct product-page traffic (page converts at ~27%+).
- [ ] Everything above live before Nov 1 for the Christmas window.

## Phase 4 — Monetization (only after Phases 1–2 gates pass)

- [ ] Price/packaging test: keep $1.99 first-song hook; add $7.99–8.99 gift bundle (song + lyric card + video). Gate: revenue/download ≥ $1 makes ASA self-funding → scale Phase 1 spend.

## Measurement loop

Weekly: `node scripts/aso/rank-track.mjs` + ASC timeseries API by source (recipe in project memory: `POST /analytics/api/v1/data/timeseries`, header `X-Requested-By: appstoreconnect.apple.com`, unique measures) + activation funnel query. Friday: `/marketing status` verdict per phase. One metadata change per 14-day window — the July regression taught us churn costs ranks.

## Kill criteria (honesty checks)

- Phase 1: no organic rank movement in 3 weeks → stop paid climb.
- Phase 2: if activation is already >40% (downloads→first preview), the stall theory is wrong — shift all effort to reach.
- Phase 3: if Christmas week impressions < 3× baseline despite seasonal machine, search is capped for this category → 2027 strategy must be off-store-first.
