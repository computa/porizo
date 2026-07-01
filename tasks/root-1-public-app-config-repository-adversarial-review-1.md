# Root 1 Public App Config Repository — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex in-thread review

## Scope

Reviewed the Root 1 public app-config read persistence slice:

- `src/database/app-config-repository.js`
- `src/services/admin-service.js`
- `test/app-config-repository.test.js`
- `test/stt-config.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

Resource note: two read-only scout agents were launched for independent
candidate reconnaissance. Both exceeded the 60-second wait budget and were
closed while running:

- `019f067f-555c-7090-9979-23134fa92f17` (`Poincare`)
- `019f067f-766b-7ba2-ac89-1abe45b2fa20` (`Archimedes`)

No subagents were left running by this slice.

## Attack Vectors Reviewed

1. Public `/app/config` starts returning inactive gift bundles.
2. Gift bundles lose `sort_order` ordering.
3. Gift bundle projection leaks price/admin fields.
4. Missing `gift_bundles` migration no longer fails soft to `[]`.
5. Active onboarding sample projection leaks admin fields such as ids or audit columns.
6. Missing `onboarding_samples` migration no longer fails soft to null sample fields.
7. `sample_label` and `splash_demo_recipient` drift from the active sample label.
8. `getAppConfig()` loses STT config composition.
9. `getAppConfig()` loses music config composition.
10. `getAppConfig()` loses iOS update policy composition.
11. Feature flag reads accidentally bypass the existing feature-flag service/cache semantics.
12. Route behavior changes because `/app/config` is moved or auth-gated.
13. Admin onboarding CRUD accidentally starts using the read-only public projection.
14. Constructor injection breaks existing `new AdminService(db, options)` call sites.
15. Repository extraction hides app-store auto-version sync errors.
16. Tests only validate repository behavior and fail to pin the public mobile payload.

## Findings

No P0 or P1 findings.

### P2-INFERRED — Full route-level `/app/config` smoke still belongs in a wider contract pass

Scenario: route registration or future middleware accidentally auth-gates
`GET /app/config` while service-level tests continue passing.

Smallest fix sketch: add or retain full Fastify route smoke coverage for
`GET /app/config` in the Root 6 client-config-service eviction or the next
route-contract sweep. Rationale for deferral: this slice intentionally avoided
route movement; existing route code still calls `adminService.getAppConfig()`
without auth, and service-level public payload characterization passed.

## Termination

Current slice terminates with zero P0/P1 findings.
