# Root 1 Admin Control Repository — Adversarial Review 1

## Scope

Root 1 slice: move admin provider/queue control-plane persistence out of
`src/services/admin-service.js` and into
`src/database/admin-control-repository.js`.

Touched files for this slice:

- `src/database/admin-control-repository.js`
- `src/services/admin-service.js`
- `test/admin-control-repository.test.js`

Out of scope:

- Gift, billing, subscription, and render semantics.
- Admin route splitting.
- Provider health-check behavior.
- App-config/security-config repository changes already present in the dirty
  worktree before this slice.

## Attack Vectors Reviewed

1. Provider list ordering changes relative to legacy `ORDER BY provider_name`.
2. Queue list ordering changes relative to legacy `ORDER BY queue_name`.
3. Provider pause upsert creates a duplicate row instead of updating by
   `provider_name`.
4. Provider reactivation leaves stale `paused_at`, `paused_by`, or
   `pause_reason`.
5. Queue pause update fails on SQLite because JS booleans are not bindable.
6. Queue reactivation leaves stale pause metadata.
7. Queue update accidentally creates missing queues instead of preserving the
   old update-only contract.
8. Admin audit rows are lost when persistence moves behind the repository.
9. Admin audit metadata changes shape.
10. Provider/queue route response shape changes through `AdminService`.
11. Repository hides database write failures.
12. Repository changes provider id convention from `prov_${providerName}`.
13. Repository changes status validation responsibility from route to DB layer.
14. PostgreSQL portability regresses due SQLite-only syntax.
15. The slice silently broadens into revenue or gift state.

## Findings

No P0/P1 findings.

### P2-INFERRED — Missing-queue status updates still return success

Scenario: an admin posts a status update for a `queue_name` that does not
exist. The repository preserves the legacy update-only behavior, so zero rows
are changed and `AdminService.setQueueStatus()` still returns `{ success:
true }`.

Smallest fix sketch: have `setQueueStatus()` return the update count and make
`AdminService` surface a 404-style result when zero rows are changed.

Disposition: deferred. This is pre-existing behavior and changing it would be
an admin API semantic change. Capture it for a later admin-control hardening
pass.

## Fix Wave

- Fixed the SQLite boolean-bind regression found during characterization by
  binding queue pause flags as `0/1` and using `CASE WHEN ? = 1`.

## Validation

- `node --check src/database/admin-control-repository.js`
- `node --check src/services/admin-service.js`
- `node --check test/admin-control-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/admin-control-repository.test.js`
  - 6 tests, 6 pass, 0 fail, duration 604.908417 ms
