# Porizo Project — Architecture Debt Register & Refactor Plan (2026-06-27)

**Companion to:** `architecture-map-2026-06.md` (the current-state map).
**Status:** EXECUTION IN PROGRESS. C1 and the low-risk Root 3a mechanical
bootstrap/share/schema extraction are implemented and validated in the current
working tree. Root 1 has started: the receiver-session/share-claim, Blog CMS,
cold-email persistence including admin read/PATCH persistence, event telemetry
persistence, share-followup persistence, identity/contact persistence,
attribution persistence,
download-event ingest, Apple Ads attribution route persistence, user
email-preference persistence, feature-flag persistence, GDPR audit persistence,
enrollment cleanup persistence, public/admin app-config persistence, artwork-job
persistence, subscription plan/trial config persistence, artwork-barrier
readiness persistence, subscription-sync selection persistence, enrollment-session
lifecycle persistence, track-version allocation/render-read persistence, and
render job-read persistence, plus admin marketing contact/campaign/push/engagement
persistence, admin provider/queue control-plane persistence, and admin
onboarding-sample persistence slices are extracted and validated locally. Admin
onboarding-sample service-boundary ownership is also extracted and validated
locally. Admin security/app-update config service-boundary ownership is also
extracted and validated locally. Admin provider/queue control-plane
service-boundary ownership is also extracted and validated locally. Admin
moderation service-boundary ownership is also extracted and validated locally.
Admin job/DLQ operations service-boundary ownership is also extracted and
validated locally.
Admin user-read service-boundary ownership is also extracted and validated
locally.
Admin user-mutation service-boundary ownership is also extracted and validated
locally.
Admin entitlement tier-update service-boundary ownership is also extracted and
validated locally.
Admin billing/revenue read service-boundary ownership is also extracted and
validated locally.
Admin analytics service-boundary ownership is also extracted and validated
locally.
Admin growth/attribution service-boundary ownership is also extracted and
validated locally.
Admin user session/voice-control service-boundary ownership is also extracted
and validated locally.
Admin share-management service-boundary ownership is also extracted and
validated locally.
Admin security-observability service-boundary ownership is also extracted and
validated locally.
Admin music-diagnostics service-boundary ownership is also extracted and
validated locally.
Admin metrics service-boundary ownership is also extracted and validated
locally.
Admin job/DLQ operations persistence is also extracted and validated locally.
Gift-dispatch scheduler polling/recovery persistence is also extracted and
validated locally.
Server-owned gift-dispatch outbox/state-transition/receipt/lock/final-status
persistence is also extracted and validated locally.
Gift-delivery incident persistence is also extracted and validated locally.
Gift-funding support persistence is also extracted and validated locally.
Gift reservation route persistence and gift-funded track render spend
validation are also extracted and validated locally.
Gift-wallet row, balance, ledger, receipt-credit reconciliation, and
gift-token song-spend persistence are also extracted and validated locally.
Gift-content validation read persistence is also extracted and validated
locally.
Artwork route share-token and owner-access persistence is also extracted and
validated locally.
Phone-verification persistence is also extracted and validated locally.
OneSignal tag-sync persistence is also extracted and validated locally.
Share-token creation/idempotency persistence is also extracted and validated
locally.
Auth signup/social/phone post-identity compensation cleanup is also extracted
and validated locally.
Phone-registration-token create/consume/cleanup/recent-proof persistence is also
extracted and validated locally.
Auth email/phone/social duplicate-account lookup reads are also extracted and
validated locally.
Auth access-token session validation, route-level session ownership checks,
logout/password-reset session revocation, and refresh deleted-user cleanup are
also extracted and validated locally.
Auth route rate-limit DB writes, cleanup, and in-memory fast-path ownership are
also extracted and validated locally.
Auth credential persistence is also extracted and validated locally.
Auth username availability reads are also extracted and validated locally.
Auth receiver-attribution fallback persistence is also extracted and validated
locally.
Auth refresh-token family/row persistence and rotation transaction queries are
also extracted and validated locally.
GDPR data-export section reads are also extracted and validated locally.
Admin-auth user/session/password-reset persistence is also extracted and
validated locally.
Apple webhook notification idempotency/DLQ/stats and Apple webhook
subscription-state persistence are also extracted and validated locally.
Job durability persistence is also extracted and validated locally.
Workflow DLQ service persistence is also extracted and validated locally.
Device registration persistence and push-token lookup persistence for runner
and sharing notifications are also extracted and validated locally.
Personalized voice active-profile validation is also repository-backed and
validated locally.
Voice profile route read persistence is also repository-backed and validated
locally.
Story V3 orchestration execution/event persistence is also repository-backed
and validated locally.
Story route track/poem library-entry persistence is also repository-backed and
validated locally.
Poem route library listing/removal/active-entry checks are also
repository-backed and validated locally.
Track route library listing/removal persistence and server-injected track
library read/upsert helpers are also repository-backed and validated locally.
Voice-provider profile persistence, account-deletion persistence, and
account-deletion durable-storage cleanup are also extracted and validated
locally. Admin story-session reads, admin moderation persistence, admin
analytics event/cohort/user-read persistence, and generic admin audit-log
persistence are also extracted and validated locally. Admin billing/revenue
dashboard, gift-bundle management, and user-billing snapshot read
persistence are also extracted and validated locally. Admin demo-share
create/list/revoke persistence is extracted and validated locally, with two
route-level hardenings: demo creation now reuses only existing demo tokens
instead of mutating arbitrary gift/manual share rows, and demo-share mutations
now require `admin`/`superadmin` instead of any admin session. Admin
track-transfer persistence is also extracted and validated locally, with
route-level hardening for soft-deleted target users, active render jobs,
audit-actor attribution, stale received-library access, and full share-binding
reset. Admin share-management persistence for song share list/rebind and
poem-share list/reset/revoke is also extracted and validated locally. The
admin user search/detail/stats read persistence is also extracted and validated
locally, including a P1 fix for duplicate live voice profiles producing
duplicate search rows with a distinct count. Admin overview,
voice-enrollment, render-pipeline, risk, cost metrics, KPI aggregate persistence,
admin entitlement tier update persistence, and admin security observability
persistence, admin user mutation persistence, admin user session/voice-control
persistence, admin music diagnostics persistence, admin growth metrics
persistence, and admin webhook-health persistence are also extracted and
validated locally. Admin gift-ops read persistence is also extracted and
validated locally. Wave 1 of the parallel Root 1 execution moved sharing,
poem, and track route persistence behind repositories, removed all direct
persistence hits from `src/routes/sharing.js`, `src/routes/poems.js`, and
`src/routes/tracks.js`, and validated the focused share, poem, and track suites
locally. Wave 2 moved story, enrollment, admin leftover, artwork-job,
billing, and subscription-manager persistence behind repositories, removed all
direct persistence hits from those route/service/job files, and validated the
combined focused Wave 2 suite locally. The final runner wave moved voice-profile,
app-config, stale-recovery, step-history, DLQ, fairness, track/version,
risk/audit, and job-lifecycle persistence behind repositories/services. Root 1's
direct-persistence gate is now clean; the scan
`rg -n "db\.(prepare|query|exec)|\.prepare\(" src/routes src/services src/jobs src/workflows`
returns no matches.
**Method:** Each "root" is a coherent, bounded, sequenceable unit of work (per the `architectural-loop` skill). Execution should use `architectural-loop` as the controlling process and add the smallest relevant specialist reviews available in the executing environment (security, migration, provider, SwiftUI, API/docs). Extra architecture or cleanup tooling can be used as advisory input, but the plan must not depend on unavailable tools.

---

## How to read this

- **Root 0** is an explicit safety baseline before refactoring. It reconciles maps/docs, pins public behavior, and proves the validation harness before any code moves.
- **Roots** after Root 0 are ordered by `(blast-radius reduction × safety) ÷ effort`, with one override: the two CRITICAL correctness/security findings are surfaced separately and gated, not buried in modularity work.
- **Risk tier** — 🟢 low / 🟡 medium / 🔴 high (revenue-path or core-pipeline correctness).
- **Effort** — S (≤1 day) / M (2–4 days) / L (1–2 weeks).
- Every root has an explicit **boundary** (what it will NOT do) so it stays bounded.
- The revenue path (auth, billing, gifts, receipts) is marked ⚠ and requires owner review + production verification before execution. C1 has been executed as a standalone security fix in this working tree; production verification is still required before calling the revenue-path risk fully closed.

---

## Two non-negotiable global rules (apply to EVERY root)

These come from a second independent adversarial review (Codex) that pressure-tested an earlier draft. Both are correct and now bind every root:

### G1 — Golden contract tests are a PREREQUISITE, not a follow-up

Before any code moves in a root, write **characterization tests** that pin the _current_ observable behavior of the public contract that root touches — even if current behavior includes quirks. Refactor only after those tests are green; the same tests must stay green after. Mandatory characterization coverage before touching: **share / device-claim, billing, auth, render status, story→track create flow, iOS create handoff.** A root without its contract tests written and passing does not start.

### G2 — Cleanup happens PER-ROOT, then a final sweep

Each root removes the dead compatibility paths _it_ exposes or obsoletes — within the same root, before its adversarial pass closes (this is part of the `architectural-loop` cleanup requirement). A final repo-wide dead-code sweep (Root 8) still runs at the end to catch cross-root drift, but cleanup is no longer deferred wholesale to the end.

---

## Plan synthesis — what changed after the second review

| Codex contribution                                                                                            | Verdict                    | How it's incorporated                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Golden contract tests before moving code                                                                      | **Adopted**                | New global rule **G1**                                                                                                          |
| Cleanup per-root, not only at the end                                                                         | **Adopted**                | New global rule **G2**                                                                                                          |
| Split route extraction by blast radius (auth/billing/share → story/render → admin)                            | **Adopted**                | Sequencing of Roots 2, 6, 7 already reflects this; made explicit                                                                |
| server.js split via Fastify plugin encapsulation, earlier                                                     | **Partially adopted**      | Root 3 split into **3a** (mechanical bootstrap split, moved to Phase A) + **3b** (risky gift-subsystem extraction, stays later) |
| Scope spans iOS / admin / web-player, not just `src/**`                                                       | **Adopted, delayed**       | New **Root 11** (cross-surface create-flow + SwiftUI state) is part of the full whole-codebase goal, but must run after backend contracts stabilize |
| Primary-source guidance (AWS/GCP Well-Architected, Fastify plugins, SwiftUI data-flow, React reducer/context) | **Adopted as references**  | Listed under "Reference standards" below                                                                                        |
| Reconcile with existing `docs/architecture-and-flows.md`                                                      | **Adopted**                | Moved to Root 0 so the architecture map is current before refactoring begins                                                     |
| Empirical-validation doc for what code review can't prove                                                     | **Adopted**                | Added as the loop's closing deliverable (see closing section)                                                                    |

**Where my plan held over Codex's:** (1) the **repository layer (Root 1) remains the keystone** — Codex's "extract domain into services/repositories" silently assumes it but never makes it a foundational root; extracting services without it just relocates hundreds of inline SQL calls. Clarification after review: Root 1 is the first behavior-bearing architecture root; only Root 0, C1, and purely mechanical Root 3a may precede it. (2) The **two CRITICAL correctness findings (C1/C2) stay in their own gated Tier 0** rather than being folded into modularity work.

### Reference standards (apply during execution)

- AWS Well-Architected — operational excellence, reliability pillars
- Google Cloud Well-Architected Framework
- Fastify Plugins Guide — **encapsulation over a new framework** (drives Root 3a)
- Apple SwiftUI Data Flow + `.sheet(item:)`/`.fullScreenCover(item:)` state boundaries (Root 11, delayed until backend contracts stabilize)
- React Reducer + Context scaling patterns (admin UI, Root 11)

---

## TIER 0 — Correctness/security findings (NOT modularity; decide first)

These were found by the formal review while assessing modularity. They are latent defects, not cleanups. They are listed first because they change risk priorities. They still require owner approval and production verification; C1 is explicitly recommended as a standalone pre-loop patch, while C2 is document-first in Root 0.

### C1 ⚠ — Auth-guard revocation gap (CRITICAL, revenue path)

**Execution status:** Implemented and validated locally. `requireUserId` now
requires a JWT session id, checks `user_sessions.revoked_at IS NULL`, rejects
soft-deleted users, and keeps header fallback restricted to development/test.
Contract tests cover revoked session tokens, soft-deleted users, and non-dev
fallback rejection. Production verification remains required.

Before the C1 patch, `requireUserId` front-ran tracks/billing/render/sharing but
checked **only the JWT signature** and never consulted `user_sessions.revoked_at`.
`requireAuth` did perform that session check. A revoked session (logout,
security response, device-unbind) could keep working on the money path until the
JWT expired.

- **Implemented fix:** `requireUserId` now requires a JWT `sid`, checks
  `user_sessions.revoked_at IS NULL`, rejects soft-deleted users, and limits
  header fallback to development/test.
- **Remaining gate:** revenue-path. Verify in production that revoking a session
  immediately 401s `POST /tracks`.

### C2 — Error-envelope ↔ taxonomy mismatch (CRITICAL for API contract)

Wire errors are a flat `{error, message, ...adhoc}` bag documented in
[`docs/api/error-envelope.md`](../api/error-envelope.md); the
`E1xx/R2xx/B3xx/S5xx` taxonomy in CLAUDE.md is **not** what ships. iOS
special-cases per endpoint (see the 422-vs-409 comment at tracks.js:1143).

- **Smallest fix (non-breaking):** document the _actual_ current envelope as the official contract during Root 0, freeze ad-hoc top-level keys, and reconcile CLAUDE.md. A nested `{error:{code,message,details}}` migration is a separate, client-coordinated effort behind a version header.
- **Gate:** client-coupled. Document-first; no wire change without iOS coordination.

---

## TIER 1 — Highest-leverage structural roots (recommended order)

### Root 0 — Architecture map + executable safety baseline 🟢 effort S–M

**Closes:** planning drift; prevents "refactor first, discover breakage later."
**Scope:** Reconcile `docs/architecture/architecture-map-2026-06.md` with `docs/architecture-and-flows.md`, mark which map is current for backend vs full-product architecture, and create the validation matrix for backend, iOS, admin, and web-player surfaces. Add or confirm full-route smoke coverage and characterization tests for the contracts named in G1. Document the actual error envelope for C2. Record the currently dirty worktree so implementation roots do not overwrite unrelated user/generated files.
**Why first:** Every later root depends on knowing what behavior must stay stable. Root 0 is not optional; without it, dead-code deletion, repository extraction, and route splits can silently change public contracts.
**Boundary:** No source refactor. No deletion except correcting docs. Do not claim any validation command is green unless it has been run in this execution context.

### Root 1 — Repository layer (the keystone) 🟡 effort L

