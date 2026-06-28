# Root 1 Artwork Job Repository — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex in-thread review

## Scope

Reviewed the Root 1 artwork job persistence slice:

- `src/database/artwork-job-repository.js`
- `src/jobs/artwork-job.js`
- `test/artwork-job-repository.test.js`
- `test/jobs/artwork-job.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

No new subagents were launched for this pass. The earlier two scout agents in
this turn were closed while running after exceeding the bounded wait budget.

## Attack Vectors Reviewed

1. Track lookup loses sender display name from the users join.
2. Latest-version lookup stops ordering by `version_num DESC`.
3. Version lyrics extraction stops reading from the selected `track_versions` row.
4. Entitlement lookup silently demotes paid/admin-upgraded users.
5. Artwork update argument order changes and writes source/provider/prompt to wrong columns.
6. `artwork_moderation_passed=false` stops persisting as `0`.
7. Per-version artwork vars are accidentally written to the track instead of the version.
8. Artwork-ready flag becomes track-scoped instead of version-scoped.
9. `notifyArtworkReady()` stops receiving the real DB handle after repository extraction.
10. Job-row heartbeat failures start crashing the artwork pipeline.
11. Successful jobs stop marking `completed` and `progress_pct=100`.
12. Permanent provider errors stop marking durable jobs failed.
13. Retry scheduling loses `next_attempt_at` and becomes non-recoverable after restart.
14. Enqueue insert failure starts spawning orphan jobs with missing rows.
15. Orphan recovery scan stops excluding future `next_attempt_at` jobs.
16. Orphan rows without parent track stop being failed explicitly.
17. Recovery attempts use the wrong next attempt number.
18. Existing SQL constants exported for tests drift from repository SQL.

## Findings

No P0 or P1 findings.

### P2-INFERRED — Full runner integration not rerun after this bounded repository move

Scenario: a caller outside `test/jobs/artwork-job.test.js` depends on a hidden
detail of the artwork job module while the focused tests still pass.

Smallest fix sketch: run the wider workflow/runner-focused suite at the next
Root 1 checkpoint or before commit handoff. Rationale for deferral: the slice
did not change public job API names, focused job behavior tests passed, the new
repository is verified against the migrated SQLite schema, and `artwork-job.js`
has no remaining direct `db.prepare` calls outside documentation/comments.

## Termination

Current slice terminates with zero P0/P1 findings.
