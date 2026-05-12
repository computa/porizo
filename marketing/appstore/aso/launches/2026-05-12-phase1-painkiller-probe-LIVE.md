# Phase 1 Painkiller Probe — LIVE state (2026-05-12)

Campaign launched 2026-05-12 in Apple Search Ads. This file is the
audit record of what's actually in production, distinct from the
pre-launch plan at `2026-05-12-phase1-painkiller-probe.md`.

## Campaign

| Field                       | Value                                                  |
| --------------------------- | ------------------------------------------------------ |
| Name                        | `Probe US Painkiller`                                  |
| Apple Ads campaign ID       | `2143835551`                                           |
| Storefront                  | United States only                                     |
| Daily budget                | **$20.00** (plan called for $30 — user shipped at $20) |
| Bid strategy                | Manual CPT                                             |
| Goal                        | Drive installs / Brand awareness                       |
| Match type                  | Broad (all 51 keywords)                                |
| Default max CPT per keyword | $0.75                                                  |
| Status                      | Running                                                |

## Ad groups

All ad groups Running, $0.75 max CPT, Broad match. IDs captured for
the rerank pipeline so day-7 results can be joined.

| Ad Group                 | Apple Ads ID | Keywords (planned → live)          |
| ------------------------ | ------------ | ---------------------------------- |
| Pet Songs                | `2148315953` | 8 → 8 Running                      |
| Baby & Pregnancy         | `2148315956` | 8 → 8 Running                      |
| Apology & Reconciliation | `2148316017` | 6 → 6 Running                      |
| Long-Distance            | `2148315405` | 5 → 5 Running                      |
| Stepfamily & Extended    | `2148316557` | 11 → 11 Running + 1 invalid Paused |
| Milestone Birthdays      | `2148316018` | 8 → 8 Running                      |
| Voice-Clone Discovery    | `2148315957` | 5 → 5 Running                      |
| **TOTAL**                | —            | **51 → 51 Running**                |

## Known artifacts

**`song for aunt song for uncle`** (Stepfamily & Extended) — paste artifact
from a concatenated CSV line. Apple Ads auto-paused as invalid syntax.
Cannot be deleted (Apple's no-delete policy preserves historical reporting
integrity). Stays as Paused row with $0 spend forever. The rerank engine
should skip or RETIRE it on day-7 evaluation; do not treat it as a tested
keyword.

## Concurrent actions applied on launch day

These were applied in the ASA UI before the Phase 1 launch (per the
2026-05-09 actions plan and 2026-05-12 rerank verdict):

- `birthday gift ideas` graduated BROAD → EXACT @ $3.00 max CPT in
  Porizo - Category US > High-Intent Keywords. 72h test result was
  50% install rate at 4 taps / 103 imp.
- `birthday gift` graduated BROAD → EXACT @ $3.00 max CPT in same
  ad group. 33% install rate at 3 taps / 168 imp.
- Discovery exact-match negatives added to Porizo - Discovery US >
  Discovery Keywords ad group:
  - `[birthday gift ideas]` — prevent split attribution
  - `[birthday gift]` — prevent split attribution
  - `[anniversary gift]` — TTR_PROBLEM stopgap (325 imp / 0 taps)
  - `[personalized gifts]` (plural) — DEMOTE (0 installs / 11 taps)
  - `[meaningful gift]` — DEMOTE (0 installs / 5 taps)

## Day-7 evaluation (target: 2026-05-19)

```bash
node scripts/aso/review.mjs --days 7 --note "Phase 1 painkiller probe day-7 checkpoint"
node scripts/aso/sync-keyword-map.mjs --admin-sync --api-base-url https://api.porizo.co
```

Success-criteria thresholds from the launch plan:

- **>50 imp/day total** in any ad group → real demand; promote winners
  to EXACT in Phase 2 Category campaign.
- **<10 imp/day total** → dead at $0.75; either bid up to $1.50 for one
  more probe round, or drop.
- **>50 imp, 0 taps** → TTR_PROBLEM; add as exact-match negative, audit
  Custom Product Page.
- **>10 taps, 0 installs** → conversion problem (landing page mismatch).

Compare against the Porizo backend admin dashboard
(`/admin/dashboard/growth/attribution?days=30`) to verify registrations
join correctly to the new ASA `acquisition_*` columns.

## Phase 2 (2026-05-19+, after day-7 evaluation)

Graduate the winners to EXACT in `Porizo - Category US > High-Intent
Keywords` at $2.50–$3.50 max CPT. Add the same terms as exact-match
negatives in Discovery. The pre-launch doc has the full procedure.

## Phase 3 (~2026-05-26)

Floor catch ($0.30 BROAD) for the remaining ~165 painkillers in the bank.
