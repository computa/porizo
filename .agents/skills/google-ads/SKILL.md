---
name: google-ads
description: Porizo Google Ads + Keyword Planner operations — pull keyword volumes via browser-harness, manage campaigns, and log every action/result to the channel ledger. Use for keyword research, search volumes, Google Ads campaigns, Shopping/PLA, or Google keyword questions.
user-invocable: true
---

# Google Ads / Keyword Planner (Porizo)

Operate Google's demand data and (later) paid campaigns for the web-first funnel. Strategy context: `docs/plans/2026-07-14-001-feat-web-first-pivot-execution-plan.md` (WS-A #2, WS-E #2). **After ANY action here, update `marketing/CHANNELS.md`** (Google organic + Google Ads sections) — that ledger is how channel work and results stay tracked.

## Account facts (verified 2026-07-15)

- Google Ads account **467-070-1950** (acuoos1@gmail.com, Google `authuser=1`). Currency **AUD** — all bid/CPC figures display in A$; ÷1.5 ≈ USD.
- No campaigns running; account has low spend history → Keyword Planner returns **range buckets** (1k–10k), not exact volumes. Ranges are sufficient for lane decisions; exact numbers unlock with spend.
- Keyword plan "Plan from Jul 15, 2026" exists in Keyword Planner with the 18-term song-gift list saved.

## Pulling keyword volumes (proven flow, browser-harness)

Prereq: read `~/Developer/browser-harness/SKILL.md` in full once per session. Mechanics also contributed to `~/Developer/browser-harness/domain-skills/google-ads/keyword-planner.md`.

1. `new_tab("https://ads.google.com/aw/keywordplanner/home?authuser=1")` — **gotcha:** Google may rewrite to `authuser=0` (wrong account, different Ads id in the top-right). Verify the account number in `page_info()` title / screenshot; if wrong, `goto(...authuser=1)` again in OUR tab.
2. Card "Get search volume and forecasts" → paste keywords (one per line) → Get started.
3. **Gotcha: location defaults to Australia** (account country). Click the location chip → remove AU → add "United States" → Save. The **Keyword ideas tab keeps its own separate location** — set it independently.
4. Extract the table via DOM, not screenshots (the table virtualizes; scroll all scrollable containers first):

```python
js("""(() => {
  const els = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 100);
  els.forEach(e => e.scrollTop = e.scrollHeight); return els.length; })()""")
rows = js("""(() => {
  const rows = [...document.querySelectorAll('ess-table tbody tr, .particle-table-row, tr[role=\"row\"]')];
  return JSON.stringify(rows.map(r => r.innerText.replace(/\\n+/g,' | ').trim()).filter(Boolean)); })()""")
```

Columns: keyword | avg monthly | 3-mo change | YoY | competition | impr share | low bid | high bid. "+900%" = capped bucket-jump flag, read as "growing fast".

5. Save the artifact to `marketing/web/google-keyword-volumes-YYYY-MM-DD.md` (baseline: `marketing/web/google-keyword-volumes-2026-07-14.md`) and update `marketing/CHANNELS.md`.

UI gotchas: clicks near the plan title open a rename popover (Cancel and retry); "Keyword ideas" tab needs its own seed term; screenshots are 2× DPR (CSS coords = screenshot px ÷ 2).

## Current keyword truth (2026-07-15 baseline — don't re-pull for strategy questions)

Gift-intent lane (US/mo): custom song gift, custom song, song gift, personalized song gift, personalized song — **each 1k–10k, three at +900% YoY** (~10–25k stacked). Browse giants are wrong intent: song for mom (10k–100k, $0.04 bids, −90%), ai song generator (Suno's tool lane — non-goal). Top-of-page bids on gift terms A$5–16 → at ~$19.99 AOV the channel order is **SEO (`public/gifts/*` pages) → Google Shopping/PLA → exact-match search ads at low-range bids**. Adjacency: "spotify plaque / custom song plaque" physical-keepsake cluster (validated bundle upsell, deferred).

## Campaign operations (when WS-E opens paid)

- Follow the execution plan's gates: no Google spend before the Meta soft-launch gate passes (WS-D, CAC < $15) — Google is layer 2.
- Start: Shopping/PLA feed for the gift bundle + exact-match ["custom song gift", "personalized song gift", "custom song"] with low-range bids, negatives on lyrics/karaoke/streaming intent, US-only, conversion = web purchase (needs U12 CAPI/gtag conversion wired first).
- Log every campaign change and weekly result rows in `marketing/CHANNELS.md`; one structural change per week max.
