# Implement Scheduled Gift Ops Hardening And Admin Management

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this work, scheduled gifts should behave like an operationally trustworthy delivery system instead of a best-effort feature. A sender should be able to create a gift, schedule it, trust that it will be sent on time, and know that failures are visible and recoverable. An operator should be able to open the admin dashboard and answer four concrete questions without using SQL or raw logs:

1. What gifts are due soon or overdue?
2. Which gifts are failing or partially failing, and why?
3. What happened to a specific gift send?
4. Can I safely retry, cancel, or manually recover a gift?

This plan implements the seven remaining hardening items already identified during the production review and adds a real admin/ops surface for scheduled gifts. The user-visible result is a more reliable schedule-and-send pipeline plus a dashboard tool that exposes queue state, delivery state, timing, failures, and recovery actions.

## Progress

- [x] (2026-04-10 10:05 AWST) Reviewed the current gift backend, dispatch worker, previous gift ExecPlans, and the existing admin dashboard structure.
- [x] (2026-04-10 10:10 AWST) Wrote a comprehensive implementation plan that covers the seven hardening items plus admin dashboard visibility and operator actions.
- [x] (2026-04-10 10:20 AWST) Performed an adversarial review of the plan against edge cases: duplicate provider callbacks, stale locks, partial delivery, PII exposure, role misuse, and timezone drift.
- [x] (2026-04-10 16:40 AWST) Implemented backend observability: structured lifecycle logs, finalize integrity checks, dispatch lag metrics, dead-man overdue checks, and non-fatal share-pre-generation alerting.
- [x] (2026-04-10 16:55 AWST) Implemented provider receipt ingestion and persistence for SMS and email delivery outcomes, including webhook authenticity checks.
- [x] (2026-04-10 17:20 AWST) Added render-ready share-preflight validation and regression tests for query-only adapters and operator-visible share-pre-generation incidents.
- [x] (2026-04-10 17:30 AWST) Added admin API routes for gift queue, detail, outbox, incidents, retries, cancellations, incident acknowledgement, and manual recovery notes.
- [x] (2026-04-10 17:50 AWST) Added admin dashboard pages and navigation for scheduled gifts and schedule/send incidents, and widened detail visibility for operator triage.
- [x] (2026-04-10 18:05 AWST) Added targeted tests, completed full-repo validation, and tightened rollout behavior when observability schema is missing.

## Surprises & Discoveries

- Observation: the backend foundation is already split into the right broad seams, but there is still no operator-facing entry point for gift delivery.
  Evidence: `src/routes/gifts.js` and `src/jobs/gift-dispatch.js` own lifecycle and dispatch, while `src/routes/admin.js` currently exposes gift bundles only and nothing for scheduled gift operations.

- Observation: the two existing gift ExecPlans stop exactly where ops visibility should start.
  Evidence: `docs/plans/gift-scheduling-hardening-execplan.md` ends with Phase 4 “Sender and Ops Recovery UX,” and `docs/plans/gift-flow-ux-hardening-execplan.md` focuses only on the sender app flow.

- Observation: the admin app already has good page and data-loading patterns that can be reused for gift operations.
  Evidence: `admin/src/hooks/useApi.ts`, `admin/src/pages/Jobs.tsx`, `admin/src/pages/Shares.tsx`, and `admin/src/pages/Billing.tsx` already establish how list/detail, filters, refresh, and action buttons are implemented.

- Observation: the original plan under-specified several operator and security edge cases that would create a brittle implementation if left implicit.
  Evidence: the first draft did not explicitly define how to handle duplicate or out-of-order provider callbacks, timezone and DST correctness for “due soon” and “overdue”, role restrictions for destructive admin actions, or privacy rules for exposing recipient phone/email details in the dashboard.

## Decision Log

- Decision: treat the seven hardening items and the admin dashboard exposure as one coordinated implementation slice instead of separate follow-up tasks.
  Rationale: queue visibility, retries, and diagnostics are not optional garnish. They are the operator-facing half of the hardening work.
  Date/Author: 2026-04-10 / Codex

- Decision: build the admin gift-ops surface as a dedicated top-level page, not as a sub-tab under Billing.
  Rationale: billing answers “how gift tokens are sold,” while gift ops answers “what scheduled deliveries are doing right now.” These are operationally different concerns and should not be buried under bundle configuration.
  Date/Author: 2026-04-10 / Codex

