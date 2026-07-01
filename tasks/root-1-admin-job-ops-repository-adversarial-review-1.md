# Root 1 Admin Job Ops Repository - Adversarial Review 1

Date: 2026-06-27

Scope under review:
- `src/database/admin-job-ops-repository.js`
- `src/services/admin-service.js` job, DLQ, system-health, and job-step-history methods
- `test/admin-job-ops-repository.test.js`

Root objective:
- Move admin job/DLQ persistence out of `AdminService`.
- Preserve admin response shapes and audit behavior.
- Make retry/reprocess state transitions robust at the repository boundary.

Attack vectors reviewed:
1. Job list filters silently ignore `status`.
2. Job list filters silently ignore `workflowType`.
3. Job list no longer includes joined `track_id`.
4. Job metrics omit stale running jobs.
5. Job metrics omit unreprocessed DLQ count.
6. Failure metrics group by the wrong error field.
7. Retrying a missing job audits success.
8. Retrying a non-failed job resets live work.
9. Retrying a failed job loses route-facing `{ success: true }`.
10. A concurrent job status change after service precheck still audits retry success.
11. DLQ list drops `failure_reason` fallback.
12. DLQ list changes `payload_json` shape for string `step_data`.
13. DLQ reprocess updates job but not DLQ row.
14. DLQ reprocess updates DLQ row but not job.
15. DLQ reprocess races leave a 500 instead of admin failure result.
16. DLQ reprocess audits success when persistence did not happen.
17. System health stops reporting checked timestamp.
18. Job step history changes ordering.
19. SQLite/Postgres transaction result metadata is interpreted incorrectly.
20. Repository direct callers can bypass service preconditions.

## Findings

### P1-VERIFIED-1: Repository retry could reset non-failed jobs

Scenario:
- A future direct caller invokes `retryFailedJob()` for a `running` or `queued` job.
- The update resets `attempts`, clears error fields, sets status to `queued`, and mutates `updated_at`.
- Result: live work can be silently rewound.

Smallest fix:
- Add `AND status = 'failed'` to the repository update predicate.
- Return zero changes when the invariant is not satisfied.

Status:
- Fixed in this slice.
- Added regression coverage: `retryFailedJob refuses to mutate jobs that are not failed`.

### P1-VERIFIED-2: Service could audit retry success after a lost race

Scenario:
- `AdminService.retryJob()` reads a job as `failed`.
- Another worker changes the status before the repository update.
- The repository update affects zero rows.
- Without checking the mutation result, the service emits `admin_retry_job` and returns success.

Smallest fix:
- Treat zero affected rows from `retryFailedJob()` as `{ success: false, error: "Job is not failed" }`.
- Skip audit emission.

Status:
- Fixed in this slice.
- Added regression coverage: `retryJob does not audit success when the repository update loses a race`.

### P1-VERIFIED-3: DLQ reprocess race could leak as a 500

Scenario:
- `AdminService.reprocessDLQ()` reads a DLQ entry as unreprocessed.
- Another actor reprocesses it before the repository transaction updates the row.
- The repository throws after its transactional row-count guard.
- Without service mapping, the route would surface an internal error rather than the existing admin failure-result style.

Smallest fix:
- Catch the repository race error and return `{ success: false, error: "DLQ entry already reprocessed" }`.
- Skip audit emission.

Status:
- Fixed in this slice.
- Added regression coverage: `reprocessDLQ returns a failure result when the repository loses a race`.

### P2-INFERRED-1: Job metrics still use raw DB count types

Scenario:
- SQLite returns numeric counts; PostgreSQL can return count values as strings depending on driver configuration.
- This preserves existing behavior, but admin clients should not rely on a specific JSON number/string type until contract tests pin it across adapters.

Smallest fix:
- Add an adapter-parity test or normalize counts in a later admin-contract slice.

Status:
- Deferred. No new regression introduced.

## Result

After the fix wave, this root slice has zero open P0 and zero open P1 findings.
