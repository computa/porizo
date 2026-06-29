# Porizo Project — Architecture Map (2026-06-27)

**Status:** Current-state map. Honest, not aspirational. Updated after local
execution of C1, the Root 3a HTTP/share/schema mechanical extraction, and the
Root 1 repository slices for receiver sessions, Blog CMS, cold-email
persistence including admin read/PATCH paths, event telemetry persistence,
share-followup persistence, identity/contact persistence, attribution persistence
including admin Apple Ads keyword-map persistence, download-event ingest,
user email-preference persistence, feature-flag persistence, GDPR audit
persistence, enrollment cleanup persistence, public/admin app-config
persistence, subscription plan/trial config persistence, artwork-job persistence,
artwork-barrier readiness persistence, subscription-sync selection persistence,
enrollment-session lifecycle persistence, gift-dispatch scheduler/outbox
state-transition/receipt plus server dispatch-lock/final-status persistence, gift-order management/create/finalize
persistence, gift share schedule/revoke persistence,
gift-delivery incident persistence, gift-funding support persistence,
gift reservation route persistence and gift-funded track render spend
validation,
gift-wallet row/balance/ledger and gift-token song-spend persistence,
gift-content validation read persistence,
artwork route share-token and owner-access persistence,
phone-verification persistence, OneSignal tag-sync persistence,
share-token creation/idempotency persistence,
auth-route identity bootstrap compensation cleanup,
phone-registration-token persistence,
auth cross-identifier lookup persistence,
auth session lifecycle and access-token session validation persistence,
auth rate-limit persistence and in-memory fast-path ownership,
auth receiver-attribution fallback persistence,
auth profile/contact/username read-write persistence,
auth provider-linking maintenance persistence,
auth credential persistence,
auth security event/lockout persistence,
auth one-time token persistence,
auth refresh-token persistence,
GDPR data-export persistence,
job durability and render job-read persistence,
workflow DLQ service persistence,
device registration and push-token lookup persistence,
personalized voice active-profile validation persistence,
voice profile route read persistence,
story V3 orchestration execution/event persistence,
story route track/poem library-entry persistence,
poem route library listing/removal/active-entry persistence,
server-injected poem library read/upsert persistence,
track route library listing/removal persistence,
server-injected track library read/upsert persistence,
admin marketing contact/campaign/push/engagement persistence, voice-provider
profile persistence, admin provider/queue control-plane persistence, admin
onboarding-sample persistence, admin job/DLQ operations persistence,
admin story-session read persistence, admin moderation persistence, admin
analytics event/cohort/user-read persistence, generic admin audit-log
persistence, admin billing/revenue dashboard and user-billing snapshot read
and gift-bundle management persistence, admin demo-share persistence,
admin track-transfer persistence,
admin share-management persistence,
admin user search/detail/stats read persistence,
admin overview, voice-enrollment, render-pipeline, risk, cost, KPI aggregate persistence,
admin entitlement tier update persistence, admin security observability persistence,
admin user mutation persistence, admin user session/voice-control persistence,
admin music diagnostics persistence, admin growth metrics persistence, admin
growth-attribution dashboard persistence, admin Apple Ads keyword-map
persistence, admin webhook-health persistence, admin gift-ops read persistence,
admin-auth user/session/password-reset persistence,
Apple webhook notification/subscription persistence,
account-deletion persistence, account-deletion
durable-storage cleanup, plus the adjacent voice-provider worker/runner/enrollment/account
cleanup, the Suno task submit/poll/recovery orchestrator extraction, admin
onboarding-sample service-boundary extraction, admin security/app-update config
service-boundary extraction, admin provider/queue control-plane
service-boundary extraction, admin moderation service-boundary extraction,
admin job/DLQ operations service-boundary extraction, admin user
read service-boundary extraction, admin user mutation service-boundary
extraction, admin entitlement tier-update service-boundary extraction, admin
analytics service-boundary extraction, admin growth/attribution
service-boundary extraction, admin user session/voice-control service-boundary
extraction, admin
share-management service-boundary extraction, and admin security-observability
service-boundary extraction, and admin music-diagnostics service-boundary
extraction.

**Scope of this map:** project-wide at the boundary level, with a deeper backend map for `src/**` because that is where the first architecture-debt pass found the highest concentration of shared correctness risk. iOS, admin, and web-player are included as first-class surfaces and are handled in Root 11 of the debt register after backend contracts stabilize.

