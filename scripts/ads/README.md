# Meta Ads Analyzer

Pulls Meta ads data on intervals, evaluates effectiveness with deterministic
rules, adds an LLM narrative, and writes a Markdown report + HTML trend
dashboard. **Recommend-only** — it never changes the ad account; every
suggestion includes the exact command to apply after you review it.

## Run

```bash
# from repo root
node -r dotenv/config scripts/ads/run.mjs                 # default campaign 52503493410610
node -r dotenv/config scripts/ads/run.mjs --campaign 123  # any campaign id
```

Outputs (gitignored, local):

- `marketing/ads-analytics/reports/<timestamp>.md` — full report per run
- `marketing/ads-analytics/dashboard.html` — trend dashboard (overwritten each run)
- `marketing/ads-analytics/snapshots/history.json` — time-series (drives trends/fatigue)

## Auth

- **Meta token**: `~/meta-ads/.env` (`ACCESS_TOKEN`) — same creds as the `meta` CLI.
- **LLM narrative**: tries `ANTHROPIC_API_KEY` (repo `.env`) first, then falls back to
  the headless `claude -p` CLI (your Claude Code subscription — no API credits needed).
  If neither works, the report is rules-only and still useful.

## What it evaluates

Per ad + campaign, across windows (today / 3d / 7d / lifetime):
impressions, reach, frequency, spend, link-CTR, CPM, CPC, installs, **CPI**.

Rules (thresholds in `config.json`):

- **Learning phase** → HOLD (installs < floor, default 50, OR age < 3d). Won't judge on noise.
- **CPI** vs target (good / warn / bad), **CTR** vs floor, **frequency** fatigue, **pacing** (under-delivery).
- **A/B/C significance gate** — only crowns a winner when ≥2 ads clear the install floor AND the CPI gap is real (≥25%); else "inconclusive, keep running."
- **Trends** across snapshots — CPI direction, CTR decay → fatigue.

Verdicts: `HOLD · SCALE · PAUSE · REFRESH · MONITOR · INVESTIGATE`.

## Tune

Edit `scripts/ads/config.json` — `targetCpi` (AUD), `minLinkCtr`, `maxFrequency`,
`learningInstallFloor`, `minInstallsForSignificance`, `significantCpiGapPct`, etc.
Re-tune `targetCpi` after the first week of real data.

## Schedule (macOS launchd — daily 9am)

Create `~/Library/LaunchAgents/co.porizo.ads-analyzer.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>co.porizo.ads-analyzer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd /Users/ao/Documents/projects/porizo &amp;&amp; node -r dotenv/config scripts/ads/run.mjs &gt;&gt; marketing/ads-analytics/cron.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/co.porizo.ads-analyzer.plist   # enable
launchctl unload ~/Library/LaunchAgents/co.porizo.ads-analyzer.plist # disable
```

Daily is the right cadence — Meta install data is SKAN-delayed (24–72h) and budget/learning
decisions shouldn't be made more than once a day anyway.

## Architecture

`pull.mjs` (Insights fetch) → `store.mjs` (snapshot history) → `evaluate.mjs`
(pure rules, unit-tested in `evaluate.test.mjs`) → `narrate.mjs` (LLM) →
`report.mjs` (Markdown) + `dashboard.mjs` (HTML). `run.mjs` orchestrates.

```bash
node --test scripts/ads/evaluate.test.mjs   # 23 tests on the rules core
```
