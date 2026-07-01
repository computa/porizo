# Root 1 Enrollment Cleanup Repository — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex in-thread review

## Scope

Reviewed the Root 1 enrollment cleanup persistence slice:

- `src/database/enrollment-cleanup-repository.js`
- `src/jobs/cleanup.js`
- `test/enrollment-cleanup-repository.test.js`
- `test/enrollment-cleanup-job.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

Resource note: an older subagent (`019f0439-8a55-7c11-9e57-f9e611c99a65`) did
not respond to bounded close/wait attempts in this run, so no new subagents were
launched for this pass.

## Attack Vectors Reviewed

1. `started_at` cutoff accidentally changes to `created_at` or `expires_at`.
2. Cutoff timestamp shape loses ISO UTC semantics.
3. Cleanup deletes sessions selected by an unscoped broad query.
4. Cleanup deletes the DB row before storage cleanup succeeds.
5. Malformed `prompts_json` prevents cleanup of otherwise expired sessions.
6. Empty prompt ids skip `chunk_count` fallback incorrectly.
7. Remote storage deletes omit the clean artifact.
8. Local storage fallback stops working when provider type is `local`.
9. One session failure stops later sessions from being attempted.
10. Repository query failure changes the public cleanup error envelope.
11. `startCleanupJob()` ignores the injected repository and reopens raw SQL.
12. SQLite/Postgres adapter API mismatch around `.all()` and `.run()`.
13. Tests characterize only mocks and not the real migrated `enrollment_sessions` table.
14. New repository duplicates broader enrollment lifecycle semantics accidentally.
15. Account-deletion durable storage cleanup becomes coupled to this job repository.
16. Docs overstate Root 1 completion or hide remaining enrollment lifecycle SQL.

## Findings

No P0 or P1 findings.

### P2-INFERRED — Full suite not rerun after this bounded slice

Scenario: a hidden consumer depends on the precise internal mock shape of
`cleanupExpiredSessions()` and is not covered by the focused cleanup/enrollment
tests.

Smallest fix sketch: run `npm test` at the next wider Root 1 checkpoint or
before handoff if this slice is being prepared for commit. Rationale for
deferral: the slice is bounded to one job and one new repository, focused
coverage passed against both the real migrated table and the cleanup behavior,
and the full suite passed after the previous Root 1 checkpoint.

## Termination

Current slice terminates with zero P0/P1 findings.
