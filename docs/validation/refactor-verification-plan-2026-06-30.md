# Architecture Refactor Verification Plan - 2026-06-30

## Source Refactor Plan

Original plan: `docs/superpowers/plans/2026-06-28-parallel-architecture-refactor.md`.

That plan's stated goal is to finish the architecture refactor on branch `refactor` by closing Root 1 repository extraction, then advancing the gated roots in validated slices. Its baseline is:

- Refactor baseline commit: `43d8d9dd refactor: extract repository architecture boundaries`
- Previous pre-refactor baseline: `89a349ff docs(audit): per-feature post-fix test coverage map (178 features)`
- Branch: `refactor`

The original plan covers Root 1 repository extraction, Root 2 auth/rate-limit consolidation, C2 error-envelope documentation, Root 3b gift-delivery extraction, Root 4 provider/runtime config consolidation, Root 5 workflow runner step registry, Root 6 admin/client-config split, Root 7 writer decomposition, Root 8 cleanup, Root 9 migration convergence, Root 10 storage/OpenAPI parity, and Root 11 cross-surface create-flow alignment.

The original final gate only required worker closure, `npm run lint`, `npm test`, and architecture-doc sync. This verification plan expands that gate so the whole refactor is checked against the actual user-visible and operator-visible flows it touched.

## Verification Objective

Prove the refactor preserved behavior while improving boundaries. Passing this plan means:

- Public API contracts still match the pre-refactor behavior or intentionally documented contract.
- Revenue-adjacent flows still enforce auth, entitlements, billing, gift funding, and share-once invariants.
- Workflow runner extraction did not change render, retry, DLQ, provider artifact, or job polling behavior.
- Admin route/service splits did not change auth, role checks, pagination, response envelopes, or audit side effects.
- Root 11 did not break iOS create/gift/share payload handoff, web-player share presentation, or admin growth/share/funnel UI assumptions.
- Architecture docs agree with the code after the refactor.

## Phase 0 - Scope And Diff Freeze

Run these first and archive the outputs in the validation handoff.

```bash
git status --short
git log --oneline 43d8d9dd..HEAD
git diff --name-status 43d8d9dd..HEAD
git diff --stat 43d8d9dd..HEAD
```

Acceptance:

- Worktree is clean before validation starts.
- Every changed file maps to one of the original plan roots or a recorded follow-up.
- Any unrelated local change is either committed separately or explicitly excluded from validation.

## Phase 1 - Static Architecture Gates

```bash
npm run lint
npm run verify:migrations
git diff --check 43d8d9dd..HEAD
rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes src/services src/jobs src/workflows
rg -n "app\.(get|post|put|delete|patch)" src/routes/admin.js
node --check web-player/player.js
```

Acceptance:

- Lint passes.
- Migration parity passes.
- Diff has no whitespace errors.
- Direct persistence scan returns no matches outside comments that only describe injected DB contracts.
- `src/routes/admin.js` remains a registrar shell and does not regain direct route handlers.
- `web-player/player.js` parses.

## Phase 2 - Whole Repo Baseline

```bash
npm test
npm run appconfig:smoke
npm run verify:share-audio -- --share-id <known-share-fixture-or-prod-smoke-share-id>
```

Acceptance:

- Full Node test suite passes. Per repo rules, any full-repo validation failure is in scope unless Ambrose explicitly accepts it as deferred.
- App config smoke passes against the intended local/staging/prod target.
- Share-audio contract passes for a known fixture or production smoke share.

## Phase 3 - Root-Mapped Focused Verification

Run focused suites by root before or after the full test run when isolating failures.