**Relationship to `docs/architecture-and-flows.md`:** that document remains the full product-flow and target-architecture source of truth. This map is the current implementation/debt map. Later roots must keep this map and `docs/architecture-and-flows.md` reconciled as behavior moves.

---

## 0. Project-wide surface map

Porizo is not only the Fastify API. The maintainability plan must account for every surface that owns part of the user-visible contract.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Native iOS app: PorizoApp/PorizoApp                                        │
│ - SwiftUI create, gift, story, playback, share, auth, billing surfaces     │
│ - Large state owners: RootView, WarmCanvasFlowView, GiftSendFlowView,      │
│   AuthManager, RenderController                                            │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ HTTP + deep links + StoreKit + push
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Backend API + worker: src/**                                               │
│ - Fastify API, auth, billing, sharing, gifts, story, render queue, jobs     │
│ - External AI/provider orchestration and storage/database access            │
└──────────────┬─────────────────────────────┬───────────────────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────────┐  ┌──────────────────────────────────────────┐
│ Web player: web-player/**    │  │ Admin UI: admin/src/**                   │
│ - Recipient share playback   │  │ - Ops, billing, users, marketing,        │
│ - App-only save wall         │  │   security, jobs, blog controls          │
│ - Device/session behavior    │  │ - Depends on stable admin API contracts  │
└──────────────────────────────┘  └──────────────────────────────────────────┘
```

### Cross-surface contracts that must not drift

- **Create flow:** iOS story/create state ↔ backend story/session/track/render contracts.
- **Share/device claim:** iOS receiver/deep-link flow and web-player app wall ↔ backend share/session/device-token enforcement.
- **Billing and entitlements:** iOS StoreKit state ↔ backend receipt validation, entitlements, and admin billing controls.
- **Render status and playback:** iOS polling/playback and web-player stream behavior ↔ backend job/version/storage URLs.
- **Admin operations:** admin UI assumptions ↔ backend admin dashboard API envelopes, pagination, auth, and role checks.

### Full-codebase hotspots

| Surface | Main hotspot | Why it matters |
| ------- | ------------ | -------------- |
| Backend API/worker | `src/server.js`, `src/workflows/runner.js`, fat routes, missing repositories | Shared correctness and testability bottleneck for every client |
| iOS app | `RootView.swift`, `WarmCanvasFlowView.swift`, `GiftSendFlowView.swift`, `AuthManager.swift`, render/create controllers | State ownership and presentation payload drift can create stale launches, duplicate work, or failed handoffs |
| Admin UI | large page components and one generic `useApi` hook | Admin behavior depends on unstated API contracts; repeated fetch/save/poll flows are hard to reason about |
| Web player | `web-player/player.js` | Recipient app-only saving, device/session behavior, and share attribution are product constraints, not decorative UI |

---

## 1. System at a glance

Porizo is a personalized-song generation platform. The backend is a **functional-JavaScript monolith** on Fastify, fronting a DB-backed job queue that orchestrates external AI providers (Suno, ElevenLabs, Seed-VC, Replicate, Whisper) to render songs, plus the full commerce surface (auth, billing, Apple/Google receipts, gifting, sharing).

```
                         ┌─────────────────────────────────────────────┐
   iOS app  ──HTTP──▶    │  Fastify (src/server.js + plugins/)          │
   web      ──HTTP──▶    │  - HTTP bootstrap split to plugins/          │
                         │  - 349 routes across src/routes/*            │
                         │  - ⚠ STILL: gift subsystem, auth mw, route   │
                         │    wiring, webhooks, startup jobs inline     │
                         └───────────────┬─────────────────────────────┘
                                         │ register*Routes(app, {deps})
                         ┌───────────────▼─────────────────────────────┐
   routes/ (28.6k LOC) ─▶│  business logic + inline SQL + provider calls│  ⚠ mixed controller layer
                         └───────────────┬─────────────────────────────┘
                                         │ (mostly) calls services / writer
                         ┌───────────────▼─────────────────────────────┐
   services/ (28.6k LOC)▶│  domain logic + inline SQL (193 simple hits) │  ⚠ partial repository layer
                         │  revenue path: subscription-manager,         │
                         │  auth-service, receipt validators (CLEAN)    │
                         └───────────────┬─────────────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
  writer/ (22k LOC)            workflows/runner.js (3.6k)        providers/ (6k LOC)
  v3 story engine +            DB-queue poller +                 9 external integrations
  songwriter (lyrics)          step registry + Suno tasks        ⚠ no common interface
  ⚠ circular dep               ⚠ large coordinator             ⚠ 2 bypass shared http
                                         │
                         ┌───────────────▼─────────────────────────────┐
                         │  database/ — SQLite(test)/Postgres(prod)     │  ✅ CLEAN adapter
                         │  adapter is the one well-abstracted boundary │
                         └──────────────────────────────────────────────┘
```

---

## 2. Subsystem inventory (verified)

| Subsystem        | LOC    | What it is                                                                                                                                                                                                                                                                                                                 | Health                         |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/server.js`  | 3,092  | Still a large composition module, but Root 3a moved Fastify bootstrap, static/security setup, body parsers, validation schemas, and share URL builders out to leaf modules. It still owns the gift-delivery subsystem, auth middleware (`requireUserId`), rate limiting, media helpers, inline webhook handlers, route dependency wiring, and startup jobs/timers. | 🟠 improving, still too large  |
| `src/routes/`    | 28,564 | 349 endpoints across 46 files. Thin HTTP layer in places (`story.js`→writer facade, `billing.js`→subscription manager), but several public route files still carry business logic, direct persistence calls, and provider calls. Root 6 split the former monolithic 133-admin-route controller into a 605-line `src/routes/admin.js` registrar shell plus 28 `src/routes/admin/*.js` modules (5,720 LOC total); `/app/config` route registration now lives in `src/routes/client-config.js`. Most admin route persistence now delegates through repositories/services, but large modules such as marketing and blog remain candidates for service-boundary cleanup. | 🟡 mixed; admin split improved |
| `src/services/`  | 28,592 | Domain logic. **Revenue path (subscription-manager, auth-service, apple/google validators, webhook handler) is the cleanest part of the codebase** (factory injection, idempotency, advisory locks). Enrollment audio QC policy now lives in `services/enrollment-qc.js` instead of `utils/`. The repository layer now covers many auth, billing, admin, gift, story, track, poem, attribution, account-deletion, event, and provider-control persistence paths; remaining risk is uneven service boundaries and raw SQL in older domains. `client-config-service.js` owns public mobile app-config composition; `AdminService.getAppConfig()` is only a compatibility delegate. `services/admin/pagination.js` owns shared admin limit/offset bounds, `services/admin/provider-config-service.js` owns STT/music provider-config service logic, `services/admin/feature-flag-service.js` owns admin feature-flag shaping/validation/audit behavior, `services/admin/onboarding-sample-service.js` owns admin onboarding sample validation, ID/timestamp generation, active-sample fallback, persistence orchestration, and audit behavior, `services/admin/security-config-service.js` owns admin security-config defaults/persistence, App Store version sync, and public iOS app-update policy projection, `services/admin/control-plane-service.js` owns provider/queue status read delegation, pause/drain timestamping, and admin audit behavior, `services/admin/moderation-service.js` owns moderation queue bounds, override result mapping, and audit behavior, `services/admin/job-ops-service.js` owns job/DLQ windows, bounded listing, retry/reprocess result mapping, step-history delegation, and successful mutation audits, `services/admin/user-read-service.js` owns admin user search bounds, attribution enrichment/merge, stats conversion formatting, detail fan-out, and missing-user no-fanout behavior, `services/admin/user-mutation-service.js` owns risk/lock/profile mutation orchestration, fixed one-year lock calculation, audit-before-delete ordering, bulk action sequencing, profile allowlist filtering, and attribution override audit envelopes, `services/admin/entitlements-service.js` owns admin tier-update validation, previous-tier defaulting, repository timestamp injection, and entitlement audit metadata while preserving existing-row `updated_at` semantics, `services/admin/analytics-service.js` owns admin analytics aggregate caching, days/limit clamping, funnel hop policy, conversion-rate formatting, and traceable user-event read audits, `services/admin/growth-service.js` owns attribution health delegation, UTM attribution merge/sort/rate formatting, Apple Ads keyword-map bounds, row normalization, and bulk-sync audit metadata, `services/admin/user-session-control-service.js` owns force-reverify and session-revocation result mapping, timestamps, and audit behavior, `services/admin/share-management-service.js` owns song share and poem-share listing, mutation result mapping, and audit behavior, `services/admin/security-observability-service.js` owns auth/audit/rate-limit/consent observability shaping, date windows, action escaping, and rate-limit reset audit behavior, `services/admin/music-diagnostics-service.js` owns admin music diagnostics shaping, malformed JSON fallback, provider/status filtering, provider precedence, and latest-job error attachment, `services/admin/story-session-service.js` owns bounded admin story-session listing/detail delegation, `services/admin/webhook-health-service.js` owns admin webhook-health audit-window shaping, `services/admin/system-health-service.js` owns job/DLQ system-health response shaping, and `services/admin/metrics-service.js` owns overview/cost/enrollment/render/risk/teaser/share metrics windowing, growth rate formatting, and risk escalation parsing. `admin-service.js` is still a large compatibility facade with many concern-specific methods, so Root 6 route extraction is complete but admin-service decomposition remains. | 🟡 mixed; admin god-service    |
| `src/writer/`    | 22,339 | Song/lyrics generation. `v3/` is the live story engine; `songwriter.js` is the live lyrics layer; legacy `v2/` has been deleted. Root 7 has broken the songwriter↔v3 contract-validation cycle through `song-contract.js`, moved songwriter prompt budgeting to `songwriter/prompt-budget.js`, moved poem readiness to `v3/quality/poem-readiness.js`, moved question targeting to `v3/quality/question-targeting.js`, moved Labov gap analysis to `v3/quality/labov-gap-analysis.js`, moved deterministic slot-gap policy to `v3/quality/slot-gap-model.js`, moved legacy story gap analysis to `v3/quality/story-gap-analysis.js`, moved story element scoring to `v3/quality/story-elements.js`, moved semantic story package repair to `v3/semantic-story-package.js`, moved runtime question helpers to `v3/runtime-questions.js`, moved ready-confirmation text to `v3/ready-confirmation.js`, moved turn-decision result assembly and `resolveTurnDecision` orchestration to `v3/turn-decision.js`, and centralized V3 sentence splitting in `v3/utils.js`. Direct parity tests now cover the extracted contract sanitizer/validator, runtime question guards, ready-confirmation text, V3 text utilities, and shared `factText` behavior. Legacy reasoner path remains as fallback; `v3/index.js` and `songwriter.js` are still large. | 🟡 improving; god-files remain |
| `src/workflows/` | 7,323  | `runner.js` (3,588) is now the DB-queue poller, completion coordinator, and dependency composer for the step registry. The 12 render steps live in `src/workflows/steps/*.js`, shared instrumental/full and guide-vocal/full logic is consolidated, and Suno submit/poll/recovery state now lives in `src/workflows/suno-task-orchestrator.js` with direct characterization tests. Circuit-breaker, DLQ, durability, and render step classification are separate workflow modules; durability jobs-row persistence now lives behind `job-durability-repository.js`, workflow DLQ service persistence now lives behind `dead-letter-queue-repository.js`, and render-completion push-token lookup now lives behind `device-repository.js`. Artwork/audio barrier readiness and PG notify SQL now live behind `artwork-barrier-repository.js`.                        | 🟡 improving; runner closure still large |
| `src/jobs/`      | 1,899  | 7 independent `setInterval` cron-style jobs (cleanup, gift-dispatch, sub-sync, cold-email, aggregates, share-followups). Consistent pattern, decoupled from runner. Cleanup job now delegates expired enrollment-session selection/deletion to `enrollment-cleanup-repository.js`; artwork job now delegates track/version/entitlement/artwork/jobs-row persistence to `artwork-job-repository.js` and guards terminal artwork job rows against stale recovery/retry regressions; subscription sync now delegates renewal/grace-period selectors to `subscription-sync-repository.js`; gift-dispatch scheduler polling/recovery now delegates to `gift-dispatch-repository.js`; the server-owned gift dispatcher also delegates outbox creation/existence, dispatch-attempt ledger inserts, sent/failed delivery transitions, provider receipt lookup/update, per-gift stale sending recovery, dispatch locks, due-row selection/locking, aggregate observability updates, final dispatch status updates, and crash recovery to the same repository. | 🟢 healthy                     |
| `src/providers/` | 6,614  | 9 external integrations + routing. The old lyrics pass-through shim has been deleted; lyrics callers import `writer/songwriter.js` directly. Shared `http.js` (retry on 5xx) + `polling.js` exist, and Whisper/ElevenLabs voice transport plus voice-conversion runtime config now flow through the provider config/HTTP boundary. `src/providers/index.js` is now the provider capability registry used by music routing; Suno is the only current provider-complete song generator, while ElevenLabs remains TTS/voice-conversion only. Provider/runner local track-version path construction now uses `getVersionDir()` instead of hand-built storage paths. `voice.js` no longer owns the personalized active-profile SQL check or ambient Replicate token fallback; those reads are repository-backed/injected through runtime config.                                                       | 🟡 improving provider boundary |
| `src/storage/`   | 1,635  | `createStorageProvider()` factory → local-FS or S3. Both local and S3 now expose `listObjects`; S3 listing returns continuation metadata and account deletion consumes it. S3 now exposes a paginated `listKeys` alias. `verifyPresignedRequest` remains intentionally local-only because `/storage/upload` is a local-dev endpoint and S3 uploads go directly to S3/R2 signed URLs.                    | 🟢 storage parity             |
| `src/database/`  | 6,793  | **The one genuinely clean abstraction.** `getDatabase()` selects SQLite(test)/Postgres(prod) adapters with a transparent placeholder-rewrite shim. Same API both sides. Repositories now exist for story sessions, story V3 orchestration execution/event persistence, story route track/poem library-entry persistence, poem route library listing/removal/active-entry persistence, server-injected poem library read/upsert persistence, track route library listing/removal persistence, server-injected track library read/upsert persistence, receiver sessions including auth receiver-attribution fallback, Blog CMS, cold-email persistence plus admin cold-email read/PATCH queries, event telemetry plus admin analytics event/cohort/user-read and generic admin audit-log persistence, admin billing/revenue dashboard, gift-bundle management, and user-billing snapshot read persistence, admin webhook-health persistence, admin gift-ops read persistence, gift-delivery incident persistence, gift-funding support persistence, gift reservation route persistence and gift-funded track render spend validation, gift-wallet row/balance/ledger and gift-token song-spend persistence, gift-dispatch scheduler/outbox state-transition/receipt/dispatch-lock/final-status persistence, gift-order management persistence, gift-content validation reads, artwork route access reads, device registration and push-token lookup persistence, phone-verification persistence, auth rate-limit persistence, auth profile/contact/username read-write persistence, auth provider-linking maintenance persistence, auth credential persistence, auth security event/lockout persistence, auth one-time token persistence, auth refresh-token persistence, GDPR data-export reads, OneSignal tag-sync persistence, share-token creation/idempotency persistence, job durability and render job-read persistence, workflow DLQ service persistence, personalized voice active-profile validation and voice profile route read persistence, admin demo-share persistence, admin track-transfer persistence, admin share-management persistence, admin user search/detail/stats read and mutation persistence, admin session/voice-control persistence, admin music diagnostics persistence, admin growth metrics persistence, admin growth-attribution dashboard persistence, admin Apple Ads keyword-map persistence, subscription plan/trial config persistence, admin overview, voice-enrollment, render-pipeline, risk, cost metrics, KPI aggregate persistence, admin entitlement tier update persistence, admin security observability persistence, admin-auth user/session/password-reset persistence, Apple webhook notification/subscription persistence, share-followup persistence, identity/contact persistence, attribution persistence including `/download` event ingest and Apple Ads token/result capture, track-version allocation/render read persistence, admin marketing contact/campaign/push/engagement persistence, admin provider/queue control-plane persistence, admin onboarding-sample persistence, admin job/DLQ operations persistence, admin story-session read persistence, admin moderation persistence, user email-preference persistence, feature-flag persistence, GDPR audit inserts, enrollment cleanup persistence, public/admin app-config persistence, artwork-job persistence, artwork-barrier readiness persistence, subscription-sync selection persistence, enrollment-session lifecycle persistence, voice-provider profile/job persistence, and account-deletion persistence; the pattern is still not generalized across the rest of the domain.        | 🟢 adapter clean / 🟡 partial repos |
| `src/utils/`     | 3,427  | Mostly healthy after Root 8 moved enrollment QC and render step classification into domain-owned modules. Shared `getFFmpegPath` and `ensureDir` helpers are centralized. | 🟢 healthier shared helpers    |
| `src/plugins/`   | 1,937  | Fastify HTTP bootstrap, markdown content negotiation, gift-delivery runtime boundary, and runtime OpenAPI generation. `openapi.js` registers the Fastify Swagger route collector early and filters the public `/openapi.json` contract away from admin/internal/debug/marketing surfaces.                                                                                                                                                                                                                          | 🟢 healthy                     |
| `src/schemas/`   | 137    | Extracted HTTP validation schema constants consumed by route modules.                                                                                                                                                                                                                                                       | 🟢 healthy                     |

---

## 3. What's actually GOOD (don't break these)

The codebase is not uniformly distressed. These are model patterns to preserve and extend:

1. **The DB adapter + repository pattern** (`src/database/`) — SQLite/Postgres dual-mode behind one API with transparent `$1`↔`?` rewriting. `story-repository.js` (story sessions, story V3 orchestration execution/event persistence, and story route track/poem library-entry persistence), `poem-library-repository.js`, `track-library-repository.js`, `gift-reservation-repository.js`, `gift-wallet-repository.js`, `gift-order-repository.js`, `receiver-session-repository.js`, `blog-repository.js`, `cold-email-repository.js` (including admin cold-email read/PATCH persistence), `events-repository.js` (including admin analytics event/cohort/user-read and generic admin audit-log persistence), `admin-billing-repository.js` (admin billing/revenue dashboard and user-billing snapshot read persistence), `admin-gift-ops-repository.js`, `gift-dispatch-repository.js`, `gift-delivery-incident-repository.js`, `gift-funding-repository.js`, `gift-content-repository.js`, `artwork-access-repository.js`, `device-repository.js`, `phone-verification-repository.js`, `phone-registration-token-repository.js`, `auth-session-repository.js`, `auth-rate-limit-repository.js`, `auth-profile-repository.js`, `auth-security-repository.js`, `auth-one-time-token-repository.js`, `auth-refresh-token-repository.js`, `gdpr-data-export-repository.js`, `admin-auth-repository.js`, `apple-webhook-repository.js`, `one-signal-tag-sync-repository.js`, `share-token-repository.js`, `job-durability-repository.js`, `dead-letter-queue-repository.js`, `admin-demo-share-repository.js`, `admin-track-transfer-repository.js`, `admin-share-management-repository.js`, `admin-user-read-repository.js`, `admin-user-mutation-repository.js`, `admin-user-session-control-repository.js`, `admin-music-diagnostics-repository.js`, `admin-metrics-repository.js`, `share-followup-repository.js`, `identity-repository.js` (including auth bootstrap compensation cleanup, cross-identifier duplicate-account reads, and latest active identity lookup), `attribution-repository.js`, `feature-flags-repository.js`, `gdpr-audit-repository.js`, `enrollment-cleanup-repository.js`, `enrollment-session-repository.js`, `app-config-repository.js`, `artwork-job-repository.js`, `admin-control-repository.js`, `admin-onboarding-sample-repository.js`, `admin-job-ops-repository.js`, `admin-story-session-repository.js`, `admin-moderation-repository.js`, `voice-provider-profile-repository.js`, and `account-deletion-repository.js` are now concrete examples of the intended dependency direction.
   `auth-provider-linking-repository.js` is the current auth-specific provider maintenance example for Apple/social/phone link cleanup.
2. **The revenue-path services** — `subscription-manager.js`, `apple-receipt-validator.js`, `apple-webhook-handler.js`, `google-receipt-validator.js` use factory injection, idempotency (notification log), DLQ, and Postgres advisory locks. This is the **template** for how every service boundary should look.
3. **The jobs/ directory** — 7 cron jobs, uniform `start<Name>Job({db})` shape, fully decoupled from the runner.
4. **Route registration** — `server.js` already extracts 20+ route groups via `register*Routes(app, deps)`. The mechanism for de-godding server.js already exists; it just wasn't applied to gift-delivery, media, and webhooks.
5. **`http.js` + `polling.js`** — a real shared retry/backoff layer. The fix for provider inconsistency is "route the 2 stragglers through it," not "build something new."

---

## 4. The cross-cutting structural debts (system-wide, not file-local)

These are the patterns that recur across many files — the true architectural roots.

### D1 — No repository layer (the keystone debt)

Hundreds of simple inline `db.prepare`/`db.query` calls remain in `src/routes`
and `src/services`. The receiver-session, Blog CMS, cold-email, event
telemetry, generic admin audit-log persistence, gift-content validation reads,
artwork route access reads, device registration and push-token lookup persistence, share-followup, identity/contact, attribution including Apple Ads
route persistence and admin Apple Ads keyword-map persistence, track-version allocation, feature-flag, GDPR audit,
enrollment cleanup, enrollment-session lifecycle, public/admin app-config,
subscription plan/trial config, artwork-barrier readiness, subscription-sync selection, admin onboarding-sample, admin job/DLQ operations, admin story-session,
admin moderation, admin track-transfer, admin share-management, admin user
search/detail/stats reads, mutation persistence, and session/voice-control
persistence, admin music diagnostics, admin growth metrics, admin
growth-attribution dashboard persistence, admin Apple Ads keyword-map
persistence, admin overview/voice-enrollment/render-pipeline/risk/cost metrics reads, KPI aggregate persistence, admin entitlement tier update persistence, admin security observability persistence, OneSignal tag-sync persistence, share-token creation/idempotency persistence, job durability persistence, workflow DLQ service persistence, personalized voice active-profile validation persistence, artwork-job,
story V3 orchestration execution/event persistence, story route track/poem
library-entry persistence, poem route library listing/removal/active-entry
persistence, server-injected poem library read/upsert persistence,
voice-provider profile, and
account-deletion slices are now off that list, but schema changes still
require grep-and-replace across many files, and many unit tests still need a
live DB. The DB adapter and current
repositories prove the pattern is achievable — it was just never generalized.

Important caveat: account deletion is now a real repository boundary for the
delete/scrub cascade, including transaction-scoped SQLite/Postgres semantics.
It also deletes configured storage-provider artifacts under the user-owned
`tracks/`, `poems/`, `enrollment/raw/`, `enrollment/clean/`, and
`voice_profiles/` prefixes. Remote provider-side artifacts outside the storage
provider contract remain an empirical/provider-contract risk, not something the
local repository boundary can prove.

### D2 — God modules

`buildServer()` (3,092 lines), `runner.js` `startJobRunner` (still-large closure inside a 3,588-line file), `admin-service.js` (2,539 lines / 94 detected method-like entries), `writer/v3/index.js` (2,829), `songwriter.js` (3,569). The former `routes/admin.js` god controller is now a 605-line registrar shell over 28 admin route modules, Root 5 has moved render steps plus Suno task orchestration out of the runner, and Root 7 has moved `writer/v3/quality.js` down to a 650-line compatibility facade over leaf quality modules, so remaining D2 risk has shifted from route-handler and quality-policy concentration to service, workflow completion coordination, and unresolved writer orchestration/lyrics god files.

### D3 — Duplicated cross-cutting concerns (DRY)

- **3 rate-limiters** with different semantics (`windowMs` vs `windowSeconds`, DB vs in-memory vs mixed). Auth route rate-limit persistence and cache ownership now sit behind `auth-rate-limit-repository.js`, but server/enrollment rate-limit semantics are still separate. The `rate_limits` table already suffered an integer-overflow outage; divergent copies make that class of bug recur.
- **2 auth guards** with **different security guarantees** (see D5 — this is a correctness defect, not just DRY).
- **2 `sendError`** with divergent signatures (server.js 5-arg with `details` flattening vs auth.js 4-arg, no details).
- `splitSentences` ×3, `factText` ×2, retry-with-sleep reinvented ×3, storage-path construction ×3. `getFFmpegPath` and `ensureDir` are now centralized.

### D4 — No common provider abstraction (DIP)

9 providers, no shared interface. `runner.js` imports 29 concrete modules directly. `whisper.js`/`elevenlabs-voice.js` use raw fetch with no retry → a transient 502 in the lyrics-alignment hot path fails a whole render that Suno/ElevenLabs would have retried.

### D5 — Two CORRECTNESS/SECURITY defects hiding inside the "modularity" ask ⚠️

These are **not** cosmetic. They were surfaced by the formal review and must be treated as latent bugs:

- **Auth-guard revocation gap (CRITICAL, locally fixed).** `requireAuth`
  (auth.js) already checked `user_sessions ... revoked_at IS NULL`; `requireUserId`
  previously checked only the JWT signature. The current working tree fixes
  `requireUserId` to require a live, unrevoked session and reject soft-deleted
  users. Root 2 still needs to consolidate the duplicate guards into one
  middleware and production verification is still required.
- **Error-envelope drift (CRITICAL for API contract).** The wire error shape is a flat `{error, message, ...adhoc-keys}` bag documented in [`docs/api/error-envelope.md`](../api/error-envelope.md); the documented `E1xx/R2xx/B3xx/S5xx` taxonomy in CLAUDE.md **does not match the actual wire codes** (`RATE_LIMITED`, `VOICE_PROFILE_REQUIRED`, ...). Clients special-case per endpoint.

> These two live on the revenue path and require owner review plus production verification. C1 is patched locally but still needs production verification; C2 should be document-first with no wire change until iOS and API contracts are coordinated.

### D6 — Migration-location divergence (test-fidelity hazard)

Two canonical migration locations remain: `migrations/` (SQLite, 122 SQL files) and `migrations/pg/` (Postgres, 116 SQL files). The abandoned `src/database/migrations/` consolidation has been deleted after tests moved to the live `src/database/postgres.js` migration runner. **12 migration filenames exist in only one mirror** (9 historical SQLite-only, 3 intentionally Postgres-only) after adding SQLite mirrors for the letterbox flags and viral-loop metrics view, current-numbered PG backfill `122_migration_parity_backfill.sql` for the additive voice/OneSignal/download-attribution/job-step-history effects, and paired migration `123_drop_sqlite_legacy_billing_artifacts.sql` for the SQLite side of PG 094/095's retired billing artifacts. `npm run verify:migrations` blocks new unreviewed filename drift while the remaining historical filename divergences are reconciled or kept as documented exceptions.

---

## 5. Live vs dead (simplification targets)

| Item                                          | Verdict                                                                            | Confidence |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| `src/writer/v2/`                              | **Deleted 2026-06-29** — had zero JS files and no live callers                      | ✓ VERIFIED |
| `src/database/migrations/` (runner.js + sql/) | **Deleted 2026-06-29** after tests moved to the live `src/database/postgres.js` migration runner | ✓ VERIFIED |
| `src/db.js`                                   | Production-dead legacy shim; still test-live and deferred until test harness migration | ✓ VERIFIED |
| `src/providers/lyrics.js`                     | **Deleted 2026-06-29** after inlining runtime callers to `writer/songwriter.js`    | ✓ VERIFIED |
| `writer/v3/reasoner.js` legacy path           | Live as fallback only; superseded by `kernel/`; needs observability before removal | ✓ VERIFIED |
| `writer/v3/safety.js`, `monitor.js`           | **Deleted 2026-06-29** after grep/export-name verification showed zero live callers | ✓ VERIFIED |
| `E302_SEEDVC_ERROR: GPU task aborted` string  | **Removed 2026-06-29**; transient voice retry now relies on normalized provider errors | ✓ VERIFIED |

---

## 6. Layering verdict

There is **no enforced layering**. The intended `controller → use-case → repository → gateway` is collapsed:

| Layer that should exist | Where it actually lives                                     |
| ----------------------- | ----------------------------------------------------------- |
| Controller (HTTP only)  | Routes also do business logic + provider calls + SQL        |
| Use-case / service      | Services own raw SQL; one service hides a mobile endpoint   |
| **Repository**          | Partial: story + receiver sessions including auth receiver-attribution fallback + Blog CMS + cold-email including admin read/PATCH persistence + events including admin analytics event/cohort/user-read persistence + admin billing/revenue dashboard, webhook-health, and user-billing snapshot reads + admin demo-share persistence + admin track-transfer persistence + admin share-management persistence + admin user search/detail/stats reads, mutation persistence, and session/voice-control persistence + admin music diagnostics + admin growth metrics + admin overview/voice-enrollment/render-pipeline/risk/cost metrics reads + KPI aggregate persistence + admin entitlement tier update persistence + admin security observability persistence + admin auth persistence + Apple webhook persistence + share followups + identity + auth session lifecycle + auth rate limits + auth credentials + attribution + track-version allocation/render reads + job durability/render job reads + track-library membership + poem-library membership + gift reservations + gift wallet + gift order management + gift dispatch persistence + admin marketing + admin control plane + admin onboarding samples + admin job/DLQ operations + admin story-session reads + admin moderation + feature flags + GDPR audit/data export + enrollment cleanup + enrollment-session lifecycle + public/admin app config + artwork jobs + voice-provider profile + account deletion; hundreds of inline queries remain |
| Provider / gateway      | ✅ `providers/*` is a real boundary (the cleanest layer)    |
| Orchestration           | Split: `runner.js` closure + a subsystem inside `server.js` |

**Formal grades from prior architecture review:** Clean-Architecture overall **D-**; OO design SRP **D** / OCP **C-** / DIP **C-** / DRY **D**; API consistency **D**, error-contract **D**, security-as-API-design **D**. Testability is the dominant defect (**F**) — driven entirely by D1 (no repos) + D2 (god closures).

---

## 7. How to read this map alongside the debt register

This document is the **"what exists."** The companion `architecture-debt-register-2026-06.md` is the **"what to do about it, in what order, at what risk."** It converts the debts above (D1–D6) into sequenced architectural _roots_ that a future `architectural-loop` execution would run one at a time — with the revenue-path items explicitly gated.
