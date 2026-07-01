# Root 1 App Config Repository — Adversarial Review 1

Date: 2026-06-27
Reviewer: Codex in-thread review

## Scope

Reviewed the Root 1 public/admin app-config persistence slice:

- `src/database/app-config-repository.js`
- `src/services/admin-service.js`
- `test/app-config-repository.test.js`
- `test/app-config-route.test.js`
- `test/stt-config.test.js`
- `test/music-provider-config.test.js`

Resource note: two read-only scout agents completed and were closed. A delegated
adversarial review agent was given a 60-second wait budget, missed it, and was
closed while still running; this artifact records the completed local
adversarial pass.

## Attack Vectors Reviewed

1. `app_config` STT reads accidentally drop metadata needed by music config.
2. `app_config` upserts differ between SQLite and PostgreSQL.
3. `security_config.updated_by` FK fails when admin actors are present.
4. `security_config` defaults change when no row exists.
5. Malformed STT JSON no longer falls back to defaults.
6. Malformed music provider JSON no longer preserves row metadata.
7. Provider status LIKE query exposes non-STT providers.
8. Public `/app/config` performs live App Store Connect network work.
9. Public `/app/config` leaks `last_app_store_sync_error`.
10. Public gift bundles expose inactive rows or `price_cents`.
11. Public onboarding sample exposes admin-only fields.
12. Repository injection breaks tests or custom `AdminService` construction.
13. Admin STT/music update audit behavior is skipped.
14. Security config sync path loses cached App Store version fields.
15. `resolveIOSAppUpdatePolicy()` changes admin semantics unexpectedly.
16. The slice duplicates an existing repository instead of extending it.
17. Raw config SQL remains in `admin-service.js`.

## Findings

No P0 or P1 findings.

### P2-INFERRED — Public STT provider status still exposes internal provider names

Scenario: unauthenticated `/app/config` includes `stt.provider_status`, which
names internal provider status keys such as `stt_openai`.

Smallest fix sketch: coordinate with iOS and either remove the map from the
public contract or project it into a coarse capability status. Rationale for
deferral: this was pre-existing public behavior, and changing it is a client
contract change outside this repository extraction.

### P2-INFERRED — Full suite not rerun after the app-config slice

Scenario: an unrelated admin route depends on an unstated side effect of direct
`db.prepare()` calls inside `AdminService`.

Smallest fix sketch: run `npm test` at the next wider Root 1 checkpoint.
Rationale for deferral: focused repository, service, and HTTP tests passed, lint
passed, and grep verified the targeted raw config SQL moved out of
`admin-service.js`.

## Termination

Current slice terminates with zero P0/P1 findings.