| Original root | Refactor risk | Focused verification |
| --- | --- | --- |
| C1 + Root 2 auth/rate-limit | Revoked/deleted sessions keep access; rate-limit semantics drift; money paths accept dev fallback | `node --test --test-concurrency=1 test/auth-api.test.js test/auth-service.test.js test/auth-security-repository.test.js test/auth-refresh-token-repository.test.js test/auth-login-enumeration.test.js test/rate-limit.test.js test/billing-api.test.js test/render-endpoints.test.js test/share-flow.test.js` |
| C2 error envelope | iOS/web/admin break because error shape silently changes | `node --test --test-concurrency=1 test/auth-api.test.js test/render-endpoints.test.js test/story-start.test.js test/story-to-track-contract.test.js test/share-flow.test.js`; inspect `docs/api/error-envelope.md` and OpenAPI output for flat-envelope consistency |
| Root 1 repositories | Route/service/job/workflow SQL extraction changes rows, transactions, idempotency, or response shapes | `node --test --test-concurrency=1 test/share-token-repository.test.js test/receiver-session-repository.test.js test/track-library-repository.test.js test/track-version-repository.test.js test/poem-library-repository.test.js test/story-repository.test.js test/enrollment-session-repository.test.js test/job-durability-repository.test.js test/dead-letter-queue-repository.test.js test/gift-*-repository.test.js test/admin-*-repository.test.js` plus the direct-persistence scan |
| Root 3a/3b server and gift extraction | Fastify plugin wiring, decorators, gift dispatch timers, webhooks, or startup jobs regress | `node --test --test-concurrency=1 test/http-bootstrap.test.js test/hosting-hardening.test.js test/gifts.test.js test/gift-webhooks.test.js test/gift-dispatch-repository.test.js test/gift-reservation-repository.test.js test/gift-wallet-repository.test.js test/gift-order-repository.test.js` |
| Root 4 provider/runtime config | Provider availability, retry, timeout, storage path, or env normalization drifts between server and worker | `node --test --test-concurrency=1 test/providers-http.test.js test/provider-runtime-config.test.js test/provider-registry.test.js test/music-provider-config.test.js test/stt-config.test.js test/whisper-provider.test.js test/elevenlabs-voice-provider.test.js test/suno-provider.test.js test/storage-keys.test.js` |
| Root 5 workflow runner registry | Step extraction changes job polling, render completion, DLQ, artifact hydration, billing restore, or provider lock behavior | `node --test --test-concurrency=1 test/workflows/steps.test.js test/workflows/suno-task-orchestrator.test.js test/workflows/provider-artifact-hydration.test.js test/workflows/render-contract.test.js test/workflows/render-contract-provider-lock.test.js test/workflows/personalized-highway.test.js test/workflows/dlq.test.js test/workflows/dlq-auto-reprocess.test.js test/workflows/durability.test.js test/ready-step-s3-ordering.test.js test/render-full-billing-atomicity.test.js` |
| Root 6 admin/client-config split | Admin auth/roles, pagination, response envelopes, service ownership, audit writes, or public `/app/config` regress | `npm run admin:build`; `node --test --test-concurrency=1 test/app-config-route.test.js test/client-config-service.test.js test/admin-*-routes.test.js test/admin-*-service.test.js test/admin-audit-service.test.js` |
| Root 7 writer decomposition | Story readiness, turn decision, song contract, lyric fidelity, or V3 helper parity changes | `node --test --test-concurrency=1 test/writer/song-contract.test.js test/writer/songwriter-fidelity.test.js test/writer/e2e-story-to-lyrics.test.js test/writer/v3/extracted-helper-parity.test.js test/writer/v3/e2e-story-flow.test.js test/writer/v3/orchestration.test.js test/writer/v3/readiness-contract.test.js test/writer/v3/revision-semantics.test.js test/story-*-contract.test.js` |
| Root 8 cleanup sweep | Deleted code still had hidden callers; dead paths removed behavior | `npm test`; targeted `rg` for removed export names from the cleanup commit; run `node --check` on any touched executable JS not covered by tests |
| Root 9 migrations | SQLite/Postgres drift, retired tables, old migration runners, or schema repair order regress | `npm run verify:migrations`; `node --test --test-concurrency=1 test/database/migration-runner.test.js test/database/postgres-migration.test.js test/database/postgres-core-schema-repair.test.js test/postgres-schema-parity.test.js` |
| Root 10 storage/OpenAPI | Storage adapters diverge; public OpenAPI exposes internal/admin routes or misses core routes | `node --test --test-concurrency=1 test/storage/local.test.js test/storage/s3.test.js test/storage/integration.test.js test/storage-security.test.js test/openapi-contract.test.js`; manually fetch `/openapi.json` from local API and verify admin/internal/debug/webhook/marketing routes are excluded |
| Root 11 cross-surface create/share/admin/web-player | SwiftUI selected payloads go stale; gift-funded create loses funding context; web-player app-only behavior regresses; admin async state races | Backend: `node --test --test-concurrency=1 test/story-to-track-contract.test.js test/story-billing.test.js test/gift-funding-repository.test.js test/gift-reservation-repository.test.js test/share-app-only.test.js test/share-embed.test.js test/share-player-attribution.test.js`; Admin: `npm run admin:build`; Web: `node --check web-player/player.js` and share-player suites; iOS: simulator checks below |