- Decision: preserve the current durable outbox model and extend it rather than replacing it with a new queue abstraction in this slice.
  Rationale: the outbox is now the truth for per-channel gift delivery. The next work should instrument and expose it, not destabilize it.
  Date/Author: 2026-04-10 / Codex

- Decision: treat provider acceptance and handset/mailbox delivery as different states in both storage and UI.
  Rationale: the production review already showed that current instrumentation proves provider acceptance, not final user receipt. The admin tool must expose that distinction instead of flattening it.
  Date/Author: 2026-04-10 / Codex

- Decision: explicitly design the admin and webhook work against adversarial edge cases instead of letting implementation infer the right behavior.
  Rationale: schedule-and-send is a state machine that degrades badly when duplicate callbacks, stale locks, timezone drift, and operator misuse are not specified up front.
  Date/Author: 2026-04-10 / Codex

## Outcomes & Retrospective

Implementation outcome:

- the scheduled gift pipeline now records finalize integrity, dispatch timing, overdue state, receipt state, and non-fatal share-pre-generation failures as durable operational data,
- the admin dashboard now has a dedicated scheduled-gifts ops page with overview, orders, incidents, and detail inspection,
- superadmins can retry, cancel, acknowledge incidents, and leave recovery notes while viewer/admin roles remain read-only for gift ops,
- missing observability migrations now fail with an explicit `GIFT_OPS_MIGRATION_REQUIRED` response instead of misleading empty dashboards,
- targeted regressions now cover query-only share pre-generation, receipt idempotency ordering behavior, unknown receipt incidents, incident acknowledgement, and viewer-role access boundaries.

Residual limits remain:

- provider receipts still prove provider-side state, not guaranteed handset/mailbox delivery,
- dispatch still runs from the API process rather than a dedicated worker/workflow,
- the admin UI is now operationally useful, but not yet a full workflow console with bulk actions or deep receipt drill-down.

## Context and Orientation

The scheduled gift system is split across four main backend seams and one admin frontend seam.

The sender-facing lifecycle is implemented in `src/routes/gifts.js`. This file owns reservation creation, attaching created content to a reservation, finalizing the gift order, editing scheduled gifts, and cancellation.

Dispatch scheduling is handled by `src/jobs/gift-dispatch.js`. This is a polling job that finds due gifts and calls the dispatch callback. It already recovers stale `dispatching` orders and stale `sending` outbox rows.

The actual delivery path lives in `src/server.js`. That file owns helper functions such as `renderGiftSummary`, `createGiftDeliveryOutboxRows`, `dispatchGiftById`, and the provider send branches for SMS and email. It also holds the share-token binding logic used by gifting.

The admin API lives in `src/routes/admin.js`. It already has session auth, audit logging, and page-specific data routes for jobs, shares, billing, marketing, and blog publishing. It does not yet have any scheduled-gift operations endpoints beyond gift bundle configuration.

The admin frontend lives under `admin/src/`. Navigation is controlled by `admin/src/App.tsx` and `admin/src/components/Sidebar.tsx`. API access is centralized in `admin/src/hooks/useApi.ts`. Existing pages such as `admin/src/pages/Jobs.tsx` and `admin/src/pages/Shares.tsx` are the right structural templates for a scheduled-gifts operations page.

The term “delivery outbox row” means one persisted row in the database representing one pending or completed send on one channel, such as one SMS or one email for one gift order. The outbox is the durable truth for send work. The term “dead-man check” means a recurring safety query that finds gifts which should have moved forward but did not, for example gifts that are overdue with no successful send row. The term “share pre-generation” means the background creation or healing of a share token during render completion so later share flows do not fail lazily.

This plan builds directly on the completed work described in:

- `docs/plans/gift-scheduling-hardening-execplan.md`
- `docs/plans/gift-flow-ux-hardening-execplan.md`

## The Seven Hardening Items

This plan treats the previously identified seven items as fixed requirements:

1. Add explicit structured logs around finalize and dispatch.
2. Add a post-finalize integrity check.
3. Add dispatch lag metrics.
4. Add a dead-man check for due gifts.
5. Add provider receipt ingestion so provider acceptance and downstream delivery state are visible.
6. Add a render-ready share-preflight test.
7. Add alerting for non-fatal render-completion errors.

The admin dashboard work in this plan is the operational interface for those seven items, not a separate optional project.

## Adversarial Review Findings

This section captures the hostile review of the plan. The implementation must explicitly handle these cases.

Time and scheduling edge cases:

