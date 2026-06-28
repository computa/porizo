# Root 1 Apple Ads Attribution Route Persistence — Adversarial Review 1

Date: 2026-06-27
Scope under review:
- `src/routes/analytics.js`
- `src/database/attribution-repository.js`
- `test/attribution-repository.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

## Root Scope

Move `/analytics/apple-ads-attribution` persistence for `apple_ads_attribution`
rows behind `database/attribution-repository.js` without changing the public
route contract. The route keeps request validation, token hashing, Apple Ads
HTTP fetch/timeout behavior, developer-test classification, audit/event
emission, and response-envelope ownership.

Out of scope:
- Moving Apple Ads network calls into a provider gateway.
- Changing acquisition backfill precedence.
- Changing route response envelopes.
- Touching `/analytics/event`, which already persists through `eventsService`.

## Attack Vectors Reviewed

1. Duplicate resolved token should still bypass network fetch and return
   `deduped: true`.
2. Duplicate `not_found` token should still bypass retry.
3. Duplicate `test` token should still bypass retry and remain excluded from
   acquisition reporting.
4. Failed network capture for an existing pending row should update that row,
   not insert a duplicate.
5. Failed network capture for a new token should persist a failed row before
   returning 503.
6. Resolution update should preserve the original row id for existing rows.
7. Resolution insert should persist all Apple Ads fields used by admin
   attribution reporting.
8. `raw_response_json` should still be route-owned parsing output, not
   repository-owned business interpretation.
9. Backfill must still use `AttributionService.backfillUserAcquisitionFromAppleAds`.
10. Audit log resource id must still reference the persisted row.
11. `eventsService.emit("apple_ads_attribution_capture")` must still include
    the same metadata fields.
12. `normalizedStatus === "failed"` must still return 502 after persistence.
13. `routes/analytics.js` should no longer contain raw `db.prepare` calls.
14. Repository methods should keep SQLite/Postgres adapter compatibility by
    avoiding dialect-specific returning clauses.
15. Existing Apple Ads developer-test filtering in attribution repository
    batch/read helpers must remain unchanged.

## Findings

No P0/P1 findings.

### P2 — Route still owns Apple Ads provider call

Severity: P2
Status: INFERRED
Scenario: Future provider retry/backoff or timeout policy changes must still
touch the route because this slice only moved persistence.
Smallest fix sketch: Defer to Root 4 provider strategy, where Apple Ads can
be represented as a gateway with uniform HTTP/retry behavior.
Disposition: Deferred. Moving network behavior here would expand the slice from
Root 1 repository extraction into Root 4 provider abstraction.

### P3 — Repository methods require caller-supplied ids

Severity: P3
Status: VERIFIED
Scenario: Callers must pass `id` for insert paths, matching existing repository
style for download events but leaving id-generation outside persistence.
Smallest fix sketch: Standardize id ownership repository-wide later if the
codebase adopts a factory/ID provider pattern.
Disposition: Accepted. This matches current repository conventions and keeps
testability high.

## Verification

Passed:
- `node --test --test-concurrency=1 test/attribution-repository.test.js test/apple-ads-attribution.test.js test/analytics-event.test.js`
- `node --check src/routes/analytics.js`
- `node --check src/database/attribution-repository.js`

Root termination for this slice: zero P0/P1.