**Closes:** D1. Unblocks testability for everything else.
**Scope:** Extract the remaining inline SQL sites into per-aggregate repositories (`TrackRepo`, `JobRepo`, `GiftRepo`, `ShareRepo`, `UserRepo`, …) that take the already-injected `db`. Generalize the existing `story-repository.js` pattern.
**Execution status:** Complete locally. Bounded repository aggregates are complete
locally, with the adjacent voice-provider worker/runner/enrollment cleanup
folded into the voice-provider boundary:
`receiver-session-service.js` now depends on
`database/receiver-session-repository.js` for receiver-session rows, events,
handoffs, and opaque receiver-claim tokens; Blog CMS persistence now lives in
`database/blog-repository.js`, with `blog-service.js`, legal sitemap reads, and
admin review/repair flows depending on that repository instead of inline SQL;
and cold-email campaign/recipient persistence now lives in
`database/cold-email-repository.js`, including the admin all-campaign/template
read paths and whitelisted optimistic-concurrency admin PATCH mutation, with
`cold-email-service.js` retaining scheduling, template, Resend, repository
delegation, and orchestration logic while `routes/admin.js` retains
authorization, field validation, stale-update response shape, and audit
metadata assembly; event-table persistence
now lives in `database/events-repository.js`, with `events-service.js`
retaining event-id generation, bounds normalization, and public return-shape
behavior. The admin analytics follow-up also moved dashboard event counts,
daily buckets, cohort conversion reads, selected user-event reads, and the
`analytics.user.read` audit insert into the same event-table repository while
`AdminAnalyticsService` retains cache ownership, days/limit clamping, funnel hop
policy, audit metadata assembly, and route-facing response shapes while
`AdminService` is only the compatibility facade; share-followup
persistence now lives in
`database/share-followup-repository.js`, with `share-service.js` keeping
schedule construction and `share-followups-daily.js` keeping email
orchestration; identity/contact persistence now lives in
`database/identity-repository.js`, with `identity-service.js` retaining
normalization, relay detection, conflict-to-`IdentityError` mapping, ID
generation, and profile-completeness policy. Auth-route post-identity
compensation cleanup for email, social, and phone signup also now delegates to
`identity-repository.js` instead of repeating route-local deletes. Phone
registration token create/consume/cleanup/recent-proof persistence now lives in
`database/phone-registration-token-repository.js`, while `routes/auth.js`
retains HMAC/hash construction, token generation, and public response-shape
ownership. Auth email/phone/social duplicate-account lookup reads also now use
`identity-repository.js`, while the route helper keeps masking and response
policy. Auth access-token live-session validation, refresh deleted-user cleanup,
logout/password-reset session revocation, and route-level session ownership
checks now use `database/auth-session-repository.js`. Auth route rate-limit DB
writes, stale-row cleanup, and the in-memory fast-path cache now use
`database/auth-rate-limit-repository.js`; `routes/auth.js` retains endpoint
limit policy, retry/error response shape, and fail-closed selection for
signup/login. Auth current-user profile/contact reads, display-name and
profile-completion skip writes, pending verification-email lookup, user-email
fallback reads, and phone-link idempotency checks now use
`database/auth-profile-repository.js`; `routes/auth.js` retains HTTP validation,
response shaping, verification-email dispatch, and identity-service calls. Auth
provider-linking maintenance now uses
`database/auth-provider-linking-repository.js` for phone-provider existence
guards, deleted-user provider cleanup, provider revocation, and Apple
refresh-token provider-data updates while `routes/auth.js` retains provider
token verification/exchange, JSON merge policy, contact creation, public
responses, and auth-event emission. The
password credential slice now moves signup credential insert, login password
hash lookup, and reset-password credential update into
`database/auth-credential-repository.js`; `routes/auth.js` keeps bcrypt,
account-lockout policy, reset-token verification, token/session revocation,
email dispatch, auth-event logging, and response-shape ownership. The
username availability follow-up adds active-username lookup to
`database/auth-profile-repository.js`, preserving route-owned format
validation, IP rate limiting, random suggestion generation, and response shape.
The receiver-attribution follow-up moves the post-signup same-IP fallback into
`database/receiver-session-repository.js`, preserving the 72-hour window,
first/last IP matching, newest-session ordering, and first-writer-wins
`matched_user_id IS NULL` guard while making the select/update atomic. The auth
security follow-up moves auth-event inserts and login lockout persistence into
`database/auth-security-repository.js`, while `auth-service.js` keeps event id
generation, metadata serialization, lockout thresholds, and escalation policy.
The one-time token follow-up moves password-reset and email-verification token
row persistence plus the atomic consume-and-mark-used transaction into
`database/auth-one-time-token-repository.js`, while `auth-service.js` keeps raw
token generation, hashing, expiry calculation, and public auth API ownership.
The refresh-token follow-up moves token-family creation, refresh-token row
creation/revocation, session-bound verification reads, replacement-token reads,
family compromise/revoke writes, grace-unrevoke audit inserts, and transaction
scoping into `database/auth-refresh-token-repository.js`, while
`auth-service.js` keeps raw token generation, hashing, expiry calculation,
reuse/grace policy, logging, and route-facing error semantics.
The GDPR data-export follow-up moves active-user lookup and the allowlisted
per-section export queries into `database/gdpr-data-export-repository.js`,
while `auth-service.js` keeps redaction policy, export envelope shape, and
per-section fallback preservation.
The admin-auth follow-up moves admin user lookup/mutation, admin session
insert/validate/delete/cleanup, and admin password-reset token persistence into
`database/admin-auth-repository.js`, while `admin-auth-service.js` keeps bcrypt,
raw token generation/hashing, default-seeded-admin production policy, lockout
decisions, and public return shapes.
The
identity slice also fixes the
previous transaction-shape defect by running multi-write identity mutations
through transaction-scoped repository instances instead of ignoring the
transaction callback's scoped query function; attribution persistence now lives
in `database/attribution-repository.js`, with `attribution-service.js` retaining
source precedence, status resolution, and backfill-window policy while
`routes/analytics.js` retains Apple Ads HTTP fetch, developer-test detection,
audit emission, and response-envelope ownership. The attribution slice preserves
the guarded `download_events` claim (`WHERE matched_user_id IS NULL`),
existing-first Apple Ads `COALESCE` backfill, download-over-Apple-Ads
replacement semantics, Apple Ads token dedupe/failure/result persistence, and
the deliberate difference between single-user developer-test filtering and bulk
latest Apple Ads status filtering. The admin Apple Ads keyword-map follow-up now
moves keyword-map list/upsert SQL into `database/attribution-repository.js`;
`AdminGrowthService` now keeps pagination bounds, payload validation, row
normalization, bulk-sync audit logging, and the admin route response contract
while `AdminService` is only the compatibility facade. Characterization
pins insert/update behavior, total counts, pagination, deterministic ordering,
and the existing admin attribution route contract in
`test/attribution-repository.test.js` and `test/admin-attribution.test.js`.
The admin growth-attribution dashboard follow-up then moved share/download
breakdown reads, Apple Ads campaign aggregation, and attribution total counters
into `database/attribution-repository.js`; `AdminGrowthService` now keeps the
lookback window, row merge/sort policy, rate formatting, and route response
shape while `AdminService` is only the compatibility facade.
Characterization pins share claim counts, download registration counts,
developer-test Apple Ads filtering, keyword-map joins, totals, and dynamic-field
rejection. Residual: keyword-map bulk sync is still not transactionally atomic.
Feature-flag persistence now lives in
`database/feature-flags-repository.js`, with `feature-flags.js` retaining
default resolution, per-flag TTL cache ownership, JSON parse tolerance,
`throwOnError` envelopes, and cache-after-write policy. The feature-flag slice
preserves the batch fallback path for DB adapters that do not expose
`statement.all()`; GDPR audit inserts now live in
`database/gdpr-audit-repository.js`, with `gdpr-audit-service.js` retaining
event-id generation, IP hashing, metadata construction, and compliance event
contracts. The account-deletion route now builds the GDPR audit payload before
deletion and passes it into `auth-service.deleteUserAccount()`, which inserts
the retained GDPR audit row inside the same transaction as the cascade delete.
This closes the previously identified deletion-first/audit-second compliance
gap; voice-provider profile/job persistence now lives in
`database/voice-provider-profile-repository.js`, with
`voice-provider-profile-service.js` retaining validation, provider
normalization, lifecycle transition errors, metadata/error sanitization,
activation retirement policy, and retry/backoff decisions. The voice-provider
boundary now also owns the adjacent Suno worker execution-context read,
voice-profile status fallback read, runner due-job selection and heartbeat
writes, enrollment deletion audit prefetch, provider-profile retry resets, and
account-deletion voice-provider scrub/delete operations. The provider
active-profile follow-up moves
personalized voice conversion's `voice_profiles` active-row check out of
`providers/voice.js` and into the same repository, while preserving the
conversion precondition and Seed-VC behavior. Account-deletion persistence now lives in
`database/account-deletion-repository.js`, with `auth-service.deleteUserAccount()`
retaining orchestration, provider cleanup calls, and GDPR audit composition.
The repository owns the transaction-scoped delete/scrub cascade for story,
track/share, poem/share, gift, billing, telemetry/attribution/device/download,
auth token/session/provider/credential/contact, rate-limit, and final
soft-delete rows. The slice intentionally added a migration so
`granted_identities` is keyed by `(identity_hash, grant_kind)`, allowing signup
and trial tombstones to coexist; this is a correctness/schema exception, not a
generic repository semantics change.
Characterization and contract
validation passed for:
`test/receiver-session-service.test.js`,
`test/receiver-session.test.js`, `test/share-flow.test.js`,
`test/sharing-security.test.js`, `test/blog-service.test.js`,
`test/blog-repository.test.js`, `test/blog-cms-routes.test.js`,
`test/marketing-seo-pages.test.js`, `test/cold-email-repository.test.js`,
`test/services/cold-email-service.test.js`, and
`test/jobs/cold-email-daily.test.js`, plus `test/events-repository.test.js`,
`test/analytics-event.test.js`, `test/admin-analytics.test.js`,
`test/share-followup-repository.test.js`, `test/share-followup-service.test.js`,
`test/share-followups-job.test.js`, `test/share-service.test.js`,
`test/identity-repository.test.js`, `test/auth-identity-model.test.js`,
`test/auth-api.test.js`, `test/subscription-tombstone.test.js`,
`test/attribution-repository.test.js`, `test/apple-ads-attribution.test.js`,
`test/download-attribution.test.js`, `test/admin-attribution.test.js`,
`test/registration-country-attribution.test.js`,
`test/receiver-attribution.test.js`, `test/receiver-session.test.js`,
`test/share-player-attribution.test.js`, `test/analytics-event.test.js`,
`test/admin-analytics.test.js`, `test/agent-readiness.test.js`,
`test/feature-flags-repository.test.js`, plus focused consumer smoke coverage in
`test/stt-config.test.js`, `test/workflows/voice-conversion-routing.test.js`,
`test/critical-fixes.test.js`, and `test/share-embed.test.js`. The full
`npm test` suite also passed after the feature-flag slice (2,493 pass / 23
skipped / 0 fail). Auth profile/contact focused validation passed in
`test/auth-api.test.js`, `test/auth-service.test.js`, and
`test/critical-fixes.test.js`; syntax checks and `git diff --check` passed for
`routes/auth.js` and `database/auth-profile-repository.js`. The full
`npm test` suite also passed after the auth profile/contact slice (2,867 pass /
23 skipped / 0 fail; 451,530.863 ms). Auth provider-linking focused validation
passed in `test/auth-provider-linking-repository.test.js`,
`test/auth-api.test.js`, `test/auth-service.test.js`, and
`test/critical-fixes.test.js`; syntax checks, `npm run lint`, and targeted
route-SQL greps passed for `routes/auth.js` and
`database/auth-provider-linking-repository.js`. The full `npm test` suite also
passed after the auth provider-linking slice (2,871 pass / 23 skipped / 0 fail;
449,807.0095 ms). Auth credential focused validation passed in
`test/auth-credential-repository.test.js`, `test/auth-api.test.js`,
`test/auth-service.test.js`, `test/critical-fixes.test.js`, and
`test/auth-login-enumeration.test.js`; syntax checks and `npm run lint` passed
for `routes/auth.js` and `database/auth-credential-repository.js`. Auth username
availability validation passed in `test/auth-profile-repository.test.js` and
`test/auth-api.test.js`; syntax checks, `npm run lint`, targeted route-SQL
greps, and `git diff --check` passed for `routes/auth.js` and
`database/auth-profile-repository.js`. Auth receiver-attribution validation
passed in `test/receiver-session-repository.test.js` and
`test/receiver-attribution.test.js`; syntax checks, `npm run lint`, targeted
route-SQL greps, and `git diff --check` passed for `routes/auth.js` and
`database/receiver-session-repository.js`. The full `npm test` suite also
passed after the batched auth route cleanup (2,876 pass / 23 skipped / 0 fail;
449,512.227166 ms). Auth security focused validation passed in
`test/auth-security-repository.test.js`, `test/security-units-6-7-8.test.js`,
`test/auth-login-enumeration.test.js`, `test/auth-service.test.js`, and
`test/auth-api.test.js`; syntax checks, `npm run lint`, targeted auth-service
SQL greps, and `git diff --check` passed for `auth-service.js` and
`database/auth-security-repository.js`. Auth one-time token focused validation
passed in `test/auth-one-time-token-repository.test.js`,
`test/auth-service.test.js`, `test/auth-api.test.js`, and
`test/auth-identity-model.test.js`; syntax checks, `npm run lint`, targeted
auth-service SQL greps, and `git diff --check` passed for `auth-service.js` and
`database/auth-one-time-token-repository.js`. The full `npm test` suite also
passed after the batched auth-service security and one-time-token slices (2,884
pass / 23 skipped / 0 fail; 449,196.389667 ms). Auth refresh-token focused
validation passed in `test/auth-refresh-token-repository.test.js`,
`test/auth-service.test.js`, `test/auth-api.test.js`,
`test/auth-identity-model.test.js`, and `test/critical-fixes.test.js`; syntax
checks, `npm run lint`, targeted auth-service SQL greps, and `git diff --check`
passed for `auth-service.js` and
`database/auth-refresh-token-repository.js`. The full `npm test` suite also
passed after the auth refresh-token slice (2,889 pass / 23 skipped / 0 fail;
448,532.530625 ms). GDPR data-export focused validation passed in
`test/gdpr-data-export-repository.test.js`, `test/auth-service.test.js`, and
`test/auth-api.test.js`; syntax checks, `npm run lint`, targeted auth-service
SQL greps, and `git diff --check` passed for `auth-service.js` and
`database/gdpr-data-export-repository.js`.
Admin-auth focused validation passed in `test/admin-auth-repository.test.js`,
`test/admin-login-hardening.test.js`, and
`test/admin-auth-default-seed.test.js`; syntax checks, `npm run lint`,
targeted admin-auth-service SQL greps, and `git diff --check` passed for
`admin-auth-service.js` and `database/admin-auth-repository.js`.
Apple webhook focused validation passed in
`test/apple-webhook-repository.test.js` and
`test/apple-webhook-handler.test.js`; syntax checks, `npm run lint`, targeted
apple-webhook-handler SQL greps, and `git diff --check` passed for
`apple-webhook-handler.js` and `database/apple-webhook-repository.js`.
GDPR audit focused
validation passed in
`test/gdpr-audit-repository.test.js`, the GDPR self-service route cases in
`test/auth-api.test.js`, and the account-deletion rollback case in
`test/auth-service.test.js`. The full `npm test` suite also passed after the
GDPR audit slice (2,502 pass / 23 skipped / 0 fail). Blog CMS
adversarial passes terminated with zero P0/P1 findings; the remaining P2-level duplicate-create race is
deferred until the schema/advisory-lock fingerprint is handled with a migration
gate. Voice-provider characterization and repository validation passed in
`test/voice-provider-profile-service.test.js` and
`test/voice-provider-profile-repository.test.js`; the wider focused path also
passed across `test/voice-enrollment.test.js`, `test/auth-api.test.js`,
`test/auth-service.test.js`, `test/suno-voice-persona-service.test.js`, and
`test/utils/provider-sanitize.test.js` (171 pass / 0 fail). The full
`npm test` suite also passed after the voice-provider profile slice (2,506 pass
/ 23 skipped / 0 fail). Adjacent voice-provider cleanup validation passed across
`test/voice-provider-profile-repository.test.js`,
`test/voice-provider-profile-service.test.js`,
`test/suno-voice-persona-service.test.js`, `test/auth-service.test.js`, and
`test/critical-fixes.test.js` (101 pass / 0 fail), plus `npm run lint`; local
adversarial review and the parallel reviewer agent both found zero P0/P1
issues. The full `npm test` suite also passed after the adjacent cleanup
(2,513 pass / 23 skipped / 0 fail). The Suno persona status-fallback follow-up
passed `test/voice-provider-profile-repository.test.js` and
`test/suno-voice-persona-service.test.js`; syntax checks, `npm run lint`,
targeted service SQL greps, and `git diff --check` passed for the touched
voice-provider files. Account-deletion characterization and
repository validation passed in `test/account-deletion-repository.test.js`,
`test/subscription-tombstone.test.js`, `test/auth-service.test.js`,
`test/auth-api.test.js`, `test/gdpr-audit-repository.test.js`,
`test/voice-provider-profile-service.test.js`, and
`test/voice-provider-profile-repository.test.js`; `node --check` passed for the
changed service/repository/test files, PostgreSQL migration/server-integration
coverage passed in `test/database/postgres-core-schema-repair.test.js` and
`test/database/server-integration.test.js`, `npm run lint` passed, and the full
`npm test` suite passed after this slice (2,516 pass / 23 skipped / 0 fail).
The durable-storage cleanup follow-up now deletes configured storage-provider
artifacts under `tracks/{user_id}/`, `poems/{user_id}/`,
`enrollment/raw/{user_id}/`, `enrollment/clean/{user_id}/`, and
`voice_profiles/{user_id}/` as part of the self-service account deletion
orchestration. Focused validation passed in
`test/account-deletion-storage-service.test.js`, `test/auth-service.test.js`,
`test/auth-api.test.js`, the storage adapter tests, and the focused Root 1
account-deletion/repository bundle; `npm run lint` and `git diff --check` also
passed after this follow-up. The full `npm test` suite also passed after this
follow-up (2,524 pass / 23 skipped / 0 fail). The parallel review pass found no
post-fix P0/P1 issues; earlier adversarial review findings in this slice forced
fixes for poem-share deletion, broader user soft-delete scrubbing,
gift/billing residual rows, telemetry attribution PII, the signup/trial
tombstone primary-key bug, missing durable storage deletion, S3 listing
pagination, and fail-closed truncated-list handling.
The download-event ingest follow-up now moves `/download` install-intent
inserts into `database/attribution-repository.js` and the receiver-session
download-attribution guard into `database/receiver-session-repository.js`.
`routes/legal.js` retains HTTP parsing, bot skipping, deep-link parsing, and
redirect/bridge behavior, but no longer owns `download_events` or
`receiver_sessions.download_attributed_at` SQL. The final shape records
receiver-session download attribution and the `download_events` row in one
transactional repository operation so a failed event insert cannot burn the
one-shot receiver attribution marker. Characterization coverage was broadened
to pin the full install-intent envelope (`utm_term`, referrer, user-agent,
receiver session id), one-shot/mismatched/resolved/expired handoff attribution
guards, rollback on insert failure after a valid handoff, and bot requests with
handoff parameters not mutating receiver sessions. Focused validation passed in
`test/attribution-repository.test.js`,
`test/receiver-session-repository.test.js`,
`test/download-attribution.test.js`, and `test/receiver-session.test.js`; `npm
run lint` and `git diff --check` also passed.
The Apple Ads attribution route follow-up now moves token lookup, failed
capture persistence, and resolved/not_found/test result upserts into
`database/attribution-repository.js`. `routes/analytics.js` keeps request
validation, token hashing, Apple Ads network timeout/fetch behavior,
developer-test classification, audit/event emission, and public response shape,
but no longer owns raw `apple_ads_attribution` SQL. Focused validation passed
in `test/attribution-repository.test.js`, `test/apple-ads-attribution.test.js`,
and `test/analytics-event.test.js`; `node --check` passed for the touched route
and repository files.
The user email-preferences follow-up now moves `/unsubscribe`
`users.unsubscribed_at` persistence into
`database/user-email-preferences-repository.js`. `routes/legal.js` keeps token
verification, GET/POST response semantics, and public HTML rendering, but no
longer owns the opt-out SQL. Characterization coverage now pins valid GET
confirmation + persistence, RFC 8058 valid POST empty-body behavior, valid POST
for a newly unsubscribed user, invalid POST no-mutation behavior, repository
`COALESCE` preservation of the first unsubscribe timestamp, and missing-user
zero-change behavior. Focused validation passed in
`test/unsubscribe-token.test.js`,
`test/user-email-preferences-repository.test.js`,
`test/unsubscribe-routes.test.js`, and the legal-route registration subset of
`test/agent-readiness.test.js`.
The enrollment cleanup follow-up now moves expired-session selection and row
deletion out of `src/jobs/cleanup.js` and into
`database/enrollment-cleanup-repository.js`. `cleanup.js` keeps ownership of
retention cutoff calculation, prompt-id parsing, storage-provider deletion,
local directory fallback, and cleanup error envelopes. Characterization now pins
`started_at` cutoff selection, delete-by-id behavior, prompt-id remote deletes,
`chunk_count` fallback deletes for malformed prompt metadata, local raw/clean
directory removal, and query-failure error reporting. Focused validation passed
in `test/enrollment-cleanup-repository.test.js`,
`test/enrollment-cleanup-job.test.js`, and `test/enrollment-qc.test.js`; `npm
run lint` and `git diff --check` also passed.
The public/admin app-config follow-up now moves structured `app_config`
reads/writes, STT provider-status reads, `security_config` read/upsert
persistence, and the active gift-bundle/onboarding-sample reads behind
`database/app-config-repository.js`. `admin-service.js` still owns validation,
default normalization, audit logging, update-policy projection, feature-flag
composition, and the mobile-safe `/app/config` response shape; the larger
service eviction into a client-config service remains part of Root 6. This
slice also closes the public-read issue where unauthenticated `/app/config`
could trigger a live App Store Connect lookup; public app config now uses cached
App Store version fields and does not return `last_app_store_sync_error`.
Characterization now pins structured config upserts, STT provider-status reads,
security-config upsert/read behavior, active-only/sort-order gift bundle
projection, client-safe active onboarding sample fields, and route-level public
payload safety. Focused validation passed in
`test/app-config-repository.test.js`, `test/app-config-route.test.js`,
`test/stt-config.test.js`, and `test/music-provider-config.test.js`; `npm run
lint` and `git diff --check` also passed.
The plan-config follow-up now moves subscription plan, plan-product mapping, and
trial-config SQL into `database/plan-config-repository.js`. `plan-config.js`
keeps cache ownership, public plan-shape mapping, ID generation, allowance
lookup policy, and fail-closed trial behavior. Characterization pins
active/inactive plan listing, whitelisted plan updates, feature serialization,
trial insert/update, product mapping update-vs-insert behavior, and plan
creation in `test/plan-config-repository.test.js`; the existing
`test/plan-config.test.js` continues to cover service cache and integration
behavior.
The subscription-sync follow-up now moves renewal-candidate and expired
grace-period selectors into `database/subscription-sync-repository.js`.
`subscription-sync.js` keeps cursor loop ownership, external validator calls,
renewal/expiration decisions, logging, and result counters. Characterization
pins cursor pagination, auto-renew/status/expiry eligibility filters,
entitlement renewal cutoffs, and grace-period expiry selection in
`test/subscription-sync-repository.test.js`; the existing
`test/subscription-sync-job.test.js` continues to cover Apple/Google sync
branch behavior.
The artwork-job follow-up now moves track/version/lyrics/entitlement reads,
artwork writes, per-version artwork-var writes, artwork-ready updates, durable
jobs-row inserts, job status transitions, retry scheduling, and orphan recovery
scans behind `database/artwork-job-repository.js`. `src/jobs/artwork-job.js`
retains orchestration, heartbeat timers, retry/backoff policy, provider calls,
artwork-var extraction/fallback behavior, and barrier notification. The
hardening follow-up now guards artwork job status writes so terminal
`completed`/`failed` rows cannot regress to `running` or `queued`, aborts a
stale recovery before track/provider work when the initial claim updates zero
rows, and assigns `queue_name='q.default'` to new artwork job rows for queue
metrics consistency. Focused validation passed in
`test/artwork-job-repository.test.js` and `test/jobs/artwork-job.test.js`; `npm
run lint` and `git diff --check` also passed.
The artwork-barrier follow-up now moves `track_versions.artwork_ready` reads and
PG `pg_notify` calls into `database/artwork-barrier-repository.js`.
`artwork-barrier.js` keeps LISTEN lifecycle, polling/backoff, timeout,
fallback, and logging behavior. Characterization pins ready-value normalization,
missing-row behavior, notify payloads, PG wakeup behavior, deadline rechecks,
and query-failure release behavior in `test/artwork-barrier-repository.test.js`
and `test/workflows/artwork-barrier.test.js`.
The enrollment-session follow-up now moves route lifecycle persistence
(session create/read, expiry marking, finalization claiming, quality-metrics
updates, chunk-quality persistence, completed/failed status writes, late
consent-scope grant, and access-token rotation) plus provider-token context
lookup and revocation behind `database/enrollment-session-repository.js`.
`routes/enrollment.js` retains HTTP, storage, QC, provider, and voice-profile
orchestration; `enrollment-session-service.js` retains input guards,
fresh-token generation, and structured revocation/rotation logging. Focused
validation passed in
`test/enrollment-session-repository.test.js` and
`test/services/enrollment-session-service.test.js`, plus the configured
`test/voice-enrollment.test.js`; `npm run lint` also passed.
The track-version allocation follow-up now moves `POST /tracks/:id/versions`
track lookup, duplicate params-hash lookup, and atomic `tracks.latest_version`
increment + `track_versions` insert into
`database/track-version-repository.js`. `routes/tracks.js` keeps HTTP auth,
request parsing, render-type defaults, params-hash calculation, cost-estimate
construction, and public response shape. This also removes the old
`server.js` `incrementTrackVersion()` helper whose comment required callers to
wrap it in a transaction while the route was not using the PostgreSQL
transaction-scoped query callback. Characterization now pins successful version
allocation, duplicate lookup, rollback of `tracks.latest_version` on insert
failure, the historical concurrent-version race, and render endpoint behavior.
Focused validation passed in `test/track-version-repository.test.js`,
`test/render-endpoints.test.js`, and `test/critical-fixes.test.js`; `npm run
lint` and `git diff --check` also passed.
The admin-marketing follow-up now moves `marketing_contacts`,
`marketing_campaigns`, `marketing_engagements`, and `push_campaigns`
persistence into `database/admin-marketing-repository.js`. `routes/admin.js`
still owns admin-session checks, CSV parsing, validation, OneSignal payload
construction, and audit emission. The slice replaces the manual
`BEGIN`/`COMMIT` batch mutations for contact upload and GMass result import
with adapter transactions, and keeps engagement upsert behavior portable by
using SQLite `MAX` vs PostgreSQL `GREATEST` behind the repository. Focused
validation passed in `test/admin-marketing-repository.test.js`,
`test/admin-marketing-routes.test.js`, `test/cold-email-repository.test.js`,
`test/services/cold-email-service.test.js`, and
`test/jobs/cold-email-daily.test.js` (54 pass / 0 fail). Full follow-up
validation also passed with `npm test`: 2,593 tests, 2,570 pass, 0 fail,
23 skipped, duration 397,615.944 ms.
The cold-email admin read follow-up now moves the route-level
`cold_email_campaigns` reads for `/marketing/email-templates` custom template
discovery and `/marketing/cold-email` all-campaign listing into
`database/cold-email-repository.js`, exposed through
`services/cold-email-service.js`. The route still owns filesystem template
loading and the higher-risk PATCH/trigger/audit paths remained intentionally out
of that read-only slice. Focused validation passed in
`test/cold-email-repository.test.js` and `test/admin-marketing-routes.test.js`
(16 pass / 0 fail).
The cold-email admin mutation follow-up now moves the route-level
`cold_email_campaigns` PATCH `UPDATE` into
`database/cold-email-repository.js` behind
`services/cold-email-service.updateCampaignFields()`. The route still owns
superadmin authorization, field validation, cross-field fire-window checks,
stale-update response shape, and audit metadata assembly. Characterization pins
whitelisted field updates, unsupported-field rejection before SQL construction,
optimistic concurrency, nullable `earliest_run_date_utc`, audit before/after
metadata, and stale PATCH no-mutation behavior. Focused validation passed in
`test/cold-email-repository.test.js`,
`test/services/cold-email-service.test.js`, and
`test/admin-marketing-routes.test.js` (45 pass / 0 fail).
The admin billing metrics follow-up now moves admin billing dashboard and
user-billing snapshot read
persistence into `database/admin-billing-repository.js`: product catalog
fallback rows, verified receipt sales rows, current-subscriber count/list,
revenue subscription aggregates, churn denominator/cancellation counts, and
subscription-health counts, plus latest-subscription and recent-receipt rows
for `GET /admin/billing/users/:targetUserId`. `AdminService` still owns
period/bounds policy, receipt-money normalization, sale classification,
mixed-currency scalar behavior, pagination-after-filtering, and route-facing
response shape. `routes/billing.js` still owns authorization, subscription
manager calls for entitlements/active-subscription normalization, and public
receipt mutation paths remain intentionally out of scope. Characterization pins paid receipt summary,
trial/zero exclusion, unknown-amount sales, gift tokens, active-subscriber
count vs preview cap, product catalog rows, strict `purchase_date > since`
filtering, user/contact/subscription/gift-wallet joins, current-subscriber
status/date rules, latest-subscription ordering, recent-receipt column shape,
the billing snapshot route, and service delegation without direct DB access.
Focused validation passed in `test/admin-billing-repository.test.js`,
`test/admin-billing-sales.test.js`, and `test/billing-api.test.js` (54 pass /
0 fail).
The admin demo-share follow-up now moves demo share create/convert/list/revoke
persistence into `database/admin-demo-share-repository.js`; `routes/admin.js`
retains auth, resource validation, `DEMO_EXPIRES_AT`, URL construction, UUID/time
selection, audit calls, and response shapes. Characterization pins song demo
creation/listing/audit, poem demo creation/revocation/audit, invalid/missing
resource errors, existing demo-token conversion/reset semantics, and the
multiple-token hardening from migration 080: gift/manual share tokens are not
selected as reusable demo rows. The route is also hardened so viewer admins
cannot create or revoke demo shares. Focused validation passed in
`test/admin-demo-share-repository.test.js` and
`test/admin-demo-share-routes.test.js` (8 pass / 0 fail).
The admin track-transfer follow-up now moves track lookup, target-user lookup,
active render-job detection, transactional ownership/library/share-token
mutation, transfer audit insertion, and post-transfer verification reads into
`database/admin-track-transfer-repository.js`. `routes/admin.js` retains
superadmin authorization, HTTP response envelopes, timestamp/UUID selection,
and public response shape. The adversarial pass forced fixes for soft-deleted
target-user acceptance, missing `running` active-job coverage, transaction-time
active-job gating, audit rows attributed to the recipient instead of the admin,
stale received-library access for earlier recipients, incomplete share-token
binding reset, and success responses that were not gated on persisted
post-state. Focused validation passed in
`test/admin-track-transfer-repository.test.js` and
`test/admin-track-transfer-routes.test.js` (8 pass / 0 fail). Full validation
also passed after this slice: `npm run lint`, `git diff --check`, and
`npm test` (2,646 pass / 23 skipped / 0 fail).
The admin share-management follow-up now moves song-share list/rebind and
poem-share list/reset/revoke persistence into
`database/admin-share-management-repository.js`; `AdminService` retains
pagination bounds, mutation result interpretation, audit emission, and
route-facing response envelopes. Characterization pins song-share response
fields including `stream_key`, exact filters/order, rebind's intentionally
narrow `bound_device_id` update, viewer-role mutation blocking, missing-resource
error envelopes, poem-share response fields including `claim_pin`, reset/revoke
audit behavior, and already-revoked no-audit behavior. Focused validation
passed in `test/admin-share-management-repository.test.js` and
`test/admin-share-routes.test.js` (10 pass / 0 fail), plus `npm run lint` and
`git diff --check`. The adversarial reviewer found zero P0/P1 findings. P2
deferred: concurrent poem revoke can still double-audit under a race because
the pre-existing behavior reads status before an unconditional update; fixing
that requires changing mutation semantics outside this movement-only slice.
The admin user-read follow-up now moves admin user search, user-detail, and
stats read persistence into `database/admin-user-read-repository.js`;
`AdminUserReadService` now retains pagination bounds, attribution
attachment/merge, route-facing response shapes, and stats conversion-rate
formatting, while `AdminService` is only the compatibility facade and still
owns unrelated user mutation methods. Characterization
pins search filters, free-tier-without-entitlement semantics, selected adoption
metrics, detail fan-out rows, latest subscription/download/Apple Ads reads, and
the missing-user 404 envelope. The stats follow-up pins admin auth, bare JSON
response shape, `conversionRate` as a one-decimal string, empty-database
normalization, stored-tier-only behavior (`pro`/`plus` paid, `trial`, `free` or
missing entitlement free), and explicitly preserves the current behavior that
`admin_upgrade_tier` and legacy `premium` do not affect this endpoint. The first
adversarial reviewer found one P1: multiple non-deleted voice profiles could
duplicate one user in search while `total` remained distinct, and detail
voice-profile selection was nondeterministic. That is fixed by selecting the
latest non-deleted profile with an ordered subquery and matching detail
ordering. The stats adversarial reviewer found zero P0/P1 findings. Focused
validation passed in
`test/admin-user-read-repository.test.js`, `test/admin-user-read-routes.test.js`,
and `test/admin-attribution.test.js` (28 pass / 0 fail), plus `npm run lint`
and `git diff --check`.
The admin overview-metrics follow-up now moves the `/metrics/overview` read
persistence into `database/admin-metrics-repository.js`; `AdminService` retains
the rolling 24-hour and 7-day window calculation. Characterization pins admin
auth, the six-field response shape, all-users counting, strict `created_at >`
window boundaries, entitlement-only tier distribution (users without
entitlements are excluded), job status grouping, and preview-only render
counting regardless of version status. The adversarial reviewer found one P1:
grouped `COUNT(*)` rows were not normalized to numbers, which could leak
Postgres string counts into the admin UI and break numeric addition/reduction.
That is fixed by normalizing grouped `tierDist` and `jobStats` counts. Focused
validation passed in `test/admin-metrics-repository.test.js`,
`test/admin-overview-metrics-routes.test.js`, and
`test/admin-job-ops-repository.test.js` (15 pass / 0 fail), plus
`npm run lint` and `git diff --check`.
The admin control-plane follow-up now moves `provider_status` and
`queue_status` list/update persistence into
`database/admin-control-repository.js`; `AdminService` retains admin audit
emission and route-facing result shapes. Characterization also caught and fixed
the old SQLite queue-update boolean binding hazard by binding `0/1` pause
flags. Focused validation passed in `test/admin-control-repository.test.js` (6
pass / 0 fail). P2 deferred: missing queue names still return success because
that is pre-existing admin API behavior.
The admin onboarding-sample follow-up now moves `onboarding_samples` admin
CRUD and activation persistence into
`database/admin-onboarding-sample-repository.js`; the later service-boundary
follow-up moves input validation, ID generation, active-sample fallback,
persistence orchestration, and audit emission into
`services/admin/onboarding-sample-service.js`, leaving `AdminService` as a
compatibility facade for route-facing result shapes. The
activation path is now transactional and verifies the target row inside the
transaction before deactivating existing samples, closing the direct repository
caller hazard that could otherwise leave no active onboarding sample. Focused
repository validation passed in `test/admin-onboarding-sample-repository.test.js`
(8 pass / 0 fail), and focused service/route validation later passed in
`test/admin-onboarding-sample-service.test.js`,
`test/admin-onboarding-sample-routes.test.js`, and
`test/admin-onboarding-sample-repository.test.js` (17 pass / 0 fail).
The admin job-ops follow-up now moves admin job metrics, job listing/retry,
DLQ listing/reprocess, system-health job snapshots, and job-step-history reads
into `database/admin-job-ops-repository.js`; `AdminService` retains safe bounds,
audit emission, and route-facing failure results. The slice hardens retry
against non-failed job mutation and lost races, and makes DLQ reprocess update
the job and DLQ row in one adapter transaction while mapping concurrent
reprocess races back to admin failure results. Focused validation passed in
`test/admin-job-ops-repository.test.js` (10 pass / 0 fail).
The admin story-session follow-up now moves admin story-session list/detail
reads and story-turn hydration into
`database/admin-story-session-repository.js`; `AdminService` retains safe
bounds and route-facing delegation. Characterization pins list filtering,
pagination bounds, list-row redaction of turn/body text, detail 404 behavior,
and turn ordering scoped to the requested session. Focused validation passed in
`test/admin-story-session-repository.test.js` and
`test/admin-story-session-routes.test.js` (8 pass / 0 fail).
The admin moderation follow-up now moves blocked-version queue reads and
blocked-version approval writes into
`database/admin-moderation-repository.js`; `AdminService` retains safe bounds,
audit emission, and route-facing failure results. The slice deliberately
hardens the override contract: missing versions now return 404, non-blocked
versions return 409, weak/whitespace reasons are rejected before mutation, and
audit rows are written only after an actual blocked-version approval. Focused
validation passed in `test/admin-moderation-repository.test.js`,
`test/admin-moderation-routes.test.js`, `test/admin-job-ops-repository.test.js`,
and `test/admin-story-session-routes.test.js` (22 pass / 0 fail).
The admin analytics events follow-up now moves dashboard event-count, daily
event-count, cohort-funnel, selected user-event read, and `analytics.user.read`
audit persistence into `database/events-repository.js`; `AdminAnalyticsService`
now retains cache ownership, day/limit clamping, funnel hop policy, audit
metadata assembly, and response formatting while `AdminService` is only the
compatibility facade. Characterization pins strict
`created_at > cutoff` semantics, non-leaking selected user-event columns,
null-user cohort exclusion, end-after-start conversion semantics, audit row
shape, cache behavior, and `limit=999 -> 200` clamping. Focused validation
passed in `test/events-repository.test.js` and `test/admin-analytics.test.js`
(17 pass / 0 fail). The admin audit follow-up generalizes that same repository
boundary with `insertAuditLog()` through `AdminAuditService`, which now owns
audit ID generation, admin metadata enrichment, action/resource selection, and
timestamp ownership. The boundary tests use a throwing DB stub to prove the
service path does not write `audit_logs` directly.
The admin metrics follow-up now moves voice-enrollment dashboard metrics into
`database/admin-metrics-repository.js` beside overview metrics. The later
`AdminMetricsService` extraction now owns rolling-window calculation, while
`AdminService` is only the route-facing compatibility facade. Characterization
pins the admin auth gate, all-time enrollment totals, all-time abandonment
counts, numeric completion/quality scores, quality bucket boundaries, null-score
exclusion, current lack of deleted-profile filtering for quality metrics,
inclusive `started_at >= weekAgo` trend semantics, no zero-filled trend days,
and adapter-stable numeric aggregate rows. Focused validation passed in
`test/admin-metrics-repository.test.js`,
`test/admin-enrollment-metrics-routes.test.js`, and
`test/admin-overview-metrics-routes.test.js` (10 pass / 0 fail).
The admin render-pipeline metrics follow-up now moves render success/error/
latency/trend persistence into `database/admin-metrics-repository.js`.
`AdminMetricsService` now retains the rolling seven-day cutoff; `AdminService`
is only the route-facing compatibility facade. Characterization pins the admin
auth gate, all-time success-rate denominators, the current `status = 'ready'`
success definition, seven-day job-error and step-latency windows,
`updated_at`-based error recency,
`created_at`-based latency inclusion, the strict `>5` sample threshold for step
latency, seven-day `completed_at` trend grouping, null-`completed_at`
exclusion, and adapter-stable numeric aggregate rows. Focused validation passed
in `test/admin-metrics-repository.test.js`,
`test/admin-render-pipeline-metrics-routes.test.js`,
`test/admin-enrollment-metrics-routes.test.js`, and
`test/admin-overview-metrics-routes.test.js` (15 pass / 0 fail).
The admin risk metrics follow-up now moves risk distribution, active lock
count, and recent escalation reads into
`database/admin-metrics-repository.js`. `AdminMetricsService` now retains
`now`/`weekAgo` cutoff construction and audit metadata parsing/fallback
behavior, while `AdminService` is only the compatibility facade.
Characterization pins the admin auth gate, distribution filtering for
non-deleted users, the current active-lock count behavior that includes
soft-deleted locked users, exclusive `locked_until > now` semantics,
`audit_logs.resource_id` as the escalated user id, inclusive
`created_at >= weekAgo` escalation windows, wrong-action and old-row
exclusion, malformed metadata fallback, empty metadata fallback, and
adapter-stable numeric counts. Focused validation passed in
`test/admin-metrics-repository.test.js`,
`test/admin-risk-metrics-routes.test.js`,
`test/admin-render-pipeline-metrics-routes.test.js`,
`test/admin-enrollment-metrics-routes.test.js`, and
`test/admin-overview-metrics-routes.test.js` (20 pass / 0 fail).
The admin cost metrics follow-up now moves cost aggregation into
`database/admin-metrics-repository.js`. `AdminMetricsService` now retains the
route-provided `days` cutoff calculation and response delegation. The slice
also fixes three verified correctness defects found during adversarial review:
the previous SQL used PostgreSQL-only JSON casts and failed under SQLite, it
filtered on obsolete `track_versions.status = 'completed'` instead of the live
`preview_ready`/`full_ready` final render statuses, and it ignored the
populated `cost_estimate_json.usd` field while `actual_cost_json` is not
written by the live creation/render path. Characterization pins the admin auth
gate, bare `{ dailyCosts, costByType }` response shape, exclusive
`created_at > daysAgo` daily window, all-time type aggregates, actual-cost
precedence over estimates, final-status inclusion, obsolete `ready` exclusion,
missing-cost JSON null aggregate semantics, and adapter-stable numeric values.
Focused validation passed in `test/admin-metrics-repository.test.js`,
`test/admin-cost-metrics-routes.test.js`,
`test/admin-risk-metrics-routes.test.js`,
`test/admin-render-pipeline-metrics-routes.test.js`,
`test/admin-enrollment-metrics-routes.test.js`, and
`test/admin-overview-metrics-routes.test.js` (25 pass / 0 fail).
The KPI/daily-aggregate follow-up now moves daily aggregate input reads,
aggregate upserts, freshness reads, dashboard list reads, and KPI trend
summaries into `database/daily-aggregates-repository.js`.
`compute-daily-aggregates.js` retains date-window calculation, recent/stale
recompute policy, aggregate id generation, trend percentage calculation, and
the exported function contracts used by admin routes. Characterization pins the
admin auth gate, bare `{ aggregates }` response shape, inclusive daily
`created_at >= dayStart AND <= dayEnd` windows, rolling WAU/MAU windows, event
name mapping, subscription/revenue source tables, update-vs-insert behavior,
recent KPI route recomputation, and week-over-week trend math. The repository
normalizes aggregate and trend totals to JavaScript numbers so Postgres `SUM`
strings/nulls do not leak into admin dashboards. Focused validation passed in
`test/daily-aggregates.test.js` and `test/admin-kpi-routes.test.js` (5 pass /
0 fail).
The admin entitlement tier update follow-up now moves the tier read/update/insert
persistence for `PUT /admin/dashboard/users/:id/entitlements` into
`database/admin-entitlements-repository.js`. `AdminService` keeps tier
validation and audit orchestration, and the superadmin-only route gate remains
unchanged. Characterization pinned unauthenticated and non-superadmin denial,
invalid-tier and empty-body error envelopes, existing-row update behavior,
audit metadata, and missing-row insert behavior. The characterization exposed a
P1 SQLite/Postgres schema mismatch: the legacy insert omitted `updated_at`,
which fails SQLite's `NOT NULL` schema and depends on Postgres defaults. The
repository now supplies `updated_at` explicitly on the missing-row insert while
preserving the existing-row behavior that only `tier` is updated. Focused
validation passed in `test/admin-entitlements-routes.test.js` (4 pass / 0
fail), and the delegated adversarial review returned zero P0/P1.
The admin security-observability follow-up now moves auth-event search, auth
event stats, Apple refresh-token audit stats, audit-log search, rate-limit
reads, rate-limit row deletion, and consent-log reads into
`database/admin-security-observability-repository.js`. The later
`src/services/admin/security-observability-service.js` extraction now owns
date-window calculation, pagination bounds, LIKE-pattern escaping, response
normalization, and reset audit orchestration behind the `AdminService`
compatibility facade; `getSystemHealth` remains backed by
`admin-job-ops-repository.js`. Characterization pins the admin session gate,
superadmin-only reset gate, auth-event filters/order/user email join, 24-hour
auth stats, escaped audit action search, Apple refresh count/last-seen stats,
near-limit ratio filtering, reset delete scope, reset audit metadata, and
consent-log filters/order/user email join. Focused validation passed in
`test/admin-security-observability-routes.test.js` (5 pass / 0 fail).
The admin user-mutation follow-up now moves direct `users` row mutation SQL for
risk updates, lock/unlock, delete snapshots/deletes, profile updates, and
profile attribution snapshots into `database/admin-user-mutation-repository.js`.
`AdminUserMutationService` now keeps bulk action orchestration, lock-duration
calculation, audit-before-delete ordering, audit metadata, and the manual
attribution override contract while `AdminService` is only the compatibility
facade. Characterization pins the risk-level validation envelope,
admin-vs-superadmin route gates, lock/unlock storage and audit behavior,
ignored profile fields, allowed profile updates, attribution previous/next
audit metadata, missing-user delete envelope, deletion snapshot, and
audit-before-delete behavior. Focused validation passed in
`test/admin-user-mutation-service.test.js` and
`test/admin-user-mutations-routes.test.js`.
The admin user session/voice-control follow-up now moves active-session reads,
single-session revocation, all-session revocation, and force voice
reverification profile reads/updates into
`database/admin-user-session-control-repository.js`. `AdminService` keeps
route-facing error results, default reasons, timestamps, role-gated audit
orchestration, and response shapes. Characterization pins unauthenticated and
non-superadmin denial, active-session filtering/order, single revocation,
already-revoked/missing-session 404 envelopes, revoke-all affected counts,
voice reverify success/error envelopes, stored `pending_reverification` status,
and audit metadata. Adversarial review exposed two concrete SQL-boundary
issues that were fixed in this slice: voice reverify now chooses the latest
eligible profile deterministically and guards the update against stale
eligibility before auditing, and active-session ordering is explicit for
SQLite/Postgres `NULL` `last_active_at` parity. Focused validation passed in
`test/admin-user-session-control-repository.test.js` and
`test/admin-user-session-controls-routes.test.js` (11 pass / 0 fail).
The admin music diagnostics follow-up now moves recent track-version/track
diagnostic reads and latest-job lookup reads into
`database/admin-music-diagnostics-repository.js`. `AdminService` keeps
safe-bound calculation, provider/status filtering, malformed JSON fallback,
provider precedence, quality-gate projection, and the route response shape.
The repository removes the previous per-diagnostic job lookup by fetching
latest-job candidates for all selected track versions in one ordered query.
Characterization pins the admin session gate, diagnostic response fields,
provider/status query filters, provider precedence, invalid JSON fallback,
quality metadata, and latest job error metadata. Focused validation passed in
`test/admin-music-diagnostics-repository.test.js` and
`test/admin-music-diagnostics-routes.test.js` (4 pass / 0 fail).
The admin growth metrics follow-up now moves teaser funnel event counts and
share-performance aggregate reads into `database/admin-metrics-repository.js`
beside the other admin metrics slices. `AdminMetricsService` now keeps the
day-window calculation and rate formatting while the repository normalizes
SQLite/Postgres count and average outputs to JavaScript numbers. `AdminService`
is only the compatibility facade. Characterization pins the admin session gate,
teaser/share route response shapes, event/share-token
windows, daily trend ordering, claimed-share semantics based on `bound_at`,
rate strings, average access formatting, and status breakdown counts. Focused
validation passed in `test/admin-growth-metrics-repository.test.js` and
`test/admin-growth-metrics-routes.test.js` (5 pass / 0 fail).
The admin webhook-health follow-up now moves webhook audit-log health reads into
`database/admin-billing-repository.js` beside billing dashboard reads.
`AdminService` keeps the 24-hour lookback calculation and the explicit
`pendingRetries: 0` placeholder because there is still no webhook retry queue
table. Characterization pins the admin session gate, all-time latest webhook
timestamp, recent webhook type counts, failed-webhook metadata detection, and
non-webhook audit exclusion. Focused validation passed in
`test/admin-webhook-health-repository.test.js` and
`test/admin-webhook-health-routes.test.js` (3 pass / 0 fail).
The admin gift-ops read follow-up now moves overview, order list/detail fan-out,
outbox list, and incident list/lookup persistence into
`database/admin-gift-ops-repository.js`. `AdminGiftOpsService` keeps safe
bounds, time-window calculation, redaction, parsing, and admin response shaping;
`routes/admin.js` keeps role checks, sensitive-detail gating, and the existing
`GIFT_OPS_MIGRATION_REQUIRED` missing-schema fallback. Focused validation passed
in `test/admin-gift-ops-repository.test.js` and
`test/admin-gift-ops-routes.test.js` (10 pass / 0 fail), plus `npm run lint`
and targeted `git diff --check`.
The gift-dispatch scheduler follow-up now moves stale dispatching recovery,
stale channel-send recovery, overdue-undelivered selection/marking, and due-gift
selection into `database/gift-dispatch-repository.js`. `gift-dispatch.js` keeps
the non-reentrant tick guard, wall-clock cutoff calculation, incident
creation/resolution, dispatch callback invocation, failure logging, interval
ownership, and startup tick behavior. Focused validation passed in
`test/gift-dispatch-repository.test.js`; the existing scheduler behavior cases
in `test/gifts.test.js` also passed with the `stale dispatching gifts|marks
overdue scheduled gifts` name filter, plus `npm run lint` and targeted
`git diff --check`.
The gift-delivery incident follow-up now moves `gift_delivery_incidents`
insert/update/read persistence into `database/gift-delivery-incident-repository.js`.
`gift-delivery-ops.js` keeps receipt precedence, receipt normalization, contact
redaction, timestamp/id generation, reopen policy, and service-level public
exports used by gift routes. Focused validation passed in
`test/gift-delivery-incident-repository.test.js`; consumer validation passed in
`test/gift-webhooks.test.js` and `test/admin-gift-ops-routes.test.js`, plus
`npm run lint` and targeted `git diff --check`.
The gift-funding support follow-up now moves reservation lookup, funded-content
lookup, share revocation, content soft-delete, and library-entry removal
persistence into `database/gift-funding-repository.js`. `gift-funding.js` keeps
active-status validation, expiration checks, owner/content-type/finalized
errors, and deletion orchestration. Focused validation passed in
`test/gift-funding-repository.test.js`; consumer validation passed in the
reservation cancellation/expiry/finalize cases from `test/gifts.test.js` and
the mocked validation path in `test/story-billing.test.js`, plus `npm run lint`
and targeted `git diff --check`.
The gift-content validation follow-up now moves only the `tracks`,
`track_versions`, and `poems` read persistence used by `validateGiftContent()`
into `database/gift-content-repository.js`. `routes/gifts.js` keeps content
ownership checks, deleted/ready handling, version resolution, poem verse
parsing, error codes, and snapshot shaping. Focused validation passed in
`test/gift-content-repository.test.js` and `test/gifts.test.js` (44 pass / 1
skipped / 0 fail).
The artwork access follow-up now moves `/tracks/:trackId/artwork.jpg`
share-token and track-owner reads into
`database/artwork-access-repository.js`. `routes/artwork.js` keeps HMAC
verification, share revocation/expiry policy, owner auth, storage-key
construction, S3 hydration, cache headers, and error envelopes.
Characterization pins the repository row shapes, missing-row behavior, owner
bearer authorization through the injected repository boundary, and the
valid-HMAC/missing-track 404 path. Focused validation passed in
`test/artwork-access-repository.test.js`,
`test/routes/artwork-access-route.test.js`, and
`test/routes/artwork-hmac.test.js` (20 pass / 0 fail).
The phone-verification follow-up now moves OTP rate-limit lookups, active-code
invalidation, verification insert, active verification/attempt reads,
attempt increment, verified marking, and cleanup deletes into
`database/phone-verification-repository.js`. `sms-service.js` keeps phone
normalization, OTP generation/hash comparison, Twilio send-before-store
semantics, retry/attempt policy, and route-facing return shapes. Focused
validation passed in `test/phone-verification-repository.test.js`; consumer
validation passed in `test/auth-identity-model.test.js`,
`test/registration-country-attribution.test.js`, and
`test/receiver-attribution.test.js`, plus `npm run lint` and targeted
`git diff --check`.
The OneSignal tag-sync follow-up now moves the user/song-count/last-song
aggregate read into `database/one-signal-tag-sync-repository.js`.
`onesignal.js` keeps configuration checks, scheduling, tag bucketing, date
math, OneSignal API calls, immediate-start behavior, and per-user error
tolerance. The repository normalizes `COUNT()` to a number so PostgreSQL string
counts cannot misclassify users with one song as `"5+"`. Focused validation
passed in `test/one-signal-tag-sync-repository.test.js` and
`test/onesignal-service.test.js`; `node --check` passed for the changed
service/repository files.
The voice-profile route-read follow-up extends
`database/voice-provider-profile-repository.js` with the active/latest profile
reads used by `/voice/profile`, the active-id read used by `/voice/reverify`,
and the delete preflight read used by `DELETE /voice/profile`.
`routes/enrollment.js` keeps HTTP auth, rate limits, response shaping,
provider-profile response composition, token revocation, audit emission, and
the actual soft-delete mutation. Characterization pins repository read behavior,
`GET /voice/profile` active/latest/deleted behavior, `POST /voice/reverify`
challenge shape, and `DELETE /voice/profile` soft-delete effects. Focused
validation passed in `test/voice-provider-profile-repository.test.js` (8 pass
/ 0 fail) and the filtered `test/voice-enrollment.test.js` profile route run
(7 pass / 0 fail).
The admin gift-bundle management follow-up moves
`/admin/billing/gift-bundles` list/get/update/refetch persistence into
`database/admin-billing-repository.js`. `routes/admin.js` retains admin
session/role gates, update-field filtering, integer validation, error
envelopes, audit payload construction, and response shape. Characterization
pins repository list ordering, get/update row effects, route list ordering,
superadmin-only mutation, validation errors, missing-bundle 404 behavior, and
the existing `admin_update_gift_bundle` audit payload. Focused validation
passed in `test/admin-billing-repository.test.js` and
`test/admin-gift-bundles-routes.test.js` (10 pass / 0 fail).
The share-token follow-up now moves song and poem share-token creation,
existing-token lookup, PIN-less reuse stripping, lifetime upgrade/status heal,
expired/revoked cleanup, and track/poem backlink updates into
`database/share-token-repository.js`. `share-service.js` keeps share ID/PIN/key
generation, URL building, attribution mapping, follow-up scheduling, MP4
pre-generation, lifetime/demo usability policy, and public return shapes.
`routes/tracks.js` now uses the same repository for its duplicate active manual
share lookup and backlink repair while keeping auth, OG variant validation,
audit/event emission, and route responses in the route layer. The slice
intentionally preserves the existing non-transactional
delete/insert/backlink sequence; fixing that race is a later share consistency
hardening, not part of this repository extraction. Focused validation passed in
`test/share-token-repository.test.js`, `test/share-service.test.js`, and the
share route/security bundle:
`test/render-endpoints.test.js`, `test/recipient-contact.test.js`,
`test/share-flow.test.js`, `test/share-embed.test.js`,
`test/share-app-only.test.js`, `test/sharing-security.test.js`, and
`test/receiver-session.test.js`, plus `npm run lint` and `git diff --check`.
The full backend test sweep also passed after this slice with
`NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 --test-reporter=dot "test/**/*.test.js"`.
The job-durability follow-up now moves durability jobs-row persistence into
`database/job-durability-repository.js`: DLQ decision reads, checkpoint row
fetch/write, heartbeat writes, stale running-job recovery, job health reads, and
status-count aggregation. `workflows/durability.js` keeps circuit-breaker/DLQ
orchestration, checkpoint JSON merge policy, stale-threshold calculation, and
public service return-shape mapping. Focused validation passed in
`test/job-durability-repository.test.js`, plus the existing
`test/workflows/durability.test.js` and `test/workflows/dlq.test.js`; lint and
`git diff --check` also passed.
The render job/track-version read follow-up now moves server helper reads for
job by-id lookup, active-job lookup, latest failed-job lookup, batch latest
failure lookup, track-version by-id/by-number lookup, per-track version listing,
and latest cover-image version listing into `job-durability-repository.js` and
`track-version-repository.js`. `server.js` still owns render error
classification, URL shaping, retry reset writes, media serving, and response
shaping. The follow-up also fixes `test/mvp-flow.test.js` to use the real
`x-device-token` for `/share/:id/key` after claim, removing accidental reliance
on development fallback headers. Focused validation passed in
`test/job-durability-repository.test.js` (8 pass / 0 fail),
`test/track-version-repository.test.js` (3 pass / 0 fail),
`test/render-endpoints.test.js` (17 pass / 0 fail),
`test/dlq-retry-endpoint.test.js` (12 pass / 0 fail),
`test/security-units-6-7-8.test.js` (15 pass / 0 fail),
`test/share-flow.test.js` (48 pass / 0 fail), and
`test/mvp-flow.test.js` (2 pass / 0 fail), plus syntax checks, lint, and diff
whitespace checks.
The transaction-scoped gift share read follow-up now adds query-aware
track/track-version reads to `track-version-repository.js` and moves the
remaining injected-query lookup in `ensureTrackGiftShareToken` out of
`server.js`. Focused validation passed in
`test/track-version-repository.test.js` (4 pass / 0 fail),
`test/gifts.test.js` (40 pass / 1 skipped / 0 fail), and
`test/share-flow.test.js` (48 pass / 0 fail), plus syntax checks, lint, diff
whitespace checks, and a grep check showing no remaining `server.js`
job/track-version SQL matches.
The workflow DLQ follow-up now moves `createDLQService` persistence into
`database/dead-letter-queue-repository.js`: job lookup, idempotent DLQ upsert,
DLQ list/read, dead-letter status update, reprocess job creation, reprocessed
marker update, count stats, and purge. `workflows/dlq.js` keeps public error
messages, ID generation, return-shape mapping, and orchestration. The slice also
keeps legacy `retry_count`/`current_step`/`max_retries` behavior while supporting
the current runner schema's `attempts`/`step`/`max_attempts`; purge now uses an
adapter-neutral cutoff timestamp instead of PostgreSQL-only interval SQL.
Focused validation passed in `test/dead-letter-queue-repository.test.js`,
`test/workflows/dlq.test.js`, `test/workflows/durability.test.js`,
`test/workflows/dlq-auto-reprocess.test.js`, and
`test/workflows/dlq-retry.test.js`; lint and `git diff --check` also passed.
The device repository follow-up now moves `/device/register` persistence and
shared device token lookup persistence into `database/device-repository.js`.
`routes/enrollment.js` keeps auth/fallback policy, request validation, device
token issuance, and response shape while the repository owns insert/update
semantics, including preserving an existing push token when an update omits one.
`workflows/runner.js` keeps
push-notification configuration checks, fire-and-forget render-complete
dispatch, failure tolerance, track/version context, and the surrounding terminal
job transition semantics. `routes/sharing.js` keeps receiver-play-completed
event handling, track-title lookup, APNs send orchestration, and lookup-failure
tolerance. This intentionally avoids the high-risk runner due-job claim,
heartbeat, stale recovery, and completion update cluster, and avoids moving
sharing track-title reads in this slice. Focused validation passed in
`test/device-repository.test.js`, `test/push-notification.test.js`,
`test/ready-step-s3-ordering.test.js`, `test/share-flow.test.js`,
`test/recipient-contact.test.js`, `test/share-embed.test.js`,
`test/receiver-session.test.js`, and `test/sharing-security.test.js`; the final
device-registration-focused rerun passed 81 pass / 2 skipped / 0 fail after
expanding `test/device-repository.test.js` to cover insert, update-with-token,
and update-without-token behavior.
The story V3 orchestration follow-up now moves execution create/update/get/list
and execution-event append/list persistence into `database/story-repository.js`.
`routes/story.js` keeps admin authorization, request bounds, runtime execution,
JSON response shaping, replay behavior, event-write failure tolerance, and the
existing error envelopes. Focused validation passed in
`test/story-repository.test.js` and `test/story-v3-orchestration-routes.test.js`
(9 pass / 0 fail), plus syntax checks for the route, repository, and new test.
The story library-entry follow-up now moves the route-local
`track_library_entries` and `poem_library_entries` upsert/remove helpers into
`database/story-repository.js`. `routes/story.js` keeps gift-funded content
branching, subscription/rate-limit checks, story context, poem/song creation,
and response shaping. Focused validation passed in
`test/story-repository.test.js`, `test/story-delete-poem.test.js`,
`test/story-billing.test.js`, and `test/story-to-track-contract.test.js` (22
pass / 0 fail), plus syntax checks for the route, repository, and repository
test.
The poem route library-entry follow-up now moves `/poems` list persistence,
`DELETE /poems/:id` library removal, and the active-library check used by poem
claim idempotency into `database/poem-library-repository.js`. A same-domain
follow-up then moves the server-injected `getPoemForLibrary` and
`upsertPoemLibraryEntry` SQL into that same repository while preserving the
`routes/poems.js` injection contract. `routes/poems.js` keeps auth, response
shaping, poem CRUD/generation, and share validation. Focused validation passed
in `test/poem-library-repository.test.js` and `test/poems.test.js` (24 pass /
0 fail), plus syntax checks for the route, server, repository, and repository
test.
The track library follow-up now moves `/tracks` listing persistence,
`DELETE /tracks/:id` library removal, and server-injected
`getTrackForLibrary`/`upsertTrackLibraryEntry` helper persistence into
`database/track-library-repository.js`. `routes/tracks.js` keeps auth,
hydration, library flag response shaping, track detail/update/delete
orchestration, share validation, rendering, and version behavior. `server.js`
keeps the route injection contract while delegating helper bodies to the
repository. Focused validation passed in
`test/track-library-repository.test.js`, `test/share-flow.test.js`,
`test/mvp-flow.test.js`, and `test/story-to-track-contract.test.js` (58 pass /
0 fail), plus syntax checks for the route, server, repository, and repository
test.
The gift reservation follow-up now moves reservation lookup, idempotency lookup,
active-reservation lookup, expired-active selection, reservation insert,
refund-status update, content attach/reconcile update, transaction-scoped
finalize update, and the gift-funded track render spend validation read into
`database/gift-reservation-repository.js`. `routes/gifts.js` keeps feature
flags, auth, wallet reserve/refund transactions, funded-content cleanup,
validation, delivery parsing, gift-order creation, dispatch, audit events, and
response shaping. `routes/tracks.js` keeps entitlement fallback orchestration
while using the repository for the transaction-scoped active reservation check.
Focused validation passed in `test/gift-reservation-repository.test.js`,
`test/gifts.test.js`, and `test/render-endpoints.test.js` (46 pass / 1 skipped
/ 0 fail in the gift route suite; 24 pass / 0 fail in repository plus render
endpoint rerun), plus syntax checks for the routes, repository, and repository
test.
The gift-wallet follow-up now moves wallet row creation, balance reads, wallet
summary reads, receipt-credit reconciliation reads, idempotent credit/debit
ledger writes, transaction-scoped receipt crediting, and gift-token song-spend
ledger writes into `database/gift-wallet-repository.js`. `routes/gifts.js`
keeps reservation and delivery decisions while delegating wallet balance and
ledger mutations. `routes/billing.js` keeps receipt validation and bundle
resolution while delegating wallet reconciliation and crediting. The
subscription manager keeps spend-order semantics while delegating gift-wallet
balance and debit ledger persistence. Focused validation passed in
`test/gift-wallet-repository.test.js`, `test/subscription-manager.test.js`,
`test/billing-api.test.js`, `test/gifts.test.js`, and
`test/render-endpoints.test.js` (151 pass / 1 skipped / 0 fail), plus syntax
checks for the repository, server, billing/gift routes, subscription manager,
and repository test.
The gift-dispatch follow-up now expands `database/gift-dispatch-repository.js`
from scheduler-only persistence to server dispatcher persistence for outbox
creation/existence, dispatch-attempt ledger inserts, sent/failed delivery
transitions, provider-message receipt lookup/update, and per-gift stale sending
recovery. `server.js` still owns the business workflow, provider sends,
wallet refund decisions, share dispatch sync/revocation, incidents, audit
events, and response/event shaping. Focused
validation passed in `test/gift-dispatch-repository.test.js` and
`test/gifts.test.js` (29 pass / 0 fail across the two focused reruns), plus
syntax checks for the repository, server, and repository test.
The gift-order management follow-up now moves `/gifts` listing, cancel/retry
gift-order status transitions, reschedule field updates, and the
non-transaction gift reloads in immediate dispatch/finalized reservation
responses into `database/gift-order-repository.js`. The route still owns
permission checks, wallet refunds, share-token schedule/revoke side effects,
audit/events, request normalization, and response shaping; outbox
cancel/retry/reschedule helpers live in `gift-dispatch-repository.js`. Focused
validation passed in `test/gift-order-repository.test.js`,
`test/gift-dispatch-repository.test.js`, and `test/gifts.test.js` (57 pass /
0 fail across the focused reruns), plus syntax checks, lint, and diff
whitespace checks.
The gift create/finalize follow-up now makes `gift-order-repository.js`
transaction-aware and moves gift-order idempotency lookup, scheduled gift-order
insert, finalized-reservation gift reloads, and finalize integrity gift-order
reads into it. Finalize integrity outbox reads now go through
`gift-dispatch-repository.js`, and share binding reads now go through
`share-token-repository.js` with injected-query support. `routes/gifts.js`
still owns the orchestration boundary: feature flags, content validation,
wallet debit/refund decisions, share-token creation, outbox creation, integrity
interpretation, audit/events, dispatch invocation, and response shaping.
Focused validation passed in `test/gift-order-repository.test.js`,
`test/gift-dispatch-repository.test.js`, `test/share-token-repository.test.js`,
and `test/gifts.test.js` (63 pass / 0 fail across the focused reruns), plus
syntax checks, lint, and diff whitespace checks.
The gift share-token side-effect follow-up now moves cancel-time gift share
revocation and reschedule-time dispatch/expires updates for both song and poem
gift shares into `share-token-repository.js`. This removes the last raw
gift/share persistence statements from `routes/gifts.js`; the route now keeps
only orchestration, validation, wallet decisions, activity emission, and
response shaping for the gift route surface. Focused validation passed in
`test/share-token-repository.test.js` and `test/gifts.test.js` (48 pass /
0 fail across the focused reruns), plus syntax checks, lint, and diff
whitespace checks.
The gift route identity-read follow-up now moves sender display-name/email
lookup for gift creation into `identity-repository.js`. `routes/gifts.js` now
has no direct `db.prepare`/`db.query` calls; it is still behavior-heavy, but its
persistence dependencies are repository/facade calls. Focused validation passed
in `test/identity-repository.test.js` and `test/gifts.test.js` (49 pass /
0 fail across the focused reruns), plus syntax checks, lint, and diff
whitespace checks.
The server gift-dispatch state follow-up now moves dispatch locks, gift reloads,
sender display-name/email lookup, due outbox selection, outbox row locking,
post-send outbox reloads, aggregate observability updates, final sent status,
partial/failure status, and crash recovery into `gift-dispatch-repository.js`
and `identity-repository.js`. `server.js` still owns dispatch orchestration,
provider sends, refund policy, share side effects, incidents, audit/events, and
log/response shaping. Focused validation passed in
`test/gift-dispatch-repository.test.js` (12 pass / 0 fail) and
`test/gifts.test.js` (40 pass / 1 skipped / 0 fail), plus syntax checks, lint,
diff whitespace checks, and a grep check confirming the moved gift-dispatch SQL
cluster no longer lives in `server.js`.
Root 1 is closed locally. The remaining architecture work moves to the next
roots: Root 4 provider strategy, Root 2 auth/rate-limit consolidation with
production verification, Root 3b gift-delivery service extraction, Root 5 runner
step registry, Root 6 admin split, Root 7 writer cycle, and the later migration,
storage/OpenAPI, cleanup, and cross-surface roots. Full gift-dispatch
provider/orchestration extraction is a Root 3b service-boundary task, not
remaining Root 1 persistence.
Public/admin app-config persistence is done;
full `getAppConfig` ownership should still move out of
`admin-service.js` in Root 6.
Provider-side remote artifacts that live outside the configured storage
provider still need empirical
provider-contract validation before they can be called fully erased.
Gift reservation route mutations are now repository-backed. Full gift-dispatch
provider/orchestration extraction remains a reasonable bounded service seam only
when revenue-adjacent owner review is available.
**Why keystone:** It gives the SDP-violating routes/services a _stable thing to depend toward_, makes business logic mockable (lifts testability from F), and is mechanical/low-risk because the DB adapter already abstracts the driver. No domain extraction root should start before this root terminates.
**Boundary:** Default to no SQL semantics or schema changes. Any exception must
be a named correctness/privacy fix with a migration gate and adversarial review,
as with the account-deletion tombstone-key migration. Do not change revenue
semantics in Root 1; account-deletion may delete/scrub revenue-adjacent user
rows only as part of the privacy cascade, and billing behavior changes still
belong in Root 6/Root 7 with owner review. Go aggregate-by-aggregate; each
aggregate is its own commit + adversarial pass.
**Sequencing note:** Do this BEFORE Root 5 (runner step extraction) so step handlers can inject repos instead of closure-captured prepared statements.

