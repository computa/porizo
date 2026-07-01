# Root 1 Workflow DLQ Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/dead-letter-queue-repository.js`.
- Delegated workflow DLQ service persistence from `src/workflows/dlq.js`:
  job lookup, DLQ upsert/list/read, dead-letter job status update, reprocess job
  creation, reprocessed marker update, count stats, and purge.
- Added `test/dead-letter-queue-repository.test.js`.

## Boundary

This slice does not move the runner's DLQ auto-reprocessor, admin job/DLQ
operations, failure classification, stale-file cleanup, circuit-breaker logic,
or public route/admin contracts. It keeps `createDLQService` responsible for
public errors, ID generation, return shapes, and orchestration.

## Review Outcome

No P0/P1 issues found in local adversarial review after fixes.

## Risks Checked

- **Legacy/current schema drift:** repository helpers preserve legacy
  `retry_count`/`current_step`/`max_retries` behavior while also supporting the
  current runner schema's `attempts`/`step`/`max_attempts` fields.
- **Current-schema DLQ insertion:** durability's current-schema DLQ path still
  moves jobs to `dead_letter` and captures current `error_message` as
  `last_error`.
- **Idempotent DLQ upsert:** DLQ entries remain unique by `job_id`; repeated
  moves update the existing row rather than creating duplicates.
- **Reprocess behavior:** legacy reprocess still creates a new `pending` job
  with `current_step`; current-schema reprocess creates a runnable `queued` job
  with `step`, `attempts = 0`, and `step_index = 0`.
- **Adapter portability:** purge no longer depends on PostgreSQL-only
  `NOW() - INTERVAL`; the service computes a cutoff timestamp and the repository
  executes an adapter-neutral comparison.
- **Runner adjacent behavior:** DLQ auto-reprocess and stale-file cleanup tests
  still pass; the runner-owned auto-reprocess SQL was intentionally left in
  `runner.js`.
- **Agent resource management:** one read-only explorer completed and was
  closed. A second read-only explorer timed out; the `close_agent` cleanup call
  against that agent hung and was interrupted, so no further agents were
  launched for this slice. A process check found no lingering test/lint process
  from this work.

## Validation

- `node --check src/database/dead-letter-queue-repository.js`
- `node --check src/workflows/dlq.js`
- `node --check test/dead-letter-queue-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/dead-letter-queue-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/workflows/dlq.test.js test/workflows/durability.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/workflows/dlq-auto-reprocess.test.js test/workflows/dlq-retry.test.js`
- `npm run lint`
- `git diff --check`
