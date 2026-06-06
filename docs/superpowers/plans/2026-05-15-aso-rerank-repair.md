# Restore ASO Rerank Review Scripts

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This repository does not include a root `PLANS.MD`, so this plan follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

The `/porizo-aso-review` workflow currently references `scripts/aso/review.mjs`, `scripts/aso/pull-asa.mjs`, and `scripts/aso/rerank.mjs`, but those scripts are absent. After this repair, Ambrose can run one command to pull Apple Search Ads keyword data, merge it into `marketing/appstore/aso/keywords.json`, write a dated snapshot, print the current top keyword-field string, and refresh the spend dashboard. The visible proof is that `node scripts/aso/review.mjs --days 30 --note "..."` exits successfully and prints top keywords, actions, discovery candidates, and a dashboard URL.

## Progress

- [x] (2026-05-15 00:24Z) Confirmed the documented ASO rerank scripts are absent from local git history and current branch.
- [x] (2026-05-15 00:29Z) Inspected the current `keywords.json` schema, historical ASA CSV shape, and spend-history scripts.
- [x] (2026-05-15 00:26Z) Implemented missing ASO pull, rerank, and review wrapper scripts.
- [x] (2026-05-15 00:26Z) Added focused tests for CSV parsing, scoring, anomaly handling, action labels, field packing, and discovery seeding.
- [x] (2026-05-15 00:26Z) Ran focused ASO tests and the live review command.
- [x] (2026-05-15 00:32Z) Ran broader validation: ESLint and full `npm test`.

## Surprises & Discoveries

- Observation: The spend dashboard task explicitly marked `review.mjs`, `pull-asa.mjs`, and `rerank.mjs` as out of scope, while the skill documentation already referenced them.
  Evidence: `marketing/operations/tasks/aso-spend-tracking.md` says “Building the missing scripts ... referenced by the skill” was separate work.

- Observation: `marketing/appstore/aso/keywords.json` already includes a clear scoring formula and historical review log, so the repair should reuse that schema instead of creating a new ASO store.
  Evidence: the `scoring` object contains `untested_formula`, `tested_formula`, `intent_bonus`, and `intent_multiplier`.

- Observation: `spend-pull.mjs` was not preserving keyword max CPT, even though action labels need it for bid-pressure versus volume-cap decisions.
  Evidence: the normalized keyword row had `match_type` but no `max_cpt` before this patch.

## Decision Log

- Decision: Implement the scripts around the existing `keywords.json` and `spend-pull.mjs` modules.
  Rationale: This restores the documented workflow with minimal new concepts and keeps the spend dashboard and rerank signals aligned.
  Date/Author: 2026-05-15 / Codex

- Decision: Treat Apple Ads rows with installs but zero taps as data anomalies for scoring.
  Rationale: The skill runbook explicitly says not to let those rows enter ranking decisions.
  Date/Author: 2026-05-15 / Codex

- Decision: Add a pure `rerank-core.mjs` module behind the CLIs.
  Rationale: The scoring, CSV parsing, action labels, and keyword-field packing are now unit-testable without network access or file writes.
  Date/Author: 2026-05-15 / Codex

- Decision: Let `rerank.mjs` fall back to the latest saved ASA and ASC input when no same-day file exists.
  Rationale: `--skip-asa` and offline reviews should still produce a useful rerank from the most recent saved data.
  Date/Author: 2026-05-15 / Codex

## Outcomes & Retrospective

The documented ASO review commands now exist and run. `node scripts/aso/review.mjs --days 30 --note "Restore ASO rerank workflow 2026-05-15"` pulled 21 ASA keyword rows, updated `keywords.json`, wrote `marketing/appstore/aso/snapshots/2026-05-15T0026.json`, and refreshed `marketing/appstore/aso/spend-history/dashboard.html`. The recommended keyword field from this run is `music gift,personalized gift,birthday gift ideas,gift song,mother's day song,birthday gift,porizo` at 97/100 characters.

Remaining gap: App Store Connect organic search-term export is still manual/browser-driven. The restored rerank accepts `--asc`, but this task did not automate ASC export.

## Context and Orientation

The ASO keyword bank is `marketing/appstore/aso/keywords.json`. Each keyword has a `term`, `tier`, `intent_class`, `status`, `asa`, `asc_organic`, `backend`, `effectiveness_score`, and `history`. The bank also has `live_surfaces.keywords`, which is the currently shipping App Store keyword metadata string.

The spend dashboard scripts live in `scripts/aso/`. `spend-pull.mjs` already handles Apple Search Ads OAuth and v5 reports. `spend-history.mjs` refreshes `marketing/appstore/aso/spend-history/daily.json` and `dashboard.html`.

The missing scripts must restore these commands:

    node scripts/aso/pull-asa.mjs --days 30
    node scripts/aso/rerank.mjs --asa marketing/appstore/aso/inputs/asa-YYYY-MM-DD.csv --note "..."
    node scripts/aso/review.mjs --days 30 --note "..."

## Plan of Work

Add `scripts/aso/rerank-core.mjs` as a testable pure module for parsing CSV, merging Apple Ads rows, computing scores, choosing the App Store keyword field, and formatting actions. Add `scripts/aso/rerank.mjs` as the CLI that reads and writes `keywords.json`, writes timestamped snapshots, and prints a report. Add `scripts/aso/pull-asa.mjs` as the CLI that uses `pullDailySpend` and writes the historical ASA CSV shape. Add `scripts/aso/review.mjs` as the one-command wrapper that runs the ASA pull unless skipped, runs rerank with available inputs, then runs spend history.

Update `scripts/aso/spend-pull.mjs` so keyword rows include `max_cpt` when Apple exposes bid metadata; this allows the CSV puller and action classifications to distinguish bid pressure from volume caps.

Add tests in `scripts/aso/rerank-core.test.mjs` and run them with Node’s built-in test runner.

## Concrete Steps

From `/Users/ao/Documents/projects/porizo`, inspect the bank:

    node -e "const j=require('./marketing/appstore/aso/keywords.json'); console.log(j.keywords.length, j.last_reviewed)"

After implementation, run:

    node --test scripts/aso/*.test.mjs
    node scripts/aso/rerank.mjs --dry-run --asa marketing/appstore/aso/inputs/asa-2026-05-12.csv --note "dry run"
    node scripts/aso/review.mjs --days 30 --note "Repair verification 2026-05-15"

Observed validation:

    node --test scripts/aso/*.test.mjs
    # 32 pass, 0 fail

    npm run lint
    # exits 0

    npm test
    # 441 tests, 435 pass, 6 skipped, 0 fail

## Validation and Acceptance

Acceptance is met when `node scripts/aso/review.mjs --days 30 --note "Repair verification 2026-05-15"` exits 0, writes or refreshes the ASA CSV, updates `keywords.json`, writes a new snapshot under `marketing/appstore/aso/snapshots/`, refreshes the spend dashboard, and prints the top keyword-field string plus action recommendations.

## Idempotence and Recovery

The rerank command is safe to rerun. It sorts `keywords.json` by current score and appends a review-log entry. Snapshots include date and time so repeated runs do not overwrite prior evidence. The ASA pull overwrites only today’s input CSV. If ASA auth fails, the review wrapper should continue reranking from existing inputs when available.

## Artifacts and Notes

Important proof snippets should be pasted here as validation completes.

## Interfaces and Dependencies

Use only Node.js standard library modules and the existing `scripts/aso/spend-pull.mjs`, `spend-history.mjs`, and `spend-verdicts.mjs` modules. Do not introduce a CSV dependency; implement a small CSV parser/writer sufficient for exported Apple and App Store Connect CSVs.
