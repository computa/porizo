# ASO Spend Tracking — Plan

**Goal:** Persist daily ASA spend (per campaign + per keyword) over time, plot it, refresh on every `/porizo-aso-review` run.

## Why this is needed

`marketing/appstore/aso/keywords.json` and `snapshots/` capture **one aggregate** per review window (last 30 days lumped together). They cannot answer:

- "What did Mother's Day US spend look like day-by-day after launch?"
- "Did spend on `song for mom` decay after we promoted it to EXACT?"
- "Which day this week did Discovery US blow through its budget?"

Time series is required. ASA v5 supports `granularity: DAILY` natively, so each pull backfills the full 30-day curve — first run already has rich history; revised days self-heal on subsequent pulls.

## File layout

```
marketing/appstore/aso/spend-history/
  daily.json          # source of truth, time-series by date
  dashboard.html      # self-contained Chart.js viewer (committed)
  .gitignore          # blank — both files committed
scripts/aso/
  spend-history.mjs        # CLI entry point: pull + merge + render
  spend-pull.mjs           # ASA v5 daily report fetcher
  spend-store.mjs          # load/merge/save daily.json
  spend-dashboard.mjs      # render dashboard.html
  spend-store.test.mjs     # merge logic tests
  spend-dashboard.test.mjs # HTML render tests
```

## daily.json schema

```jsonc
{
  "schema_version": "1.0",
  "updated_at": "2026-05-13T11:52:00Z",
  "first_observed": "2026-05-12",
  "campaigns": {
    "2143835551": {
      "name": "Probe US Painkiller",
      "first_seen": "2026-05-12",
      "daily": {
        "2026-05-12": { "impressions": 1234, "taps": 42, "installs": 5, "spend": 18.40, "avg_cpt": 0.44 },
        "2026-05-13": { ... }
      }
    }
  },
  "keywords": {
    "2143835551:51234567": {
      "campaign_id": "2143835551",
      "keyword_id": "51234567",
      "term": "song for mom",
      "match_type": "BROAD",
      "first_seen": "2026-05-12",
      "daily": {
        "2026-05-12": { "impressions": 200, "taps": 8, "installs": 1, "spend": 3.20, "avg_cpt": 0.40 }
      }
    }
  }
}
```

**Merge rules:**

- New campaigns/keywords inserted, preserving `first_seen`.
- Existing days overwrite (Apple revises numbers up to ~72h).
- Days not in the pull window are left untouched (preserves historical data older than the pull window).
- Atomic write: write to `daily.json.tmp` then rename.

## ASA v5 pull

Two POSTs per run:

1. `POST /api/v5/reports/campaigns`
   ```jsonc
   {
     "startTime": "2026-04-13",
     "endTime":   "2026-05-13",
     "selector": { "orderBy": [...] },
     "groupBy":  ["countryOrRegion"],
     "timeZone": "UTC",
     "returnRowTotals":     false,
     "returnGrandTotals":   false,
     "returnRecordsWithNoMetrics": false,
     "granularity": "DAILY"
   }
   ```
2. For each running campaign: `POST /api/v5/reports/campaigns/{id}/keywords` with the same shape.

Auth: JWT signed with `.pem` key (matches existing `pull-asa.mjs` pattern).

## Dashboard

Single `dashboard.html`, ~250 LOC, no build step. Embeds `daily.json` as `<script type="application/json">` block.

**Charts (Chart.js via CDN):**

1. **Stacked area** — campaign spend over time (last 30 days). Each campaign a band.
2. **Line** — top-20 keywords by total spend, one line each.
3. **Toggle** — metric switcher (spend / taps / installs / CPI).
4. **Toggle** — daily vs weekly rollup.

**View controls:**

- Date range slider (default last 30 days).
- Campaign filter checkboxes.
- Keyword search box.

## Skill integration

Add to `.claude/skills/porizo-aso-review/SKILL.md`:

```
### Step 3.5 — Refresh spend history

After the rerank, append the same window's daily spend to the
time-series store and regenerate the dashboard:

  node scripts/aso/spend-history.mjs --days 30

Outputs:
  marketing/appstore/aso/spend-history/daily.json (merged)
  marketing/appstore/aso/spend-history/dashboard.html (rewritten)

Report `file://.../dashboard.html` in the final summary so the user
can click it. If ASA is down, skip — daily.json is preserved.
```

## TDD checklist

- [ ] `spend-store.test.mjs` — merge new days, overwrite existing days, preserve old days, preserve `first_seen`
- [ ] `spend-dashboard.test.mjs` — empty store renders empty dashboard; populated store embeds correct JSON; HTML well-formed

## Verification

1. Unit tests pass.
2. `node scripts/aso/spend-history.mjs --days 7 --dry-run` prints planned actions without writing.
3. Live run against ASA writes daily.json with 5 campaigns × 7 days = 35 day-records.
4. Open dashboard.html in browser → 5 colored bands in the stacked area chart, time axis runs over last 7 days.

## Out of scope

- Building the missing `scripts/aso/review.mjs` / `pull-asa.mjs` / `rerank.mjs` referenced by the skill (separate task).
- Cross-app ASA support (Porizo-only).
- Slack/email digest of weekly spend (could come later).