- A gift scheduled near a daylight-saving boundary must not appear overdue or due-early because the dashboard mixed sender timezone and server UTC.
- “Due soon” and “overdue” calculations must be based on persisted UTC timestamps, while the dashboard may render local timezone labels separately.
- Immediate gifts and scheduled gifts must share the same observability model so operators do not lose visibility just because `send_at` is effectively “now”.

Provider and webhook edge cases:

- The same provider callback can arrive multiple times.
- Provider callbacks can arrive out of order, for example `delivered` before a delayed `sent`.
- Provider callbacks can arrive after the gift was manually cancelled or after terminal failure was already declared.
- A callback may reference an unknown or already-deleted provider message ID.
- Webhook endpoints must be authenticated and bounded, not public write APIs.

State-machine and retry edge cases:

- Stale `dispatching` or `sending` rows must not create duplicate operator incidents on every tick.
- A manually retried gift must not requeue channels that already reached a terminal success state.
- A cancelled gift must not be silently reactivated by a retry button, a delayed callback, or a stale worker tick.
- Partial delivery must remain distinguishable from total failure all the way through admin UI and audit history.
- Backfill or migration code for existing gifts must not create duplicate outbox rows or duplicate incidents.

Admin misuse and privacy edge cases:

- Not every admin should be allowed to cancel or retry gifts. Read-only visibility and destructive actions need separate permissions.
- Operator notes and acknowledgements must be audited with admin identity and timestamp.
- Recipient phone numbers, emails, share URLs, claim PINs, and provider payloads are sensitive and should be partially redacted by default in admin list views.
- Manual recovery tools must not expose enough data to let an admin casually bypass the intended claim security model.

Rollout and failure-mode edge cases:

- The new observability tables and routes must degrade safely if a migration has not yet been applied in one environment.
- Alerting must not become noisy enough that operators ignore it.
- Read-only dashboard visibility should remain deployable even if mutation routes need to stay behind a feature flag temporarily.

## Plan of Work

The work is divided into six milestones. Each milestone is intentionally small enough to validate before moving on, but together they complete the full operator-grade schedule-and-send system.

### Milestone 1: Instrument the lifecycle so gift events are explainable

Update `src/routes/gifts.js`, `src/server.js`, and `src/jobs/gift-dispatch.js` to emit structured logs at the major lifecycle boundaries:

- reservation finalized,
- gift order created,
- outbox rows seeded,
- dispatch tick picked up gift,
- each channel send started,
- each channel send accepted,
- each channel send failed,
- gift aggregate status updated,
- retry scheduled,
- permanent failure declared,
- cancellation or manual recovery action taken.

Each log line must include stable identifiers:

- `gift_id`
- `reservation_id` if present
- `share_token_id`
- `outbox_id`
- `channel`
- `send_at`
- `dispatch_started_at`
- `provider_message_id` if present
- `attempt_count`

This milestone also adds an explicit post-finalize integrity check in `src/routes/gifts.js`. After the transaction succeeds, the code should verify that:

- the `gift_orders` row exists,
- the share token is present and bound to the gift,
- the outbox rows exist for every requested channel,
- the share token dispatch timestamps match the gift schedule.

If the check fails, finalize must return a server error, write a high-severity operational log entry, and never silently claim success.

The instrumentation must also be privacy-aware:

- list and summary logs should redact recipient phone/email,
- share URLs and claim PINs must never be emitted in cleartext logs,
- operator actions must log actor identity and mutation intent, not sensitive payload copies.

### Milestone 2: Persist delivery timing and overdue state as first-class data

Add or extend schema so dispatch lag and overdue diagnostics are queryable without reconstructing them from raw timestamps. This likely belongs in a new additive migration, for example `migrations/084_gift_ops_observability.sql` and the Postgres counterpart.

The schema additions should include fields or derived storage for:

- `first_queued_at`
- `first_dispatch_started_at`
- `last_dispatch_completed_at`
- `last_successful_delivery_at`
- `delivery_lag_ms` or enough timestamps to compute it cheaply
- `overdue_detected_at`
- `receipt_status` and `receipt_updated_at` per outbox row
- `alert_state` for unresolved operational anomalies

In `src/jobs/gift-dispatch.js`, add a dead-man check that marks gifts overdue when:

- `status` is still `scheduled` or `dispatch_retry`,
- `COALESCE(next_retry_at, send_at)` is sufficiently in the past,
- and no outbox row has succeeded.

That check should not deliver or mutate business state beyond marking the anomaly. Its job is to make the issue visible and alertable.

This milestone must also define one canonical calculation for:

- `due_soon`
- `overdue`
- `dispatch_lag_ms`