### Root 2 — Auth & rate-limit consolidation ⚠ 🔴 effort M

**Closes:** D3 (auth guards, rate-limiters), and verifies the C1 invariant if C1 was patched standalone.
**Scope:** One `requireUser` middleware (JWT verify + session-revocation + `ensureUser`) in `src/middleware/`; one `rate-limiter` service (`consume({key, max, windowMs})`) over the atomic `rate_limits` table, with explicit key-space (`{subject:'user'|'ip', value}`); delete the duplicate `sendError` in auth.js.
**Why high:** Highest _correctness_ value (closes C1) + removes a class of recurring rate-limit bugs.
**Boundary:** Revenue path. Stage behind owner review. Verify in production: revoked session → 401 on a money endpoint; rate-limit window math identical across user + IP + share paths. Do NOT change token rotation logic (already hardened).
**Execution status:** Implemented locally. `server.js` and auth routes now use a shared `requireUser` middleware backed by `auth-service.verifyActiveUser` and `auth-service.verifyActiveSessionForUser`; `server.js` generic rate limits delegate to `src/database/rate-limit-repository.js`; `auth.js` uses the shared HTTP error helper. Added local revoked-session money-endpoint coverage for `/billing/receipt/apple`. The production revoked-session smoke check remains a deployment/ops follow-up.

