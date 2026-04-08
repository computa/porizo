# Harden Scheduled Gift Finalization and Delivery

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this work, a sender should be able to create a gift, schedule it, and trust that the system persists one durable delivery record from creation through dispatch. The main user-visible outcome is that scheduled gifts no longer depend on a fragile chain of “create share, create gift, maybe dispatch” side effects. Instead, finalization becomes atomic, the due delivery work is persisted as delivery rows, and dispatch can recover cleanly from retries and process restarts.

The acceptance bar for this slice is narrower than the final end state. We are hardening the foundation, not building every sender-facing recovery screen. A novice should be able to run the gift test suite and see that scheduled gifts create persistent delivery rows, survive reschedule/cancel operations correctly, and dispatch without duplicate or orphaned state.

## Progress

- [x] (2026-04-08 15:55 AWST) Reviewed the end-to-end gift flow and identified the main correctness seam: non-atomic finalize and non-durable provider send handling.
- [x] (2026-04-08 16:05 AWST) Added gift lifecycle hardening from the previous slice: immutable per-gift share tokens, frozen poem snapshots, retry timing, stale dispatch recovery.
- [x] (2026-04-08 17:10 AWST) Implemented Phase 1 foundation: transactional finalize plus persisted delivery outbox rows.
- [x] (2026-04-08 17:25 AWST) Added targeted tests for outbox-backed dispatch behavior, partial-delivery protection, and reservation finalization idempotency.
- [x] (2026-04-08 17:40 AWST) Ran `npm run lint`, `node --test test/gifts.test.js`, sharing suites, and full `npm test`; all green.
- [x] (2026-04-08 17:55 AWST) Completed self-review and adversarial review of finalize, reschedule, cancel, and dispatch semantics.
- [ ] Phase 2: add provider-send idempotency / outbox-send receipts so provider acceptance and DB success recording cannot drift.
- [ ] Phase 3: move scheduled dispatch off the API process into a dedicated worker or workflow.
- [ ] Phase 4: improve sender and admin recovery surfaces for partial delivery, retries, and manual resend/cancel actions.

## Surprises & Discoveries

- Observation: the repo already had most of the gift lifecycle primitives, but finalization still stitched them together outside a transaction.
  Evidence: `src/routes/gifts.js` creates a share, inserts `gift_orders`, and only later marks the reservation finalized.

- Observation: the current dispatch path records success only after provider send returns, which leaves a duplicate-send window on crash.
  Evidence: `src/server.js` sends SMS/email before writing success rows to `gift_dispatch_attempts`.

## Decision Log

- Decision: introduce a dedicated `gift_delivery_outbox` table instead of overloading `gift_dispatch_attempts`.
  Rationale: `gift_dispatch_attempts` is historical evidence, not a durable queue. Reusing it would mix pending work with audit history and make partial delivery logic harder to reason about.
  Date/Author: 2026-04-08 / Codex

- Decision: preserve the current polling worker for now, but make it consume durable outbox rows.
  Rationale: moving to a separate workflow system is the next stage. This slice should harden correctness first without requiring infrastructure replacement.
  Date/Author: 2026-04-08 / Codex

- Decision: only auto-refund and revoke a gift when no channel successfully delivered.
  Rationale: once at least one channel has delivered, the recipient may already have the link and PIN. Refunding and revoking in that state is internally contradictory.
  Date/Author: 2026-04-08 / Codex

## Outcomes & Retrospective

Phase 1 shipped the two biggest correctness fixes:

- reservation finalization is now transactional instead of stitched together across separate side effects
- channel delivery state now lives in durable `gift_delivery_outbox` rows instead of being inferred from one coarse gift row

This materially improves the validation bar the user asked for: a gift can now be created, scheduled, and survive retries or process restarts with a durable record of what still needs to be sent.

The green tests are meaningful, but not the whole story. The remaining hard problem is provider-send idempotency. The current code still talks to Twilio/Resend before durable success state is written, so a crash after provider acceptance can still duplicate a send on retry. That is the next real hardening stage.

## Context and Orientation

Gift sending spans both iOS and backend code.

On iOS, the sender flow lives in `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift`. The app first reserves a token, then launches song or poem creation, then attaches created content to the reservation, and finally calls `/gifts/reservations/:id/finalize`.

On the backend, the reservation and finalize endpoints live in `src/routes/gifts.js`. Gift share-token creation and actual dispatch live in `src/server.js`. The polling worker that finds due gifts lives in `src/jobs/gift-dispatch.js`.

A “reservation” means a held gift token before the sender has finished creating the content. A “gift order” means the persisted scheduled delivery record. A “delivery outbox row” in this plan means one durable row representing one channel delivery target, such as SMS or email, which the dispatch worker can safely retry.

## Plan of Work

First, add a new migration that introduces `gift_delivery_outbox`. Each row will represent a single delivery target for one gift, with fields for channel, recipient, current state, retry timing, attempt count, provider message ID, and lock timestamps.

Second, refactor the finalize path in `src/routes/gifts.js` so reservation finalization uses `db.transaction(...)`. Within that transaction, the code must validate the reservation, create the immutable gift share token, insert the `gift_orders` row, seed the `gift_delivery_outbox` rows, and mark the reservation finalized. No external provider send happens inside the transaction.

