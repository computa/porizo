# Root 1 Artwork Job Hardening — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex in-thread review

## Scope

Reviewed the Root 1 artwork-job hardening slice:

- `src/database/artwork-job-repository.js`
- `src/jobs/artwork-job.js`
- `test/artwork-job-repository.test.js`
- `test/jobs/artwork-job.test.js`

Resource note: a delegated adversarial review agent was given a 45-second wait
budget, missed it, and was closed while still running. This artifact records the
completed local adversarial pass.

## Attack Vectors Reviewed

1. Terminal artwork jobs can be moved back to `running`.
2. Terminal artwork jobs can be moved back to `queued` by retry scheduling.
3. Late failure writes can overwrite a completed job.
4. Stale recovery can generate artwork after another worker completed the job.
5. Heartbeat zero-change results cause duplicate generation.
6. Jobs inserted by `enqueueArtworkJob()` lack `queue_name`.
7. SQLite/Postgres `ON UPDATE`/status-guard SQL compatibility breaks.
8. Existing no-job-id in-process runs accidentally abort.
9. Job-row update DB failures crash the artwork pipeline.
10. Retry behavior stops working after repository guards.
11. Orphan rows with missing parent track can no longer fail cleanly.
12. Test mocks mask real migrated table behavior.
13. `queue_name` selection breaks queue metrics.
14. `rowCount`-style adapters are treated differently from `changes` adapters.
15. A terminal job during retry backoff still generates again.

## Findings

No P0 or P1 findings.

### P2-INFERRED — Terminal job during retry backoff is detected only on next claim — FIXED

Scenario: generation attempt fails, `requeueJob()` races with an external
terminal transition and returns zero changes. The current code still sleeps the
backoff and invokes the next attempt, but the next attempt immediately aborts
when `markJobRunning()` returns zero changes. It should not generate again, but
it may waste one backoff wait.

Fix: `scheduleRetry()` now inspects the `requeueJob()` update result and returns
the stale/aborted envelope immediately when zero rows change. Coverage added in
`test/jobs/artwork-job.test.js`.

### P2-INFERRED — Full suite not rerun after artwork hardening

Scenario: another job-dashboard query depends on artwork rows having a different
queue name than `q.default`.

Smallest fix sketch: run `npm test` at the next wider Root 1 checkpoint.
Rationale for deferral: focused artwork repository/job tests passed against real
migrated rows and the behavior-level mock suite; lint and diff checks passed.

## Termination

Current slice terminates with zero P0/P1 findings.