If shell glob expansion for `test/admin-*-routes.test.js`, `test/admin-*-service.test.js`, or `test/gift-*-repository.test.js` is not supported by the current shell, expand those groups with `rg --files test | rg '<pattern>'` and pass the explicit file list to `node --test`.

## Phase 4 - End-To-End Flow Smoke

Use seeded fixtures or a staging account. These are behavior checks, not only unit tests.

1. Auth and identity:
   - Signup/login/refresh/logout.
   - Revoked session immediately fails a protected money path such as `POST /tracks`.
   - Soft-deleted user cannot access protected routes.

2. Story to song:
   - Start story, continue, confirm/revise, convert to track, approve lyrics, request render, poll job, read track from library.
   - Confirm track/version status transitions and audit entries.

3. Gift-funded creation:
   - Create or seed a gift reservation.
   - Convert story to track/poem with `funding_source = "gift_wallet"`.
   - Render without subscription entitlement spend.
   - Confirm legacy `gift_token` fixtures still read correctly.

4. Render pipeline:
   - Request standard render and provider-complete fixture render.
   - Confirm job polling waits for settled manual `runner.tick()` dispatch in tests.
   - Force a retryable provider failure and verify retry/DLQ behavior is unchanged.

5. Share-once and app-only:
   - Unbound web share streams when allowed.
   - First app claim binds the token.
   - Same-device app stream succeeds.
   - Different-device access is denied.
   - Claimed app-only browser path does not create an audio element and routes to app wall.
   - Revoke/expired paths return the documented error presentation.

6. Admin operations:
   - Admin login/session.
   - Overview, growth, shares, funnel/analytics, users, billing, jobs/DLQ, provider config, moderation, gift ops, blog, marketing, security config, security observability.
   - Mutating routes create audit entries with admin actor and reason where required.

7. App config and public discovery:
   - `/app/config` returns the mobile client contract.
   - `/health` and `/health/providers` reflect normalized provider config.
   - `/openapi.json` serves the filtered public contract.

## Phase 5 - iOS And Cross-Surface UI Verification

Use the repo-local `porizo-swiftui-release-workflow` as the entry point for iOS validation. Root 11 specifically requires simulator coverage beyond backend tests.

Required simulator/manual flows:

- Auth bypass fixture and normal auth gate.
- Create entry with selected payload via `.sheet(item:)`, `.fullScreenCover(item:)`, or typed `ActiveSheet`.
- Gift-funded create entry and offline gift fixture.
- Upgrade/paywall entry with selected payload.
- Render wait/status and library playback.
- Share postcard long recipient name, missing link, PIN disclosure expand/collapse, dark mode, Dynamic Type, and VoiceOver labels.
- Recorded Argent checkpoints:
  - `.argent/flows/root11-create-flow-fixture.yaml`
  - `.argent/flows/root11-gift-flow-fixture.yaml`
  - `.argent/flows/root11-share-postcard-fixture.yaml`

Acceptance:

- No stale or empty selected payload launches.
- Gift-funded create does not call backend reservation/schedule fetches in the offline simulator fixture.
- Existing warning budget is unchanged; the known PhoneNumberKit deprecation may remain, but no new Root 11 simulator errors are accepted.

## Phase 6 - Production/Staging Verification For Revenue-Adjacent Roots

Run only with Ambrose-approved credentials and environment.

- C1/Root 2: revoke a live/staging session and verify a money path immediately returns 401.
- Billing/admin: run subscription preflight and verify plan/product mapping before touching live App Store Connect or StoreKit behavior.
- Gift dispatch: send a staging gift through the dispatch pipeline, verify provider receipt, final status, outbox state, and audit log.
- Share claim: verify first-claim-wins on two real devices or simulator/device pair if attestation is not enforced in staging.
- Provider config: verify `/health/providers` reports expected Suno/Whisper/ElevenLabs/storage status for the target environment.

## Phase 7 - Documentation And Handoff Gate

Before declaring the refactor verified, update or confirm:

- `docs/architecture/architecture-map-2026-06.md`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture-and-flows.md`
- `docs/validation/root11-simulator-flows-2026-06-29.md` if Root 11 simulator evidence changes

Final acceptance checklist:

- All commands run are listed with pass/fail status and exact date.
- Every failed command is fixed or explicitly accepted by Ambrose as deferred.
- Any root that could not be empirically verified is listed under residual risk with owner, blocker, and next command.
- Worktree is clean or only contains explicitly named validation artifacts.
- No unsupported claim is made that the refactor is safe because code review passed; provider behavior, real-device behavior, and production revenue checks require empirical evidence.