Third, update `src/server.js` so `dispatchGiftById` processes outbox rows instead of inferring pending channels from `gift_orders.channels_json`. It should:

- bootstrap outbox rows for legacy gifts that predate the migration,
- lock the gift row,
- transition due outbox rows from `pending` or retryable `failed` to `sending`,
- send through Twilio or Resend,
- mark each outbox row `sent` or `failed`,
- compute aggregate gift status from the outbox rows.

Fourth, update edit and cancel flows in `src/routes/gifts.js` so they synchronize unsent outbox rows, and so they reject edit/cancel once any delivery row has already been sent.

Finally, add and update tests in `test/gifts.test.js` to prove the new invariants and run full validation.

## Concrete Steps

Work from the repository root:

1. Add migration files:

       migrations/081_gift_delivery_outbox.sql
       migrations/pg/081_gift_delivery_outbox.sql

2. Update backend routes and dispatch:

       src/routes/gifts.js
       src/server.js
       src/jobs/gift-dispatch.js

3. Add or update tests:

       test/gifts.test.js

4. Run validation:

       npm run lint
       npm test

Expected success transcript at the end:

       ℹ tests 343
       ℹ pass 336
       ℹ fail 0

The exact test count may change if this slice adds tests; the required property is zero failures.

## Validation and Acceptance

Acceptance is behavioral:

- Finalizing a reservation creates one gift order and one delivery outbox row per selected channel.
- Repeating finalize for the same reservation returns the same gift instead of creating a second gift.
- A scheduled gift remains deliverable after process restart because due work is represented by outbox rows, not only `gift_orders` state.
- Cancelling a scheduled gift revokes its delivery token and cancels all unsent outbox rows.
- Rescheduling updates unsent outbox rows so delivery happens at the new time.
- If one channel succeeds and another fails, the system does not refund and revoke the gift as though nothing was delivered.

Run `node --test test/gifts.test.js` and `npm test`. The new tests in `test/gifts.test.js` should prove outbox creation and partial-delivery behavior.

Validation completed for this slice:

- `npm run lint`
- `node --test test/gifts.test.js`
- `node --test test/share-flow.test.js test/sharing-security.test.js test/share-embed.test.js`
- `npm test`

Observed result:

- gift suite: `22 pass, 0 fail`
- sharing suites: `74 pass, 0 fail`
- full suite: `343 pass, 0 fail, 7 skipped`

## Idempotence and Recovery

The migrations must be additive and safe to rerun through the migration runner. Runtime backfill for outbox rows should be idempotent: if a legacy gift has no outbox rows, dispatch/bootstrap may create them once; repeated calls should not create duplicates.

If a validation step fails, fix the code and rerun the same commands. Do not manually alter SQLite test DB files outside migrations and tests.

## Artifacts and Notes

The most important artifact from this slice is the new `gift_delivery_outbox` schema and the tests that prove:

- no duplicate gift on finalize retry,
- no duplicate share token orphaning,
- no false refund/revoke after partial delivery.

## Interfaces and Dependencies

The database interface already supports `db.transaction(fn)` with a query callback that accepts SQL plus `?` placeholders. Use that rather than manual `BEGIN`/`COMMIT` in gift code.

The new `gift_delivery_outbox` rows should contain at least:

- `id`
- `gift_order_id`
- `channel`
- `recipient`
- `status`
- `attempt_count`
- `provider_message_id`
- `last_error`
- `send_after`
- `next_retry_at`
- `last_attempt_at`
- `locked_at`
- `payload_json`
- `created_at`
- `updated_at`

The final code should preserve existing public API shapes for `GiftOrder` unless a new field is truly necessary for correctness.

## Revision Note

Created on 2026-04-08 to implement the first hardening slice after the end-to-end review of scheduled gift delivery.

## Next Phases

### Phase 2: Provider-Safe Delivery

Add a true outbox-send protocol so each delivery attempt is durably claimed before external provider IO and reconciled after provider response. The goal is to eliminate duplicate recipient sends caused by process crash after provider acceptance.

Concrete work:

1. Add provider request IDs / delivery correlation fields to `gift_delivery_outbox` or a dedicated send-attempt table.
2. Persist a `sending` attempt record with a stable idempotency key before provider IO.
3. Pass provider-supported idempotency metadata where available.
4. Add a reconciliation path for ambiguous sends.
5. Add tests that simulate crash between provider accept and DB success write.

### Phase 3: Dedicated Scheduler

Move gift dispatch out of the API process and into a dedicated worker or workflow system.

Concrete work:

1. Separate worker startup from web startup.
2. Keep the DB row locking protocol, but remove reliance on the API server process for progress.
3. Add deployment/runbook support so operators can verify the scheduler is alive independently.

### Phase 4: Sender and Ops Recovery UX

Expose the real delivery model instead of hiding it behind one coarse “gift status.”

Concrete work:

1. Sender UI for per-channel status and retry/fallback actions.
2. Admin/ops surface for due queue, partial failures, exhausted failures, and manual requeue.
3. Better manual-forward fallback using the persisted share URL and claim PIN when delivery providers fail.