Those calculations must use stored UTC timestamps only. The admin UI may format times in local timezone, but classification logic must stay server-side and timezone-agnostic.

### Milestone 3: Capture provider receipts and make send state trustworthy

Extend the delivery model so provider acceptance is not the last word.

For SMS and email, add receipt ingestion endpoints and persistence:

- Twilio status callback route in `src/server.js` or a dedicated route module
- Resend or email-provider event route in the appropriate email/webhook area

Persist normalized receipt state onto `gift_delivery_outbox`, for example:

- `accepted`
- `sent`
- `delivered`
- `undelivered`
- `bounced`
- `complained`
- `failed`

Store provider payload excerpts in a safe JSON field for forensic visibility, but keep payload size bounded and avoid storing unnecessary personal data. The admin surface should show the normalized status and a compact provider detail summary, not raw webhook dumps by default.

Receipt ingestion must also define conflict resolution rules:

- duplicate callbacks are idempotent,
- later terminal states can advance state but older callbacks must not roll state backward,
- callbacks for unknown provider message IDs create an operator-visible incident instead of failing silently,
- callbacks received after cancellation are recorded for diagnostics but must not resurrect delivery work.

This milestone also adds alerting for non-fatal render-completion errors. The known example is share pre-generation. Non-fatal must no longer mean invisible. If the render worker logs a share-pre-generation failure, it must also create an operator-visible incident record or at minimum a durable alert row tied to the affected track/poem/gift.

Webhook security is part of this milestone. SMS and email receipt routes must enforce provider authenticity, for example signature verification or shared-secret validation, and must reject unauthenticated payloads loudly.

### Milestone 4: Add share-preflight coverage so failures are caught before release

Add targeted tests that exercise the render-ready path and gift finalize path with the same DB adapter shapes production uses. The earlier production failure came from a DB adapter mismatch in share pre-generation, so this milestone must specifically prevent that class of regression.

Update or add:

- `test/share-service.test.js`
- `test/render-endpoints.test.js`
- `test/gifts.test.js`

The tests must prove:

- render-ready share pre-generation works with both `prepare()` and `query()` style adapters,
- finalize integrity checks pass when all required rows exist,
- finalize integrity checks fail loudly when share or outbox rows are missing,
- overdue/dead-man checks flag the right gifts,
- receipt ingestion updates the right outbox rows and gift aggregate status,
- non-fatal share-pre-generation errors create operator-visible incidents.

Add adversarial tests for:

- duplicate receipt webhook delivery,
- out-of-order receipt webhook delivery,
- retry pressed twice,
- retry attempted after cancellation,
- overdue detection around timezone and day-boundary edges,
- migration/backfill idempotency for existing gifts,
- read-only admin users denied destructive actions.

### Milestone 5: Add admin API routes for scheduled gift operations

Extend `src/routes/admin.js` with a dedicated scheduled-gifts operations namespace. Use `requireAdminSession` and audit every mutation. The minimum route set should be:

- `GET /admin/dashboard/gifts/overview`
  Returns counts for scheduled, due soon, overdue, dispatching, partially delivered, failed, cancelled, and recently sent gifts.

- `GET /admin/dashboard/gifts/orders`
  Returns paginated gift orders with filters for status, channel, delivery mode, overdue state, recipient, creator, and date window.

- `GET /admin/dashboard/gifts/orders/:id`
  Returns one gift order with summary, outbox rows, provider receipt state, dispatch timings, share token state, audit trail excerpts, and last error.

- `GET /admin/dashboard/gifts/outbox`
  Returns paginated per-channel delivery rows with filters for status, receipt state, provider, attempt count, and overdue state.

- `POST /admin/dashboard/gifts/orders/:id/retry`
  Safely requeues retryable unsent outbox rows.

- `POST /admin/dashboard/gifts/orders/:id/cancel`
  Cancels a scheduled gift if still legally cancellable.

- `POST /admin/dashboard/gifts/orders/:id/mark-overdue-reviewed`
  Lets an operator acknowledge an overdue incident without changing send state.

- `POST /admin/dashboard/gifts/orders/:id/manual-recovery-note`
  Adds an audit note recording what human intervention was taken.

- `GET /admin/dashboard/gifts/incidents`
  Returns unresolved anomalies such as overdue gifts, share-pre-generation failures, receipt failures, and stuck dispatch rows.

Use read-focused SQL in small helpers or a dedicated admin gift service rather than embedding large unreadable queries inline in the route file. If route complexity grows, create `src/services/admin-gift-ops-service.js`.

