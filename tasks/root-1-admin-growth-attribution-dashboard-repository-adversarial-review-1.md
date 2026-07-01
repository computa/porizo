# Root 1 Admin Growth Attribution Dashboard Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

Move `AdminService.getAttribution()` read SQL into
`database/attribution-repository.js` while preserving the admin route response
contract. The service keeps the lookback window, row merge/sort policy, and rate
string formatting.

## Changed Files

- `src/database/attribution-repository.js`
  - Added share/download attribution breakdown readers with whitelisted fields.
  - Added Apple Ads campaign attribution aggregation.
  - Added attribution total counters.
- `src/services/admin-service.js`
  - Replaced inline dashboard SQL with repository calls.
- `test/attribution-repository.test.js`
  - Added characterization for share/download breakdown counts, Apple Ads
    campaign filters, keyword-map joins, totals, and dynamic-field rejection.

## Attack Vectors Reviewed

1. Dynamic attribution field names cannot be user-controlled SQL fragments.
2. Share breakdown should only read `utm_source`, `utm_medium`, and
   `utm_campaign`.
3. Download breakdown should include `utm_content` and `utm_term`.
4. Share content/term rows should remain empty rather than querying nonexistent
   share columns.
5. Claimed-share counts must still treat `status = 'claimed'`, bound device, or
   bound user as claims.
6. Download registration counts must remain distinct matched users.
7. Old rows outside the lookback window must be excluded.
8. Unattributed rows should count in totals but not attributed totals.
9. Apple Ads `status = 'test'` rows must stay out of campaign aggregation.
10. Apple developer-test tuples must stay out of campaign aggregation.
11. Keyword-map joins must continue to cast keyword IDs for string-keyed map
    rows.
12. Apple Ads status buckets must normalize to numbers for Postgres count
    compatibility.
13. Service merge/sort must still rank by downloads, registrations, then
    shares.
14. Service rate strings must keep two-decimal formatting.
15. Existing admin attribution route contract must stay green.

## Findings

No P0 or P1 findings.

### P2-1 — Dashboard reads are not snapshot-consistent across all aggregates

VERIFIED. The dashboard still performs multiple read queries. A concurrent
share/download/Apple Ads write can make totals and breakdown rows reflect
slightly different instants. This was pre-existing behavior and is acceptable
for an admin dashboard, but a future analytics materialization root should move
these into a rollup table or transaction snapshot if exact reconciliation
becomes product-critical.

### P3-1 — Keyword-map bulk sync remains outside this dashboard read slice

VERIFIED. The previous keyword-map slice left bulk sync as row-by-row writes
with audit after the loop. This read-only dashboard extraction does not change
that write-path residual.

## Validation

- `node --check src/database/attribution-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/attribution-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/attribution-repository.test.js test/admin-attribution.test.js`

