# Fix Postgres Async Await Gaps for Auth and Core Jobs

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows the global ExecPlan standard at ~/.codex/PLANS.MD.

## Purpose / Big Picture

Porizo’s production database can run on PostgreSQL, where `db.prepare(...).get/all/run` are async. Missing `await` calls cause promises to leak into logic, which breaks auth, jobs, and admin flows. After this change, async DB calls are consistently awaited so auth, cleanup jobs, and session queries behave deterministically in production. A developer can verify this by running the server and hitting `/auth/me` and `/auth/sessions` without “not iterable” or NULL session errors.

## Progress

- [x] (2026-01-24 22:15Z) Audited missing awaits in server routes, story repository, job runner adapter, and admin auth flows.
- [x] (2026-01-24 22:35Z) Implemented missing awaits in server routes, story repository, job runner adapter, and admin auth session lookup.
- [x] (2026-01-24 22:43Z) Run lint + tests and record results (lint passed; tests failed in database adapter and DLQ/durability suites).
- [ ] (2026-01-24 22:45Z) Summarize changes, remaining risks, and validation evidence.

## Surprises & Discoveries

- Observation: `requireUserId` was async but almost all call sites in `src/server.js` and `src/routes/story.js` did not await it, which would pass a Promise as `userId` in PostgreSQL.
  Evidence: `rg -n "requireUserId\\(" src/server.js` showed dozens of non-awaited uses prior to fixes.
- Observation: Several route handlers and story repository functions used `db.prepare(...).get/all` without `await` because SQLite sync behavior masked the issue.
  Evidence: `rg -n "= db\\s*$" src/server.js` and `src/database/story-repository.js` identified un-awaited chains.

## Decision Log

- Decision: Start with an audit focused on async DB calls, then only change confirmed missing awaits.
  Rationale: Avoid breaking behavior while ensuring PostgreSQL compatibility.
  Date/Author: 2026-01-24 / Codex
- Decision: Convert `requireUserId` call sites to `await` across server and story routes.
  Rationale: Async `requireUserId` returns a Promise; using it without `await` breaks auth and DB access on PostgreSQL.
  Date/Author: 2026-01-24 / Codex
- Decision: Make `adminAuthService.validateSession` async and await it in admin route guards.
  Rationale: Admin session lookup uses async DB calls under PostgreSQL and must be awaited to avoid false unauthorized errors.
  Date/Author: 2026-01-24 / Codex

## Outcomes & Retrospective

Pending.

## Context and Orientation

The server uses `src/database/postgres.js` for PostgreSQL, where `prepare().get/all/run` are async. The same code runs in SQLite where these calls are synchronous, so missing `await` may go unnoticed locally. The auth flow lives in `src/routes/auth.js` and `src/services/auth-service.js`. Cleanup jobs are in `src/jobs/cleanup.js`. The job runner uses `src/workflows/runner.js`. Admin and other services use the same DB API.

## Plan of Work

First, audit missing awaits using a lightweight grep/script and manually confirm each candidate. Second, update confirmed missing awaits in critical paths (auth, session listing, cleanup jobs, job runner adapter). Third, rerun lint and tests and record outcomes. Finally, summarize changes and residual risks.

## Concrete Steps

Run the audit script to list `.get/.all/.run` calls missing `await` on their line, then inspect each candidate in context.

    node scripts/pg-await-audit.js

If the script doesn’t exist, run a one-off search:

    rg -n "db\.prepare\(" src

Then update files with missing awaits and re-run lint and tests:

    npm run lint
    npm test

## Validation and Acceptance

- `/auth/me` and `/auth/sessions` execute without runtime errors when PostgreSQL is configured.
- Background jobs (cleanup and job runner durability/DLQ paths) operate without promise leakage.
- `npm run lint` and `npm test` complete (or failures are explicitly documented).

## Idempotence and Recovery

These changes are safe to reapply. If tests fail, revert the specific file changes and re-apply with smaller scope. No database migrations are required.

## Artifacts and Notes

Pending.

## Interfaces and Dependencies

- Database adapter: `src/database/postgres.js` with async `prepare().get/all/run`.
- Auth routes: `src/routes/auth.js`.
- Auth service: `src/services/auth-service.js`.
- Cleanup job: `src/jobs/cleanup.js`.
- Job runner adapter: `src/workflows/runner.js`.