The admin route layer must also enforce:

- role separation between read-only visibility and destructive actions such as retry and cancel,
- bounded filtering and pagination so one wide-open dashboard query cannot degrade the live database,
- redaction of sensitive fields in list endpoints,
- explicit field expansion rules for detail endpoints so sensitive fields are exposed only where necessary.

### Milestone 6: Add admin dashboard pages and operator workflows

Add a new top-level admin page, for example `admin/src/pages/Gifts.tsx`, and wire it into:

- `admin/src/App.tsx`
- `admin/src/components/Sidebar.tsx`

This page should not be a vague report. It should be a real operator tool with three visible sections:

1. Overview cards
   Show counts for due soon, overdue, retrying, partial delivery, failed, and sent in the last 24 hours.

2. Orders table
   Show gift title, content type, sender, recipient, scheduled time, current aggregate state, lag, channel mix, and last error summary. Support filtering and refresh.

3. Detail drawer or detail panel
   Show per-channel outbox rows, receipt state, provider message IDs, dispatch timestamps, share URL state, claim policy, manual notes, and recovery actions.

Also add an incidents-focused panel or subpage for unresolved anomalies. This is where the non-fatal render/share incidents and overdue gifts should appear.

The admin UI must handle sensitive data carefully:

- list rows should show masked recipient contact details by default,
- detail view may expose fuller values only when necessary for support work,
- claim PINs should not be shown as a casual dashboard field,
- destructive buttons must have confirmation and clear eligibility rules,
- the UI must explain when a gift is partially delivered so operators do not take actions that contradict already-sent channels.

The page should follow the patterns already used in:

- `admin/src/pages/Jobs.tsx`
- `admin/src/pages/Shares.tsx`
- `admin/src/pages/Billing.tsx`

Do not build a second API client. Reuse `admin/src/hooks/useApi.ts`.

## Concrete Steps

Work from the repository root.

1. Create the new ExecPlan file and keep it updated as work proceeds.

       docs/plans/2026-04-10-scheduled-gift-ops-and-admin-execplan.md

2. Add additive migrations for observability and receipt state.

       migrations/084_gift_ops_observability.sql
       migrations/pg/084_gift_ops_observability.sql

3. Update backend gift lifecycle and dispatch code.

       src/routes/gifts.js
       src/jobs/gift-dispatch.js
       src/server.js

4. Add admin gift service if route complexity warrants it.

       src/services/admin-gift-ops-service.js

5. Extend admin routes.

       src/routes/admin.js

6. Add admin frontend pages and navigation.

       admin/src/App.tsx
       admin/src/components/Sidebar.tsx
       admin/src/pages/Gifts.tsx
       admin/src/pages/gifts/GiftOverviewCards.tsx
       admin/src/pages/gifts/GiftOrdersTable.tsx
       admin/src/pages/gifts/GiftOrderDetail.tsx
       admin/src/pages/gifts/GiftIncidentsPanel.tsx

7. Add or update tests.

       test/gifts.test.js
       test/share-service.test.js
       test/render-endpoints.test.js
       test/admin-gift-ops-routes.test.js
       test/webhook-security.test.js

8. Run validation.

       npm run lint
       npm test
       cd admin && npm run lint
       cd admin && npm run build

Expected end-state transcript:

       npm run lint
       ... no errors ...

       npm test
       ... 0 fail ...

       cd admin && npm run lint
       ... no errors ...

       cd admin && npm run build
       ... build succeeds ...

The exact number of passing tests may increase as new test files are added. The non-negotiable acceptance criterion is zero failures.

## Validation and Acceptance

Acceptance is user-visible and operator-visible behavior, not just code presence.

Sender-side acceptance:

1. A sender can schedule a song or poem gift and the gift is still created through the hardened outbox-backed pipeline.
2. If the gift becomes overdue or partially fails, the sender flow is not lied to; the backend records the anomaly instead of silently losing it.

Operator acceptance:

1. An admin can open the dashboard and see all scheduled gifts, due-soon gifts, overdue gifts, and failed or partially failed gifts.
2. An admin can search for a specific gift order and inspect channel-by-channel delivery state.
3. An admin can see whether the provider only accepted the send or whether a downstream receipt marked it delivered or failed.
4. An admin can retry a retryable gift, cancel a cancellable gift, and add an operator note.
5. A non-fatal share-pre-generation failure appears in the incidents surface instead of only in logs.
6. A dead-man check surfaces gifts that are late with no successful send row.
7. A read-only admin can inspect gifts but cannot retry or cancel them.
8. The dashboard shows masked recipient details by default and does not casually expose claim PINs or raw provider payloads.