### Root 3a — De-god `server.js`: mechanical bootstrap split 🟢 effort S–M _(Phase A)_

**Execution status:** Implemented and validated for the low-risk mechanical
surface: Fastify app/bootstrap, static/security plugins, body parsers, Apple App
Site Association handling, validation schema constants, and share URL builders.
`server.js` is reduced to 5,196 lines. The remaining `start()` timer/job wiring
is still in `server.js`; do not merge it with Root 3b's gift subsystem extraction
without a separate contract gate.

**Closes:** D2 (server.js), first half.
**Scope (low-risk, pure move-and-wire):** Using **Fastify plugin encapsulation** (not a new framework — per the Fastify Plugins Guide), split `buildServer()` into: app factory, security/plugins (cors/helmet/ratelimit/static), media-serving helpers, share-URL builders (`utils/share-urls.js`), JSON schema definitions, and eventually `start()` job-startup wiring. Move `requireUserId`/`consumeRateLimit`/`addAuditEntry` to `src/middleware/` only after C1 is patched or explicitly folded into Root 2.
**Why moved earlier (Codex):** This part is mechanical and behavior-preserving, and it makes every later root easier to navigate. It is gated by a **full-route smoke test** (G1) that hits every endpoint and asserts unchanged status/shape.
**Boundary:** NO logic changes. Does NOT touch the gift subsystem (that's 3b). Does NOT change auth behavior except for an already-approved C1 patch.

### Root 3b — De-god `server.js`: gift-delivery subsystem extraction 🟡 (revenue-adjacent) effort M _(Phase C)_

**Execution status:** Committed locally as
`76d105e7 refactor: extract gift delivery plugin`. The gift delivery
normalizers, wallet wrappers used by gift routes, share-token creation,
outbox/dispatch state machine, Twilio/Resend webhooks, gift route registration,
and startup gift runtime wiring now live in `src/plugins/gift-delivery.js`.
`server.js` keeps only the small gift-wallet wrappers required by billing and
the synchronous plugin call needed to preserve the existing `buildServer()`
contract where tests and callers directly use `app.dispatchGiftById()` and
`app.expireGiftReservations()` after construction. Focused gift validation,
expanded gift/admin/billing coupling validation, and lint pass locally.

**Closes:** D2 (server.js), second half.
**Scope:** Lift the 1,650-line gift-delivery subsystem (state machine, Twilio/Resend dispatch, retry, observability) out of `buildServer()` into `services/gift-delivery-service.js` + a `register*Routes` group; move the Twilio/Resend webhook handlers to `routes/webhooks.js`.
**Why later than 3a:** This is the risky part — a live dispatch state machine, revenue-adjacent. Needs gift-dispatch contract tests (G1) and end-to-end dispatch verification.
**Boundary:** Move-and-wire only; do NOT redesign the gift state machine. Verify dispatch still fires end-to-end before "done."

### Root 4 — Provider Strategy + uniform HTTP 🟢 effort S–M

**Closes:** D4.
**Scope:** Define a thin provider contract (`{name, submit(input,opts), poll(id)}` or `run(input,opts)`), all on `http.js` for retry/timeout. Route `whisper.js` + `elevenlabs-voice.js` through `http.js` (the immediate correctness win — they currently have no retry in a render hot path). Add a `providers/index.js` registry; extend the existing `resolveMusicProvider` to all providers. Make providers use `storage/index.js` key-helpers instead of hand-building paths.
**Execution status:** Slice 1 is committed. Added a shared
`fetchResponse` helper with retryable response/network handling and aborting
timeouts. OpenAI Whisper transcription/alignment plus ElevenLabs voice
clone/delete/conversion/listing now route through it. Voice clone/delete default
to no retry to avoid duplicate remote resources; render hot-path conversion can
opt into retry. Focused provider, render endpoint, ready-step, and
voice-conversion routing tests pass locally.

Slice 2 is committed as `61fb9d9b refactor: centralize provider boot config`.
`src/providers/provider-config.js` now owns the
server/worker boot-time provider config and storage runtime config. `server.js`
and `worker.js` both consume this factory, eliminating the prior drift where the
separate worker could enable ElevenLabs as a live music provider while the server
correctly kept song generation Suno-only. The factory also carries Replicate
RVC/Demucs fields, HF token, storage S3/KMS fields, and
`UPLOAD_SIGNING_SECRET` through one shared shape. Focused provider/storage
validation, lint, diff check, and the full `npm test` suite passed before commit
(2,938 pass / 23 skipped / 0 fail).

Slice 3 routes `/health/providers` through the same normalized provider config
factory instead of rebuilding health-check config from ambient env. It also pins
the route's admin role guard so valid admin access cannot hide a 500 behind a
loose auth assertion. Remaining provider debt stays out of this slice: runtime
DB `music_provider_config` parser unification, and LLM/Whisper modules still
read env directly.

Slice 4 centralizes `music_provider_config` defaults, JSON parsing, lenient
persisted-read normalization, strict admin patch validation, Suno-only routing
normalization, Suno model allowlisting, reroll clamps, and style override
sanitation in `src/providers/provider-config.js`. `admin-service.js` and
`runner.js` now consume the same helpers instead of duplicating parser and
normalization logic.

Slice 5 moves Whisper/OpenAI transcription credentials into normalized provider
runtime config. Story audio routes and runner lyric alignment now pass explicit
Whisper config, and `src/providers/whisper.js` no longer reads
`process.env.OPENAI_API_KEY` directly.

Slice 6 replaces provider-side manual local track-version directory construction
in `music.js` and `suno.js` with the shared `getVersionDir()` helper. Runner
artifact paths remain a separate, larger local-storage cleanup slice because
they touch many render-contract fallbacks.

Slice 7 replaces runner-side manual local track-version directory construction
with `getVersionDir()` in S3 upload, placeholder output, DLQ auto-reprocess
cleanup, ready cover generation, ready lyric alignment, and ready cleanup paths.
The storage path scan for `path.join(storageDir, "tracks", ...)` is now clean
across providers and runner.

Slice 8 centralizes voice-conversion runtime config in
`src/providers/provider-config.js`. Runner-side ElevenLabs voice conversion and
Seed-VC/Demucs config now flow through `createVoiceConversionRuntimeConfig()`
instead of ad hoc fallback reads from ambient environment. The direct
`REPLICATE_API_TOKEN` fallback inside `src/providers/voice.js` is removed so
personalized voice conversion fails against the injected runtime contract rather
than silently succeeding with stale process state.

Slice 9 adds `src/providers/index.js` as the provider capability registry and
wires music routing to consume the registry's music-generation provider list.
This pins the architectural rule that Suno is the only provider-complete song
generator today while ElevenLabs remains available for TTS/voice conversion but
is excluded from song-generation routing even when its runtime config is live.
**Why early:** Mostly off the revenue path, contained, and the first slice (whisper/elevenlabs-voice retry) removes real render-failure risk for low effort.
**Boundary:** Do NOT rewrite provider business logic; only normalize transport + path construction.

---

## TIER 2 — Core-pipeline & domain god-files

### Root 5 — Runner step Registry 🔴 effort L

**Execution status:** Slices 1-9 implemented and validated locally. Added
`src/workflows/steps/index.js` with `createStepRegistry`, moved the CPU-only
moderation handler into `src/workflows/steps/moderation.js`, and switched
`runner.js` dispatch from object property lookup to `stepRegistry.get(stepName)`.
`src/workflows/steps/lyrics.js` now owns the lyrics generation handler with
runner-injected generator, provenance, policy-sanitizer, and JSON helpers.
`src/workflows/steps/music-plan.js` now owns the music-plan handler with
runner-injected provider routing, Suno persona lookup, render-contract,
provenance, and JSON helpers. `src/workflows/steps/guide-vocal.js` now owns the
preview/full guide-vocal handlers with runner-injected TTS, provider config,
render-contract guards, guide-token generation, storage path helpers, and
placeholder WAV generation. Slice 4 also makes `guide_vocal_full` reuse an
existing non-empty `guide_vocal_full.mp3`, closing the documented idempotency
gap without changing the returned URL/token shape. `src/workflows/steps/voice-conversion.js` now owns `voice_convert` and `voice_convert_sections` with
runner-injected conversion helpers, provider URL resolution, render-contract
guards, durability, storage, provider config, and vocal-polish behavior while
preserving the output-file reuse check before contract parsing.
`src/workflows/steps/watermark.js` now owns the `watermark` handler with
runner-injected watermark embedding, AAC encoding, HLS creation, provider
config, storage path helpers, and placeholder WAV generation while preserving
optional HLS failure handling and best-effort intermediate cleanup.
`src/workflows/steps/ready.js` now owns the `ready` quality-gate handler with
runner-injected runtime routing config, quality evaluation, reroll plan
tightening, provenance merging, provider config, and JSON helpers while final
ready completion, upload ordering, cover/artwork handling, share pre-generation,
push notification, cleanup, and terminal job marking intentionally remain in
`runner.js`. A runner-level regression test now pins the reroll transition before
final completion. `src/workflows/steps/mix.js` now owns the `mix` handler and
`hydrateProviderCompleteAudio` with runner-injected contract guards, provider
audio URL/key resolution, live-provider config, ffmpeg/mixing helpers,
guide-vocal recovery, feature flags, storage provider, path helpers, and
placeholder WAV generation while preserving the `_testing` hydration export.
Direct tests pin provider-complete local WAV fallback, AI guide-vocal recovery,
personalized Suno missing-stem failure, live missing-input failure, and non-live
placeholder output. `src/workflows/steps/instrumental.js` now owns
`instrumental` and `instrumental_full` behind one shared family runner with
runner-injected contract guards, provider routing, policy preflight, provider
audio URL/key helpers, provenance helpers, Suno polling/recovery callbacks,
generic provider rendering, local fallback instrumental/guide-vocal renderers,
and job task attachment. No workflow step handlers remain inline in `runner.js`;
`src/workflows/suno-task-orchestrator.js` now owns the extracted Suno task
state machine, including submit attach, existing-task heartbeat polling,
incomplete-success reconciliation, policy-failure telemetry, artifact download,
and recovery-provenance merge behavior. No Suno polling/recovery helpers remain
inline in `runner.js`. Direct step-factory tests, Suno task-orchestrator
characterization tests, ready ordering/reroll validation, focused
workflow/render endpoint validation, voice-routing validation, MVP flow, diff
hygiene, and lint pass locally.

**Closes:** D2 (runner), D3 (instrumental/guide_vocal duplication), the 3-way idempotency inconsistency.
**Scope:** Extract the 12 inline step handlers into `workflows/steps/*.js`, each `{name, run(ctx), shouldSkip(ctx)}`, registered in an ordered array; runner becomes a generic loop. Unify `instrumental`+`instrumental_full` and `guide_vocal`+`guide_vocal_full` (~860 lines of near-duplicate). Pick ONE canonical idempotency mechanism. Extract `pollOrSubmitSunoTask` (200 lines) and the error-classifier helpers.
**Why after Root 1:** Steps need repos to inject rather than closure-captured prepared statements; that seam is the highest-risk part otherwise.
**Boundary:** Core render correctness. Behind tests + adversarial passes per step. Do NOT change retry/backoff numbers or provider routing in this root.

### Root 6 — Split `admin-service.js` + `routes/admin.js` 🟡 (billing slice ⚠ 🔴) effort M–L

**Closes:** D2 (admin god-service + god-route).
**Scope:** Split `admin-service.js` by concern (`admin/audit`, `admin/users`, `admin/analytics`, `admin/metrics`, `admin/shares`, `admin/system`, `provider-config`) and `routes/admin.js` into matching route groups. **Evict `getAppConfig` composition into a `client-config-service`** (it's a mobile endpoint, not admin) — the single worst CRP violation, tiny effort, high value. Root 1 already extracted the public app-config gift-bundle/onboarding-sample read SQL; Root 6 owns the service/route responsibility move.
**Execution status:** Client-config eviction is implemented in this
slice. `src/services/client-config-service.js` now owns the public mobile
config composition, `/app/config` is wired to that service boundary, and
`AdminService.getAppConfig()` remains only as a compatibility delegate for
existing callers/tests. The read-only admin metrics routes are also extracted
into `src/routes/admin/metrics.js`, including overview, jobs, cost,
enrollment, render-pipeline, and risk-metrics route registration. The
read-only admin story-session routes are also extracted into
`src/routes/admin/story-sessions.js`, preserving auth, pagination, 404, list,
and detail payload behavior. Admin moderation queue/override routes are also
extracted into `src/routes/admin/moderation.js`, preserving queue
pagination, superadmin-only override authorization, reason validation, error
envelopes, and audit behavior. The read-only music diagnostics route is also
extracted into `src/routes/admin/music-diagnostics.js`, preserving
auth, filters, limit parsing, error envelope, and response shape. Remaining
admin job/DLQ/step-history routes are also extracted into
`src/routes/admin/job-ops.js`, preserving job list/retry, DLQ list/reprocess,
and step-history behavior while adding route-level coverage. Job-ops follow-up
risks remain intentionally behavior-preserving in this slice: manual retry does
not clear every stale runner-claim field, admin DLQ reprocess semantics differ
from workflow DLQ reprocess, DLQ listing includes reprocessed entries, route
failures remain broad 400s, and missing job step-history is indistinguishable
from empty history. Admin feature-flag GET/PUT routes are also extracted
into `src/routes/admin/feature-flags.js`, preserving the admin session gate,
superadmin-only mutation gate, empty-body validation, service-level validation
envelope, feature-flag cache behavior, and persisted update behavior. Admin
demo-share GET/POST/revoke routes are also extracted into
`src/routes/admin/demo-shares.js`, preserving URL fallback behavior, fixed demo
expiry, song/poem create and conversion flows, song-first revoke lookup, audit
metadata, and role gates while expanding route characterization for conversion,
no-version, missing-resource, and song-revoke cases. Admin security
observability routes are also extracted into
`src/routes/admin/security-observability.js`, preserving the security health
envelope, auth-event filters/stats, Apple refresh stats, audit-log filters,
rate-limit list/reset behavior, consent-log filters, pagination, and role gates.
Admin user-read routes are also extracted into
`src/routes/admin/users-read.js`, preserving user search filters, pagination,
stats formatting, user-detail 404 envelope, attribution decoration, and session
gates while leaving attribution health inline for a later attribution/admin
health split. Admin user session/voice control routes are also extracted
into `src/routes/admin/user-session-controls.js`, preserving active
session listing, superadmin-only revoke gates, single/all session revoke
envelopes and audit behavior, voice force-reverify gates, and missing
voice-profile errors. Non-entitlement admin user mutation routes are also
extracted into `src/routes/admin/user-mutations.js`, preserving risk
update validation, lock/unlock gates, delete envelopes, bulk-action validation
and audit behavior, and profile update attribution audit behavior. Entitlements
and complimentary upgrades intentionally remain later billing-adjacent slices.
Admin song/poem share-management routes are also extracted into
`src/routes/admin/shares.js`, preserving song-share filters/rebind envelopes,
poem-share filters, reset/revoke envelopes, role gates, and audit behavior.
Admin webhook-health route ownership is also extracted into
`src/routes/admin/webhook-health.js`, preserving the admin session gate and
the existing service/repository health envelope.
Admin growth/attribution route ownership is also extracted into
`src/routes/admin/growth.js`, preserving attribution, Apple Ads keyword map,
teaser, share-growth, validation, and admin audit behavior covered by the
existing growth/attribution suites.
Admin KPI route ownership is also extracted into
`src/routes/admin/kpis.js`, preserving aggregate and trend route contracts while
keeping aggregate job helper calls explicit behind an injected database handle.
Admin analytics route ownership is also extracted into
`src/routes/admin/analytics.js`, preserving overview, funnel, daily event,
per-user read, cache, clamp, and audit-log behavior covered by the existing
analytics suite.
The attribution health route is also folded into the growth/attribution route
module, removing the last inline attribution-health route from `admin.js` while
preserving the existing Apple Ads and download health contract.
Admin gift-ops route ownership is also extracted into
`src/routes/admin/gift-ops.js`, preserving gift overview, order read/detail,
outbox, incident, retry, cancel, overdue-review, manual recovery note, role
gate, audit, and migration-required error contracts.
Admin blog CMS route ownership is also extracted into
`src/routes/admin/blog.js`, preserving blog list/detail/create/update/preview,
autofill, review, repair, publish/unpublish, validation, audit, and public
blog lifecycle behavior.
Admin track-transfer route ownership is also extracted into
`src/routes/admin/track-transfer.js`, preserving superadmin-only transfer,
active-job, soft-deleted-user, audit, share-reset, and verification behavior.
Admin provider/queue control route ownership is also extracted into
`src/routes/admin/provider-queue-control.js`, with new characterization for
admin auth, superadmin mutation gates, status validation, and provider/queue
status mutation envelopes.
Admin STT/music provider config route ownership is also extracted into
`src/routes/admin/provider-config.js`, with new characterization for admin
auth, superadmin mutation gates, validation envelopes, available-provider
response decoration, and STT/music config persistence behavior.
Admin onboarding-sample route ownership is also extracted into
`src/routes/admin/onboarding-samples.js`, with new characterization for admin
auth, superadmin mutation gates, validation envelopes, activate not-found
mapping, and delete behavior.
The public mobile `/app/config` route handler is also moved out of `admin.js`
into `src/routes/client-config.js`, leaving service lifetime and registration
order unchanged while making the non-admin boundary explicit.
Admin blend-analysis diagnostics route ownership is also extracted into
`src/routes/admin/blend-analysis.js`, with new characterization for admin auth,
superadmin path analysis, storage-scope validation, missing input, and missing
track-version behavior.
Admin security config/App Store sync route ownership is also extracted
into `src/routes/admin/security-config.js`, with new characterization for
admin auth, superadmin mutation/sync gates, validation envelopes, readback, and
App Store sync failure mapping.
Admin SPA/static serving is also extracted into
`src/routes/admin/static-ui.js`; Cloudflare Access mode checks remain injected
from `admin.js`, while the static module owns MIME selection, traversal
protection, and SPA fallback behavior.
Admin marketing route ownership is also extracted into
`src/routes/admin/marketing.js`, including email templates, contacts,
contact upload/export, campaigns, cold-email operations, push send, GMass
import, and engagement routes plus marketing-only helper logic.
Admin billing route ownership is also extracted into
`src/routes/admin/billing.js`, including entitlement mutation, complimentary
upgrade/revoke, billing dashboard reads, plan updates, and gift-bundle
management.
Admin-auth route ownership is also extracted into
`src/routes/admin/auth.js`, including setup, login/logout, current-session,
change-password, forgot-password, and reset-password handlers plus the auth
rate-limit helper. `src/routes/admin.js` now has no inline
`app.get/post/put/delete/patch` handlers; it composes route registrars, shared
guards, repositories, and services. Remaining Root 6 work has narrowed to
`admin-service.js` compatibility facade cleanup and constructor composition, not
route-handler extraction.

Admin provider-config service ownership is now extracted into
`src/services/admin/provider-config-service.js`, and
`src/routes/admin/provider-config.js` now calls that service directly instead
of going through `AdminService`. `clientConfigService` composition also reads
STT/music provider config from the provider service directly. The service owns
STT defaults/validation, music-provider config normalization/persistence, and
admin audit emission through an injected audit function. Direct service tests
pin invalid-JSON fallback, update persistence, and audit metadata.
Admin audit-write ownership is now extracted into
`src/services/admin/audit-service.js`; `src/routes/admin/demo-shares.js` and
`src/routes/admin/billing.js` now call that service directly for their audit
writes instead of going through the former `AdminService` audit facade. Gift
operations now do the same for incident acknowledgement, retry, cancel,
overdue-review, and manual-recovery-note audit writes. Blog CMS routes now also
call the audit service directly for create, update, review, repair, publish,
and unpublish audit writes. Marketing routes now also call the audit service
directly for contact upload/export, campaign create/update, push send, results
import, and cold-email manual trigger/update audit writes. `AdminService` now
injects `adminAuditService.audit` directly into child admin services, while the
new service owns audit ID generation, timestamp normalization, admin metadata
enrichment, and `EventsRepository.insertAuditLog` payload construction.
Admin feature-flag service ownership is also extracted into
`src/services/admin/feature-flag-service.js`, and
`src/routes/admin/feature-flags.js` now calls that service directly instead of
going through `AdminService`. The service owns admin cache clearing, grouped
metadata shaping, option decoration, value validation, partial-success update
behavior, and bulk audit emission. Direct service tests pin metadata grouping,
string-option decoration, number coercion-with-original-value persistence,
partial validation errors, cache clearing, and audit metadata.
Admin onboarding-sample service ownership is also extracted into
`src/services/admin/onboarding-sample-service.js`, and
`src/routes/admin/onboarding-samples.js` now calls that service directly instead
of going through `AdminService`. The service owns validation, ID/timestamp
generation, active-sample migration fallback, repository orchestration, and
admin audit emission. Direct service tests pin trimmed create persistence with
raw audit metadata, validation errors, allowlisted updates, missing-sample
errors, activation/delete audit metadata, and active lookup fallback.
Admin security/app-update config service ownership is also extracted into
`src/services/admin/security-config-service.js`, and
`src/routes/admin/security-config.js` now calls that service directly instead
of going through `AdminService`. The service owns default security config
shaping, security-config persistence and audit emission, App Store Connect
ready-version sync, sync-specific audit emission, and public iOS app-update
policy projection. Direct service tests pin default rows, persisted-row JSON
mapping, DB null conversion, generic audit suppression during sync,
auto-recommended version behavior, public non-exposure of sync errors,
optional live lookup error exposure, and no live lookup from the default public
`/app/config` path.
Admin provider/queue control-plane service ownership is also extracted into
`src/services/admin/control-plane-service.js`, and
`src/routes/admin/provider-queue-control.js` now calls that service directly
instead of going through `AdminService`. The service owns provider and queue
status read delegation, timestamp injection for status mutations, route-facing
`{ success: true }` envelopes, and admin audit action naming. Direct service
and repository-integration tests pin list delegation, provider audit metadata,
queue audit metadata, and injected timestamps.
Admin moderation service ownership is also extracted into
`src/services/admin/moderation-service.js`, and
`src/routes/admin/moderation.js` now calls that service directly instead of
going through `AdminService`. The service owns moderation override result
mapping and admin audit emission only for successful blocked-version approvals.
Shared admin limit/offset bounds now live in `src/services/admin/pagination.js`.
Direct service and repository-integration tests pin pagination bounds,
successful override audit metadata, missing-version behavior, non-blocked
behavior, and the no-audit contract for failed override attempts.
Admin job/DLQ operations service ownership is also extracted into
`src/services/admin/job-ops-service.js`, and admin job/DLQ route modules now
call that service directly for job-health metrics, job listing, manual retry,
DLQ listing/reprocess, and step history instead of going through `AdminService`.
The service owns clock-derived job-health windows, bounded job/DLQ listing,
retry/reprocess result mapping, job-step history delegation, and admin audit
emission only for successful mutations. Direct service and
repository-integration tests pin metric windows, pagination bounds, retry
audit/no-audit paths, DLQ reprocess audit/no-audit paths, and step-history
delegation.
Admin user-read service ownership is also extracted into
`src/services/admin/user-read-service.js`, and
`src/routes/admin/users-read.js` now calls that service directly instead of
going through `AdminService`. The service owns pagination bounds, attribution
enrichment/merge, stats conversion-rate formatting, detail fan-out, and
missing-user no-fanout behavior. Direct service tests pin bounded filter
delegation, zero-user conversion formatting, and canonical attribution merge
behavior; repository and route suites continue to pin SQL semantics, auth,
pagination metadata, and 404 envelopes.
Admin user-mutation service ownership is also extracted into
`src/services/admin/user-mutation-service.js`, and
`src/routes/admin/user-mutations.js` now calls that service directly instead
of going through `AdminService`. The service owns risk and lock audit
contracts, fixed one-year lock calculation, audit-before-delete ordering, bulk
action sequencing/summary audit metadata, profile allowlist filtering, and
attribution override before/after audit envelopes. Direct service tests pin
validation-result envelopes, successful and missing-user paths, per-user and
bulk audit ordering, and empty attribution fallback; route suites continue to
pin admin role gates and HTTP envelopes.
Admin entitlement tier-update service ownership is also extracted into
`src/services/admin/entitlements-service.js`, and
`src/routes/admin/billing.js` now calls it directly for admin entitlement
updates instead of going through `AdminService`. The service owns tier allowlist
validation, empty-update envelopes, repository timestamp injection for
missing-row inserts, previous-tier defaulting, and `admin_update_entitlements`
audit metadata. Direct service tests pin invalid tier/no-audit behavior and
existing-row and inserted-row audit contracts; route and subscription suites
continue to pin superadmin gates, unchanged `updated_at` for existing rows,
missing-row insert behavior, and billing entitlement semantics.
Admin billing/revenue read service ownership is also extracted into
`src/services/admin/billing-service.js`, and `src/routes/admin/billing.js` now
calls it directly for revenue metrics, receipt-backed sales, subscription
health, and billing transactions instead of going through `AdminService`. The
service owns receipt-backed product catalog fallback, counted-sale filtering,
sales pagination over counted rows, current-subscriber normalization,
currency-bucket aggregation, mixed-currency scalar fallback, revenue metrics
shaping, subscription-health date windows, and transaction projection. Direct
service tests pin repository delegation, period and pagination bounds, active
subscriber full-count versus preview-list behavior, and receipt money extraction
policy; route and repository suites continue to pin verified-receipt SQL,
strict period filtering,
current subscriber semantics, and subscription-manager entitlement behavior.
Admin analytics service ownership is also extracted into
`src/services/admin/analytics-service.js`, and
`src/routes/admin/analytics.js` now calls that service directly instead of
going through `AdminService`. The service owns per-instance aggregate caching,
days/limit clamping, funnel hop policy, conversion-rate formatting, and
traceable `analytics.user.read` audit metadata. Direct service tests pin cache
hits, exact windows, funnel conversion behavior, user-event limit clamping, and
audit metadata; route and repository suites continue to pin admin auth, SQL
semantics, selected columns, and audit row shape.
Admin growth/attribution service ownership is also extracted into
`src/services/admin/growth-service.js`, and
`src/routes/admin/growth.js` now calls `adminGrowthService` directly for
attribution health/dashboard and Apple Ads keyword-map operations instead of
going through `AdminService`. The service owns attribution health delegation,
UTM share/download merge-and-sort behavior, rate formatting, Apple Ads
keyword-map bounds, keyword-row normalization, and bulk-sync audit metadata.
Direct service tests pin breakdown fan-out, Apple Ads campaign limits,
percentage formatting, keyword-map pagination, invalid-input no-audit behavior,
and row normalization; route/repository suites continue to pin admin auth,
Apple Ads attribution joins, SQL semantics, and producer paths.
Admin user session/voice-control service ownership is also extracted into
`src/services/admin/user-session-control-service.js`, and
`src/routes/admin/user-session-controls.js` now calls that service directly
instead of going through `AdminService`. The service owns voice-profile reverify
result mapping, session revocation timestamps, successful-only audit behavior
for single-session revokes and voice reverify, and revoke-all audit count
metadata. Direct service tests pin force-reverify audit/no-audit paths,
session-list delegation, single-session revoke audit/no-audit paths, and
revoke-all audit metadata.
Admin share-management service ownership is also extracted into
`src/services/admin/share-management-service.js`, and
`src/routes/admin/shares.js` now calls that service directly instead of going
through `AdminService`. The service owns bounded song-share/poem-share listing,
share rebind result mapping, poem-share attempt reset/revoke result mapping, and
admin audit metadata for successful mutations. Direct service tests pin
pagination bounds, share rebind audit/no-audit behavior, poem-share reset/revoke
audit behavior, and missing or already-revoked no-audit paths.
Admin security-observability service ownership is also extracted into
`src/services/admin/security-observability-service.js`, and
`src/routes/admin/security-observability.js` now calls that service directly
instead of going through `AdminService`. The service owns bounded observability
searches, injected-clock date windows, auth/Apple stats normalization, audit
action LIKE escaping, rate-limit reset audit metadata, and consent-log
delegation. Direct service tests pin wildcard escaping, pagination bounds,
date-window construction, stats normalization, reset audit metadata, and
consent-log filters.
Admin music-diagnostics service ownership is also extracted into
`src/services/admin/music-diagnostics-service.js`, and
`src/routes/admin/music-diagnostics.js` now calls that service directly instead
of going through `AdminService`. The service owns bounded recent-track
selection, malformed JSON fallback, provider precedence, provider/status
filtering, latest-job error attachment, and diagnostic response shaping. Direct
service tests pin non-object JSON fallback, pagination bounds, provider
precedence, defaulted quality fields, filtered result behavior, empty repository
results, and latest-job error mapping; route/repository tests still cover the
shared blend-analysis repository path.
Admin story-session service ownership is also extracted into
`src/services/admin/story-session-service.js`, and
`src/routes/admin/story-sessions.js` now calls that service directly instead of
going through `AdminService`. The service owns bounded story-session listing and
detail-read delegation to the admin story-session repository. Direct service
coverage pins pagination bounds and repository delegation; route/repository
tests continue to pin auth, filters, ordering, detail payloads, turn isolation,
and missing-session envelopes.
Admin webhook-health service ownership is also extracted into
`src/services/admin/webhook-health-service.js`, and
`src/routes/admin/webhook-health.js` now calls that service directly instead of
going through `AdminService`. The service owns the 24-hour audit window and
pending-retry placeholder decoration over the admin billing repository. Direct
service coverage pins the time window and response shape; route/repository
tests continue to pin admin auth, webhook type counts, failed-webhook counting,
and old/non-webhook exclusion.
Admin system-health service ownership is also extracted into
`src/services/admin/system-health-service.js`, and
`src/routes/admin/security-observability.js` now calls it directly for the
admin health endpoint instead of going through `AdminService`. The service owns
the 24-hour job/DLQ health window, default operational counters, recent-error
delegation, and checked-at timestamp. Direct service coverage pins the window
and normalized response; security route coverage continues to pin the admin
health endpoint contract.
Admin metrics service ownership is also extracted into
`src/services/admin/metrics-service.js`, and
`src/routes/admin/metrics.js` now calls it directly for overview, cost,
enrollment, render-pipeline, and risk metrics instead of going through
`AdminService`; `src/routes/admin/growth.js` also calls it directly for teaser
and share metrics. The service owns overview/cost/enrollment/render/risk/
teaser/share metric windows, growth rate formatting, and risk escalation
metadata parsing. Direct service coverage pins deterministic date windows,
malformed risk metadata fallback, and teaser/share rate formatting; repository
and route suites continue to pin aggregate semantics, admin auth, and response
contracts.
**Boundary:** Do the `getAppConfig` eviction + non-billing splits first (🟡). Do the billing/entitlement admin slice **last** (⚠ 🔴) with production verification.

### Root 7 — Writer cycle + god-file decomposition 🟡 effort M

**Closes:** D2 (writer), the songwriter↔v3 cycle.
**Scope:** Break the circular dep by extracting `validateSongContract` + contract types into a leaf `writer/contracts.js` (both sides depend on the leaf; the lazy require disappears). Split `quality.js` into `quality/song-gaps.js` + `quality/poem-readiness.js`. Extract `resolveTurnDecision` + narrative-repair out of `v3/index.js`. Consolidate `splitSentences`/`factText` duplicates.
**Status 2026-06-29:** Completed. Code-first slices:
`songwriter/prompt-budget.js`, `songwriter/text-normalization.js`,
`songwriter/prompt-serialization.js`, `song-contract.js`,
`v3/quality/poem-readiness.js`, `v3/quality/question-targeting.js`,
`v3/quality/labov-gap-analysis.js`, `v3/quality/slot-gap-model.js`,
`v3/quality/story-gap-analysis.js`, `v3/quality/story-elements.js`,
`v3/semantic-story-package.js`, `v3/runtime-questions.js`,
`v3/ready-confirmation.js`, `v3/turn-decision.js`, shared V3
`splitSentences` in `v3/utils.js`, and shared writer `factText` through
`story-semantics.js`. The songwriter↔v3
contract-validation cycle is now gone; `v3/index.js` imports contract validation
from the leaf module instead of lazy-requiring `songwriter.js`; deterministic
semantic story package repair, runtime question helpers, and ready-confirmation
text are also out of the god file, and `resolveTurnDecision` now lives in
`v3/turn-decision.js` with its canonical result assembler. Legacy slot-gap
policy, story gap analysis, and story element scoring are now out of
`quality.js`, leaving it as a 650-line compatibility facade over leaf modules.
Focused V3/writer validation and lint passed for each slice. The final
test-parity pass added direct coverage for the extracted contract sanitizer and
validation helpers, runtime question guards, ready-confirmation text, V3 text
utilities, and shared `factText` behavior. A follow-up code-first slice moved
LLM input normalization and lyrics draft / section serialization out of
`songwriter.js` while keeping provider invocation and generation orchestration
in the live lyrics layer. Cleanup review found no remaining Root 7 lazy
songwriter/v3 imports or Root 7 TODO/FIXME leftovers.
**Boundary:** Do NOT alter LLM prompts or generation behavior — structural extraction only, with golden-output regression tests before/after.

---

## TIER 3 — Cleanup & hygiene (cheap, do alongside or last)

### Root 8 — Dead-code & duplication sweep 🟢 effort S

**Closes:** D3 (remaining dups), simplification ask.
**Scope:** Defer `src/database/migrations/` and `src/db.js` until the test harness stops importing them. Strip stray `console.log` debug instrumentation from production handlers (tracks.js render_preview, etc.).
**Status 2026-06-29:** Completed for the current dead-code/duplication sweep. Deleted unimported `src/writer/v3/safety.js` and `src/writer/v3/monitor.js` after targeted import/export-name grep found zero live callers. Deleted `src/writer/v2/CLAUDE.md`, removing the otherwise empty legacy V2 writer directory after targeted import search found no live callers. Removed `src/providers/lyrics.js` by inlining runtime callers to `writer/songwriter.js`; the lyrics test imports the canonical module directly. Centralized duplicated `getFFmpegPath` callers in HLS, watermark, and blend analysis onto `utils/ffmpeg.js`, and centralized duplicated `ensureDir` helpers onto `utils/common.js`. Moved enrollment QC policy to `src/services/enrollment-qc.js` and render step classification to `src/workflows/step-classification.js`. Removed the vestigial exact `E302_SEEDVC_ERROR: GPU task aborted` retry check; normalized `provider_error:gpu_abort` remains the transient provider path. Stripped low-value `render_preview` request/job debug logs from `src/routes/tracks.js`. `src/db.js` remains production-dead but test-live and is deferred to later test-harness convergence; the abandoned `src/database/migrations/` consolidation was deleted in Root 9 after tests moved to the live migration runner. Final Root 8 review found no live imports of the removed modules/shims and no empty writer/provider directories.
**Boundary:** Delete only what is proven dead in both runtime and validation paths (each deletion verified by `tldr impact` / grep showing zero live callers and by the relevant tests). If a file is production-dead but test-live, first migrate the tests or keep the file. Build green after each removal. `git log` is the resurrection store.

### Root 9 — Migration-location convergence 🟡 effort S–M

**Closes:** D6 (test-fidelity hazard).
**Scope:** Reconcile the 12 remaining divergent migration filenames between `migrations/` (SQLite) and `migrations/pg/` (9 SQLite-only, 3 Postgres-only); keep `npm run verify:migrations` passing as the filename drift gate.
**Status 2026-06-29:** Completed for the current convergence pass. Added `tools/verify-migration-parity.js` and `npm run verify:migrations`, with an exact allowlist for reviewed filename drift. Migrated tests off the production-dead `src/database/migrations/` consolidation to the live `src/database/postgres.js` migration runner, then deleted the abandoned runner and SQL folder. Added SQLite mirrors for the non-destructive Postgres-only letterbox flags and viral-loop metrics view. Added current-numbered Postgres migration `122_migration_parity_backfill.sql` to backfill the additive schema/flag effects of the historical SQLite-only voice, OneSignal, download-attribution, and job-step-history migrations without introducing low-number PG migrations that would run before the 088 repair migration in drifted environments. Removed the last source/test dependencies on retired `billing_holds`, `credits_balance`, and `credits_used_total`, then added paired migration `123_drop_sqlite_legacy_billing_artifacts.sql` so fresh SQLite schemas now match the production cleanup from PG 094/095 without introducing old low-number destructive local migrations. Remaining filename divergence is intentionally documented and guarded: 9 historical SQLite-only filenames whose additive PG effects are covered by 122, plus 3 intentionally PG-only historical filenames (`088` repair, `094`/`095` cleanup covered for SQLite by 123). Current verification passed with `npm run verify:migrations` and the migration runner/schema suites.
**Boundary:** ⚠ Touches schema tooling. Per the migration-safety rule: compare local vs prod schema first, confirm non-destructive, never auto-apply a data-wiping migration. Document each divergence's intent before deleting.

### Root 10 — Storage interface parity + OpenAPI ✅ completed 2026-06-29

**Closes:** storage drift, D5/C2 (API discoverability).
**Scope:** Add `listKeys` + `verifyPresignedRequest` (or an explicit `type`-branch contract) to the S3 adapter so it matches local; standardize Fastify `{schema}` validation across endpoints and emit OpenAPI via `@fastify/swagger` as the single discoverable contract.
**Boundary:** OpenAPI is additive (no wire change). S3 parity is needed before any real S3 cutover.
**Status 2026-06-29:** Completed. Storage parity: S3 now exposes `listKeys` by paging through `listObjects` and fails closed on truncated pages without a continuation token. `verifyPresignedRequest` is intentionally not added to S3 because `/storage/upload` is local-dev only and returns 404 for S3 storage before signature verification; production S3/R2 uploads are verified by the object store against the generated SigV4 URL. API discoverability: `/openapi.json` is now generated at runtime through `@fastify/swagger@8.15.0` from the Fastify route registry, with a public/API filter that excludes admin, internal, debug, webhook, and marketing-page routes while keeping core mobile/API/discovery paths. Static `public/openapi.json` remains only as a fallback if runtime generation is unavailable.

---

## TIER 4 — Cross-surface (delayed, but required for whole-codebase completion)

### Root 11 — Create-flow contract alignment + SwiftUI state ownership 🟠 effort L _(delayed, but in full whole-codebase scope)_

**Raised by Codex.** The first map was backend-only (`src/**`). But the user goal is whole-codebase architecture, and the **story→track create flow is a contract that spans backend ↔ iOS**, with admin and web-player also depending on backend contracts. The SwiftUI side has its own god-files (`RootView.swift`, `WarmCanvasFlowView`, `GiftSendFlowView`, controllers). You cannot fully "consolidate the create flow" touching one side only.
**Scope:** Align backend story/create contracts with SwiftUI create-flow state (WarmCanvas, gifts, poems, render handoff). Refactor SwiftUI around native state boundaries (`.sheet(item:)`/`.fullScreenCover(item:)`), preview matrices, accessibility checks, simulator validation. Introduce typed admin API contracts + page-level hooks (React reducer/context) for the admin UI; keep web-player changes contract-driven (recipient share behavior is product-critical).
**Why delayed:** It expands blast radius to iOS + admin + web-player and pulls in the `porizo-swiftui-release-workflow` + simulator-testing skills. It is the natural _follow-on_ once backend contracts are stabilized (Roots 1–7), not a prerequisite. If execution is intentionally backend-only, this root can be split into a separate program, but then the original whole-codebase goal is not complete.
**Boundary:** Do NOT start before backend contracts are stable (Codex's P2-INFERRED: "admin/web-player cleanup should follow backend contract stabilization, not lead it"). Gate every cross-surface change on the create-flow contract tests from G1.

**Status 2026-06-29:** First Root 11 slice implemented. Backend create/render contracts were re-verified, SwiftUI create/gift/upgrade presentations now carry selected payloads through `.fullScreenCover(item:)`, `.sheet(item:)`, or typed `ActiveSheet` associated values, and gift-funded story/create persistence now writes canonical `funding_source = 'gift_wallet'` for tracks and poems. Legacy `gift_token` rows remain readable in render and library paths. PostgreSQL repair/parity now covers poem funding-source constraints as well as tracks.

**Remaining Root 11 scope:** typed admin API contracts + page-level reducer/context cleanup, web-player recipient/share contract audit, iOS preview/accessibility matrices, and simulator flow recording for create/gift/share paths.

---

## Recommended execution sequence (if you green-light execution later)

> **Root 0:** explicit baseline. Before any refactor, reconcile architecture docs, define validation gates, and write/confirm the first set of golden contract tests. Per G1, each later root still adds the root-specific tests before moving code.

```
Phase 0 (safety baseline):
  Root 0  (map + contract harness) ← no refactor; no unverified "green" claims
  C1      (auth revocation patch) ⚠ ← implemented locally; prod verification pending

Phase A (foundation):
  Root 3a (server.js bootstrap)    ← implemented locally for HTTP/share/schema; startup wiring remains
  Root 1  (repository layer)       ← keystone; first behavior-bearing architecture root
  Root 4  (provider strategy)      ← removes render-failure risk

Phase B (correctness, gated):
  Root 2  (auth + rate-limit)  ⚠   ← production-verified; should find C1 already closed
  C2      (error-envelope docs)    ← completed in Root 0; later OpenAPI reflects it

Phase C (god-file decomposition, behind contract tests + per-root cleanup):
  Root 3b (gift subsystem)     ⚠   ← the risky half of server.js
  Root 5  (runner step registry)   ← needs Root 1 done first
  Root 6  (admin split; billing last ⚠)
  Root 7  (writer cycle + split)

Phase D (hygiene):
  Root 9  (migration convergence) ⚠
  Root 10 (storage parity + OpenAPI)
  Root 8  (final dead-code sweep)  ← catch cross-root drift

Phase E (cross-surface — required for whole-codebase completion, delayed for safety):
  Root 11 (create-flow + SwiftUI state)
```

Each root is one pass of the loop: **write contract tests (G1)** → implement → specialist/adversarial review → fix wave → re-review until zero-P0/P1 → **per-root cleanup (G2)** → commit. Revenue-path roots (⚠) additionally require production verification before "done." After all roots: write the **empirical-validation doc** enumerating what code review can't prove (provider behavior under failure, real-device create flow, migration under load) with concrete test scenarios.

---

## Remaining decisions before later roots

1. **Order/selection:** accept the corrected sequence (Phase 0 through Phase E), or re-prioritize?
2. **C1 production verification:** run/approve production verification that revoking a session immediately 401s a money endpoint.
3. **Scope — Root 11 (iOS/admin/web-player):** execute as part of the whole-codebase goal after backend contracts stabilize, or split it into a later program and call this one backend-only?
4. **Branch strategy:** one branch per root (recommended — each ships independently), or one long-lived `refactor/architecture` branch?
5. **Test gate:** re-run the relevant hermetic suite before execution and record the actual pass/block counts in Root 0. Confirm that **G1 characterization tests** get added per-root before refactoring.
