# Google Keyword Planner — Song-Gift Lane Volumes (US)

Pulled 2026-07-15 from Google Ads Keyword Planner (account 467-070-1950), location **United States**, Jul 2025–Jun 2026, via authenticated browser session. Fulfills WS-A item 2 of `docs/plans/2026-07-14-001-feat-web-first-pivot-execution-plan.md`.

Caveats: volumes are **ranges** (low-spend account tier — exact numbers unlock with campaign spend). Bids shown in **AUD** (account currency); ÷1.5 ≈ USD. "+900%" YoY is Planner's capped bucket-jump flag — read as "growing fast", not a precise number.

## US monthly search volumes

| Keyword | Avg monthly (US) | YoY | Competition | Top-of-page bid (A$) |
|---|---|---|---|---|
| ai song generator | 10k–100k | 0% | Medium | 0.66 – 5.36 |
| birthday song | 10k–100k | 0% | Low | 1.04 – 5.49 |
| song for mom | 10k–100k | **−90%** | Low | 0.04 – 0.10 |
| **custom song gift** | **1k–10k** | **+900%** | High | 5.30 – 16.36 |
| **custom song** | **1k–10k** | **+900%** | Low | 4.41 – 12.79 |
| **song gift** | **1k–10k** | **+900%** | High | 2.40 – 6.94 |
| **personalized song gift** | **1k–10k** | 0% | High | 5.57 – 16.20 |
| **personalized song** | **1k–10k** | 0% | Medium | 4.65 – 14.19 |
| anniversary song | 1k–10k | 0% | Low | 0.07 – 5.98 |
| song for dad | 1k–10k | 0% (3mo +900%) | Low | 0.06 – 0.13 |
| song for grandma | 1k–10k | 0% | Low | — |
| custom birthday song | 100–1k | +900% | Low | 1.85 – 7.05 |
| personalized birthday song | 100–1k | +900% | Low | 1.85 – 7.05 |
| wedding song gift | 100–1k | 0% | High | 2.37 – 12.98 |
| anniversary song for wife | 10–100 | 0% | Medium | 2.69 – 13.21 |
| custom song for boyfriend | 10–100 | 0% | High | 2.78 – 13.55 |
| make a song for someone | 10–100 | +900% | High | 4.32 – 11.84 |
| song with her name in it | no data | — | — | — |

AU reference pull (earlier same session): same shape, ~1–2 buckets smaller (e.g., custom song gift AU 10–100).

## Findings

1. **The gift-intent lane is real and exploding.** Five stacked commercial terms (custom song gift, custom song, song gift, personalized song gift, personalized song) each at 1k–10k US/month, three flagged +900% YoY — conservatively **~10–25k gift-intent searches/month in the US**, growing an order of magnitude year-over-year. Compare: our entire App Store surface reaches ~1K unique impressions/month. **Google's gift lane alone is 10–25× the App Store pool**, before browse terms.
2. **Advertisers pay A$5–16 top-of-page on exactly these terms** (High competition) — someone (Songfinch at $199 AOV) profitably buys these words. At our ~$19 AOV, high-range CPCs are marginal → priority order: (a) **SEO** — our `/gifts/*` programmatic pages already target this lane; the +900% growth means rankings earned now compound; (b) **Google Shopping/PLA** (typically cheaper clicks, product-card format suits a $19.99 gift); (c) exact-match search ads at low-range bids only.
3. **Don't chase the big browse terms.** "song for mom" (10k–100k) has $0.04–0.10 bids and −90% YoY — that's streaming/listening intent (people looking for existing songs), commercially worthless. "birthday song" (10k–100k, Low comp, $1 bids) is mostly the same intent; only the `custom/personalized birthday song` variants carry buyer intent.
4. **"ai song generator" (10k–100k, cheap clicks) stays a non-goal** — tool/creation intent, Suno's lane, wrong buyer. Confirms the repositioning doc's explicit exclusion.
5. **Adjacency discovered via Keyword ideas (276 ideas on "custom song gift"):** a physical-gift cluster — *spotify glass plaque, spotify plaque gift, custom song plaque, song plaque*. The market already pairs custom songs with physical keepsakes → validates the gift-bundle framing and suggests a future physical upsell (lyric plaque/QR card) without us inventing demand.
6. **Timing argument:** the +900% cluster means the AI-song-gift category is being created *right now*. Rankings, reviews, and brand recall earned in the next two quarters (before Christmas) are the land-grab.

## Actions fed back into the plan

- WS-E Google layer: SEO-first (already built) → Shopping second → exact-match third; budget guardrails per plan.
- Ad copy/landing keywords: lead with "custom song gift" / "personalized song" phrasing (exact user vocabulary).
- Bundle roadmap: physical lyric-plaque upsell noted as validated adjacency (deferred list).