Test acceptance:

- `test/gifts.test.js` proves overdue detection, finalize integrity checks, and retry behavior.
- `test/share-service.test.js` and `test/render-endpoints.test.js` prove render-ready share-preflight safety.
- `test/admin-gift-ops-routes.test.js` proves admin list/detail/action routes and auth rules.
- `test/webhook-security.test.js` or equivalent coverage proves receipt webhooks reject unauthenticated payloads.
- Full repo lint and tests pass.
- Admin lint and build pass.

## Idempotence and Recovery

All schema changes in this plan must be additive and safe to rerun through the migration runner.

Admin retry actions must be idempotent at the business level. Pressing retry twice should not create duplicate send work; it should only requeue eligible unsent outbox rows once.

Receipt ingestion must be safe against duplicate webhooks. The same provider callback can arrive multiple times and must update the same outbox row without creating duplicate history records or flipping terminal state backward.

Out-of-order receipt events must be safe. If a later webhook reports an earlier state, the system must preserve the strongest known terminal state instead of regressing it.

The dead-man check must be repeatable. Running it on every dispatch tick must not flood the system with duplicate incidents. Use stable incident keys or an acknowledgement model.

Admin cancellation and retry must respect current state. A cancelled gift cannot become active again through a stale retry path, and a gift with already-sent channels cannot be treated like a clean unsent retry.

If rollout reveals unexpected noise, the safe fallback is:

- disable admin mutation buttons behind a feature flag or temporary server-side guard,
- keep read-only observability routes enabled,
- do not remove the underlying outbox or finalize hardening already shipped.

If migrations are only partially deployed in one environment, read routes should fail loudly with a clear operator-facing message rather than returning misleading empty dashboards.

## Artifacts and Notes

Important existing files to read before implementation:

- `src/routes/gifts.js`
- `src/jobs/gift-dispatch.js`
- `src/server.js`
- `src/routes/admin.js`
- `admin/src/hooks/useApi.ts`
- `admin/src/pages/Jobs.tsx`
- `admin/src/pages/Shares.tsx`
- `docs/plans/gift-scheduling-hardening-execplan.md`
- `docs/plans/gift-flow-ux-hardening-execplan.md`

Key production behavior already observed and worth preserving:

- scheduled dispatch lag was low, around four seconds from `send_at` to successful provider handoff in the reviewed production run,
- the current durable outbox model already prevents several classes of orphan and duplicate-finalize failure,
- the main remaining operational gaps are observability, provider receipts, and human recovery surfaces.

Important implementation constraint from the hostile review:

- never let admin convenience collapse the claim-security model; support staff may inspect and recover delivery, but the dashboard must not become an unofficial “bypass the app claim flow” surface.

## Interfaces and Dependencies

Backend dependencies and interfaces:

- Reuse the existing Fastify route model in `src/routes/admin.js` and `src/routes/gifts.js`.
- Reuse the existing DB interface with `prepare()` and transaction helpers; when writing shared service code, stay adapter-safe where production paths already use both `prepare()` and `query()` style wrappers.
- Reuse the existing audit model in `AdminService` for admin mutations.
- Reuse the current outbox-backed delivery model instead of introducing a new queue system in this slice.
- Prefer a dedicated `admin-gift-ops-service` once query complexity grows beyond small route-local helpers.

Frontend dependencies and interfaces:

- Reuse `useApi` from `admin/src/hooks/useApi.ts`.
- Follow the list/detail/filter patterns in `admin/src/pages/Jobs.tsx` and `admin/src/pages/Shares.tsx`.
- Keep the dashboard route under `/admin` and expose the new page through `admin/src/App.tsx` plus `admin/src/components/Sidebar.tsx`.

Provider-facing interfaces:

- Twilio SMS callbacks and email-provider webhook callbacks must normalize into one internal receipt-state model before storage.
- Provider payload storage must be bounded and privacy-aware. Persist only what is required for diagnostics and correlation.
- Provider authenticity checks are mandatory; do not accept unsigned or unverified receipt payloads.

## Revision Note

Created on 2026-04-10 to unify the seven remaining scheduled-gift hardening items with the missing admin/ops dashboard surface.

Revised on 2026-04-10 after an adversarial review to explicitly cover duplicate and out-of-order callbacks, timezone correctness, operator permissions, privacy redaction, migration partial-rollout safety, and cancellation/retry edge cases.
