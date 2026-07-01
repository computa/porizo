# Root 1 Admin Story Session Repository Adversarial Review 1

Date: 2026-06-27

## Scope

Reviewed the extraction of admin story-session list/detail persistence from
`AdminService` into `src/database/admin-story-session-repository.js`.

Touched paths:

- `src/database/admin-story-session-repository.js`
- `src/services/admin-service.js`
- `test/admin-story-session-repository.test.js`
- `test/admin-story-session-routes.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

## Attack Vectors Checked

1. List endpoint accidentally exposes raw story prompt, elements, summary, or turns.
2. Detail endpoint reads turns without constraining `session_id`.
3. Detail endpoint changes missing-session behavior from `null` to empty payload.
4. Session ordering drifts from `updated_at DESC`.
5. Turn ordering drifts from `turn_number ASC`.
6. `status` filter is dropped during delegation.
7. `engineVersion` filter is dropped during delegation.
8. Pagination bounds move into repository and allow unbounded reads.
9. Route-level `limit`/`offset` quirks drift from the existing `parsePagination` + `safeBounds` behavior.
10. Existing domain `story-repository.js` hydration shape leaks into admin read model.
11. Admin repository mutates story runtime state.
12. Repository introduces dynamic SQL identifiers.
13. SQLite/Postgres adapter compatibility regresses by using provider-specific syntax.
14. Route detail 404 behavior drifts.
15. Story-session list joins become inner joins and hide sessions with missing users.
16. Tests depend on production providers or long-running story generation.
17. New repository creates circular dependency back into services/routes.
18. Docs overstate Root 1 completion or hide remaining auth/billing/gift/share work.

## Findings

No P0/P1 findings remain.

### Fixed During Review

- P1 VERIFIED: Route-level contracts were not pinned by the first repository
  characterization pass. Scenario: a later route edit could preserve repository
  tests while changing `/admin/dashboard/story/sessions/:id` missing-detail 404
  behavior or leaking turns into list rows. Fix: added
  `test/admin-story-session-routes.test.js` covering filtered list redaction,
  detail turn scoping/order, and missing-detail 404 behavior.

## Validation

- `node --check src/database/admin-story-session-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-story-session-repository.test.js`
- `node --check test/admin-story-session-routes.test.js`
- `node --test test/admin-story-session-repository.test.js test/admin-story-session-routes.test.js`

Focused validation result: 8 pass / 0 fail.
