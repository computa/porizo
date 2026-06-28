# Root 1 Gift Dispatch State Repository Adversarial Review 3

Date: 2026-06-28

Scope under review:
- `src/database/gift-dispatch-repository.js`
- `src/server.js`
- `src/database/identity-repository.js`
- `test/gift-dispatch-repository.test.js`
- `docs/architecture/architecture-map-2026-06.md`
- `docs/architecture/architecture-debt-register-2026-06.md`

Change summary:
- Moved server-owned gift dispatch persistence for dispatch locks, gift reloads,
  due outbox selection, outbox row locking, outbox reloads, aggregate
  observability updates, full dispatch final state, partial/failure final state,
  and crash recovery into `gift-dispatch-repository.js`.
- Reused `identity-repository.js` for sender display-name/email lookup in the
  server dispatcher.
- Kept provider sends, refund policy, incidents, audit/events, feature flags,
  and response/log shaping in `server.js`.

Attack vectors checked:
1. Non-dispatchable gifts should not be lockable.
2. Dispatch locks should be one-shot and should preserve first-dispatch time.
3. Pending and failed delivery rows should be selected only when due.
4. Delivery row locks should be one-shot.
5. Delivery row locks should preserve first-attempt time after the first lock.
6. Final sent status should clear retry and dispatch-start fields.
7. Final sent status should preserve delivery lag update semantics.
8. Partial delivery should set partial retry state without dropping successful
   channel observability.
9. Exhausted delivery should be able to attach a refund transaction id without
   overwriting an existing one.
10. Crash recovery should only recover gifts still in `dispatching`.
11. Crash recovery should truncate stored error text to the existing 500-char
   bound.
12. Aggregate observability should preserve an existing
   `first_dispatch_started_at`.
13. Aggregate observability should clear overdue state only when the caller says
   the final status is no longer scheduled/retry/dispatching.
14. The moved server path should not retain raw gift-dispatch SQL in
   `server.js`.
15. Route-level gift behavior should still pass after the dispatcher extraction.
16. Repository tests should use legal one-row-per-gift-channel fixtures.
17. Docs should describe the moved persistence seam without claiming provider
   orchestration was extracted.

Findings:
- P0: None.
- P1: None.
- P2 VERIFIED: `server.js` still computes dispatch summary, refund policy,
  share side effects, incident side effects, and provider sends inline. This is
  intentional for Root 1, but it means the gift subsystem remains a service
  boundary candidate for Root 3b. Smallest fix: extract a gift dispatch service
  after repository seams are stable and owner review is available.
- P3 VERIFIED: The gift route test output is noisy because application logs are
  emitted during `node --test`. This is not a behavior defect. Smallest fix:
  add a test logger helper or quiet test app option in a later cleanup pass.

Validation evidence:
- `node --check src/server.js`
- `node --check src/database/gift-dispatch-repository.js`
- `NODE_ENV=test node --test test/gift-dispatch-repository.test.js`
  - 12 pass / 0 fail
- `NODE_ENV=test node --test test/gifts.test.js`
  - 40 pass / 1 skipped / 0 fail
- `npm run lint`
- `git diff --check -- src/database/gift-dispatch-repository.js src/server.js test/gift-dispatch-repository.test.js`
- `rg -n "SELECT \\* FROM gift_orders WHERE id|SELECT display_name, email FROM users|FROM gift_delivery_outbox|UPDATE gift_delivery_outbox|UPDATE gift_orders" src/server.js`
  - no matches

Disposition:
- Root 1 gift-dispatch persistence is improved and this slice has zero P0/P1.
- Do not claim the whole gift subsystem is modular yet. The remaining
  provider/orchestration extraction belongs in Root 3b, after the persistence
  seam is stable.
