# Root 1 — Story V3 Orchestration Repository Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/story-repository.js`
- `src/routes/story.js`
- `test/story-repository.test.js`
- `test/story-v3-orchestration-routes.test.js`

Root boundary:
- In scope: story V3 orchestration execution create/update/get/list persistence and execution-event append/list persistence.
- Out of scope: story engine behavior, runtime executor behavior, debug-loop HTTP checks, admin auth policy, replay payload merge semantics, route response envelopes, and the larger poem/story route persistence surface.

Reviewer mode: local adversarial pass. Two inherited agents were already stale/nonresponsive, were interrupted/waited on earlier in the run, and no new agents were launched to avoid increasing Mac resource pressure.

## Attack Vectors

1. P0 check — orchestration execution records stop being persisted before runtime execution starts.
   - Result: NOT FOUND. `runV3BackendTaskExecution()` still calls `createOrchestrationExecutionRecord()` before the first runtime execution event; the helper now delegates to `storyRepository.createOrchestrationExecution()`.

2. P0 check — event-write failures become fatal and break backend-task execution.
   - Result: NOT FOUND. `appendOrchestrationExecutionEvent()` still catches persistence failures and logs a warning, preserving the prior tolerance boundary.

3. P0 check — admin authorization or route gating changes.
   - Result: NOT FOUND. `requireV3OrchestrationAdmin()` and the `enableV3OrchestrationRoutes` gate are unchanged.

4. P0 check — execution GET/replay response JSON changes because raw rows moved.
   - Result: NOT FOUND. JSON parsing and response mapping remain in `routes/story.js`; the repository returns raw DB rows.
   - Coverage: `test/story-v3-orchestration-routes.test.js` still asserts execution GET with included events and replay behavior.

5. P0 check — execution-event ordering changes.
   - Result: NOT FOUND. Repository keeps `ORDER BY sequence ASC, created_at ASC`.
   - Coverage: `test/story-repository.test.js` inserts events out of order and asserts timeline ordering.

6. P1 check — pagination bounds move into the repository and become inconsistent.
   - Result: NOT FOUND. Route-owned `clampInt()` bounds remain in `routes/story.js`; repository accepts already-bounded `limit`/`offset`.

7. P1 check — execution-list status filtering changes.
   - Result: NOT FOUND. Repository keeps the prior optional `WHERE status = ?` branch and `created_at DESC` ordering.
   - Coverage: `test/story-repository.test.js` asserts filtered and unfiltered list behavior.

8. P1 check — request/result/debug/error serialization changes break normal route behavior.
   - Result: NOT FOUND for the exercised route contract. Normal execution payloads are object-shaped and still round-trip through the route response mapper. The repository now serializes non-null falsy values instead of silently dropping them; that is a robustness improvement for unexpected scalar payloads, not a change to current object-shaped execution output.

9. P1 check — event ids change format.
   - Result: NOT FOUND. The repository uses `newUuid()`, which wraps `crypto.randomUUID()`, matching the previous generator.

10. P1 check — this slice accidentally expands into the larger story/poem persistence surface.
    - Result: NOT FOUND. The remaining `story.js` direct SQL outside orchestration execution/event persistence is intentionally untouched for later bounded batches.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: `routes/story.js` still owns unrelated library-entry SQL and the larger poem/story persistence surface. That should be handled as a separate Root 1 batch with its own route/repository characterization.

## Validation

- `node --check src/database/story-repository.js`
- `node --check src/routes/story.js`
- `node --check test/story-repository.test.js`
- `node --test --test-concurrency=1 test/story-repository.test.js test/story-v3-orchestration-routes.test.js`
- `npm run lint`
- `git diff --check`

Focused result: 9 tests passed, 0 failed across the story repository and story V3 orchestration route suites.
