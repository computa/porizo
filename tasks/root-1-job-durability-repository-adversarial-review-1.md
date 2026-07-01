# Root 1 Job Durability Repository — Adversarial Review 1

Date: 2026-06-27

## Scope

- Added `src/database/job-durability-repository.js`.
- Delegated jobs-row reads/writes for durability DLQ decisions, checkpoint
  loading/storage, heartbeats, stale running-job recovery, job health reads, and
  status counts from `src/workflows/durability.js`.
- Added `test/job-durability-repository.test.js`.
- Added repository-injection coverage for durability service checkpoint merge
  and public health-shape mapping.

## Boundary

This slice does not change circuit-breaker behavior, DLQ movement, retry
policy, stale-job threshold math, checkpoint JSON merge policy, public
durability service return shapes, runner polling, or admin job operations. It
only moves the durability module's jobs-row persistence behind a repository.

## Review Outcome

No P0/P1 issues found in local adversarial review.

## Risks Checked

- **Checkpoint merge ownership:** `saveCheckpoint` still merges new step data
  with existing `step_data` in the service layer before delegating the write.
- **Missing-job behavior:** checkpoint saves still throw `Job not found` when
  the repository returns no row.
- **Stale recovery semantics:** stale running jobs are still selected by
  `status = 'running'` plus missing/old heartbeat and are requeued with
  incremented attempts and cleared locks.
- **Circuit breaker/DLQ boundary:** repository extraction does not move circuit
  breaker calls, DLQ orchestration, or error classification into persistence.
- **Public health shape:** `getJobHealth` still maps `error_code` and
  `error_message` to the public `error` object without changing field names.
- **PostgreSQL COUNT portability:** repository normalizes grouped status counts
  to numbers so stats aggregation is not sensitive to adapter string counts.
- **Direct DB ownership:** `src/workflows/durability.js` no longer calls direct
  DB primitives; raw jobs SQL for this slice is centralized in the repository.
- **Agent resource management:** two read-only explorer agents were launched for
  durability/DLQ candidate assessment, timed out without returning useful
  output, and were closed before implementation continued.

## Validation

- `node --check src/database/job-durability-repository.js`
- `node --check src/workflows/durability.js`
- `node --check test/job-durability-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/job-durability-repository.test.js`
- `NODE_ENV=test node --test --test-concurrency=1 test/workflows/durability.test.js test/workflows/dlq.test.js`
- `npm run lint`
- `git diff --check`
