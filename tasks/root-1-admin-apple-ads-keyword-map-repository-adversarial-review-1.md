# Root 1 Admin Apple Ads Keyword-Map Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

Move admin Apple Ads keyword-map list/upsert SQL out of `AdminService` and into
`database/attribution-repository.js`, while preserving route/service ownership
of pagination bounds, payload validation, row normalization, audit logging, and
the existing response contract.

## Changed Files

- `src/database/attribution-repository.js`
  - Added `listAppleAdsKeywordMap()` and `upsertAppleAdsKeywordMapRow()`.
  - Made keyword-map ordering deterministic with explicit null-last ordering.
- `src/services/admin-service.js`
  - Injects `attributionRepository`.
  - Delegates keyword-map list/upsert SQL to the repository.
- `test/attribution-repository.test.js`
  - Added repository characterization for insert, update, count, pagination,
    and deterministic ordering.

## Attack Vectors Reviewed

1. Non-array payload should still throw before any repository call.
2. Oversized sync payload should still throw before any writes.
3. Blank keyword ID should still be skipped.
4. Blank keyword text should still be skipped.
5. Snake-case payload aliases must still work.
6. Camel-case payload aliases must still work.
7. Numeric IDs and bids must still be string-normalized before persistence.
8. Missing `source` must still default to `apple_ads_api`.
9. Missing `last_seen_at` must still default to the service timestamp.
10. Existing keyword ID must update mutable fields rather than inserting a
    duplicate.
11. List endpoint must still return `{ rows, total, limit, offset }`.
12. Pagination bounds must remain service-owned through `safeBounds`.
13. Keyword-map sync audit must still emit after successful processing.
14. Route error envelope must remain `INVALID_KEYWORD_MAP` for validation
    failures.
15. Attribution dashboard join must still resolve keyword names from the same
    table.
16. SQLite/Postgres ordering should not drift when optional sort fields are
    absent.

## Findings

No P0 or P1 findings.

### P2-1 — Keyword-map bulk sync is still not transactionally atomic

VERIFIED. The pre-existing service loop writes rows one at a time and audits
after the loop. If a later row fails after earlier rows succeed, the operation
can leave a partially synced keyword map with no audit row. This review kept the
behavior unchanged to avoid widening the slice, but the next hardening pass
should move bulk keyword-map sync into a repository transaction and return the
same `{ upserted, skipped }` shape.

### P3-1 — Larger growth-attribution dashboard SQL remains inline

VERIFIED. This slice only moves `getAppleAdsKeywordMap()` and
`upsertAppleAdsKeywordMap()`. `getAttribution()` still owns breakdown queries,
Apple Ads campaign aggregation, and total attribution counts inline. That is the
next coherent attribution slice.

## Validation

- `node --check src/database/attribution-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/attribution-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot test/attribution-repository.test.js test/admin-attribution.test.js`

