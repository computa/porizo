# Root 1 Enrollment Session Token Repository — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex in-thread review

## Scope

Reviewed the Root 1 enrollment-session token persistence slice:

- `src/database/enrollment-session-repository.js`
- `src/services/enrollment-session-service.js`
- `test/enrollment-session-repository.test.js`
- `test/services/enrollment-session-service.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

No subagents were launched for this pass.

## Attack Vectors Reviewed

1. Persona-service token context lookup loses `consent_scopes`.
2. Token context lookup widens to `SELECT *` and leaks unrelated fields.
3. Unknown or invalid session id no longer returns the existing null/undefined shape.
4. Single-session revoke clears sibling sessions.
5. Single-session revoke clears other users' sessions.
6. User-wide revoke clears sessions for other users.
7. User-wide revoke collapses into single-session semantics.
8. Provider-fetch rotation silently succeeds when the row is missing.
9. Provider-fetch rotation rotates multiple rows.
10. Service stops generating cryptographically fresh tokens itself.
11. Service revocation logging disappears.
12. Service rotation logging disappears.
13. Repository exposes log/audit side effects and becomes more than persistence.
14. SQLite/Postgres affected-row mapping changes service return shape.
15. Existing callers must change signatures.

## Findings

No P0 or P1 findings.

### P2-INFERRED — Broader enrollment route lifecycle SQL remains in route handlers

Scenario: `/voice/enrollment/start`, chunk upload, completion, and status paths
still own substantial `enrollment_sessions` SQL outside this token-focused
service.

Smallest fix sketch: extract route lifecycle reads/writes in a later bounded
repository slice after route-level characterization tests are selected.
Rationale for deferral: this slice intentionally covers only the existing
token-focused service boundary and leaves high-blast enrollment completion
behavior untouched.

## Termination

Current slice terminates with zero P0/P1 findings.
