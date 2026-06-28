# Root 1 — Gift Reservation Repository Adversarial Review 1

Date: 2026-06-28

Scope under review:
- `src/database/gift-reservation-repository.js`
- `src/routes/gifts.js`
- `src/routes/tracks.js`
- `test/gift-reservation-repository.test.js`
- `test/gifts.test.js`
- `test/render-endpoints.test.js`
- `docs/architecture/architecture-debt-register-2026-06.md`
- `docs/architecture/architecture-map-2026-06.md`

Root boundary:
- In scope: reservation lookup, idempotency lookup, active-reservation lookup,
  expired-active selection, reservation insert, refund-status update,
  content attach/reconcile update, transaction-scoped finalize update, and
  gift-funded track render spend validation.
- Out of scope: wallet reserve/refund accounting, gift-order creation,
  share-token creation, delivery outbox creation, dispatch/retry engine,
  gift cancellation/reschedule persistence, and funded-content deletion.

Reviewer mode: local adversarial pass. No new subagents were launched because
inherited agent sessions remained nonresponsive and prior close attempts hung;
this slice used bounded local parallel reads/checks instead.

## Attack Vectors

1. P0 check — reservation finalization update runs outside the gift-order
   transaction and creates a partial finalize state.
   - Result: NOT FOUND. `markFinalized()` accepts the caller transaction query
     and uses `createPreparedDbFromQuery()`.
   - Coverage: repository test asserts rollback leaves reservation status and
     `gift_order_id` unchanged, then commit finalizes the row.

2. P0 check — idempotency lookup leaks another user's reservation.
   - Result: NOT FOUND. Repository keeps `user_id = ? AND idempotency_key = ?`.
   - Coverage: repository creation/idempotency test reads through user-scoped
     lookup.

3. P0 check — active reservation check ignores `content_ready`.
   - Result: NOT FOUND. Repository keeps `status IN ('reserved', 'content_ready')`.
   - Coverage: repository test seeds both statuses and verifies latest active
     row selection.

4. P0 check — cancelled or expired reservations are selected as active.
   - Result: NOT FOUND. Repository active and expiry selectors filter to
     `reserved`/`content_ready`.
   - Coverage: repository tests seed cancelled rows and assert they are absent.

5. P0 check — refund update overwrites an existing refund transaction id.
   - Result: NOT FOUND. Repository keeps
     `refund_transaction_id = COALESCE(?, refund_transaction_id)`.
   - Coverage: repository test asserts an existing refund id is preserved when
     the update receives `null`.

6. P0 check — reservation create loses the token transaction binding.
   - Result: NOT FOUND. `createReservation()` requires and persists
     `tokenTransactionId`.
   - Coverage: repository test asserts the inserted row has the expected
     `token_transaction_id`.

7. P1 check — expired reservation worker processes future or terminal rows.
   - Result: NOT FOUND. Repository keeps `expires_at <= ?` and active-status
     filtering.
   - Coverage: repository test asserts only active expired rows are returned in
     expiry order.

8. P1 check — content attach fails to move reservation to `content_ready`.
   - Result: NOT FOUND. Repository keeps the previous update shape with
     `status = 'content_ready'`.
   - Coverage: repository test asserts status, content type/id, and version.

9. P1 check — route-level response and error semantics change.
   - Result: NOT FOUND. `routes/gifts.js` keeps feature flags, auth, wallet
     transactions, validation, audit events, dispatch, and response shaping.
   - Coverage: `test/gifts.test.js` passed after extraction.

10. P1 check — gift-funded render incorrectly spends subscription credits.
    - Result: NOT FOUND. `routes/tracks.js` still performs the same
      active-reservation check inside the render transaction; the read now goes
      through `gift-reservation-repository.js`.
    - Coverage: repository test covers transaction-backed
      `getActiveForTrack()`, and `test/render-endpoints.test.js` passed,
      including the gift-funded render skip-spend case.

11. P2 check — wallet accounting remains route-owned.
    - Result: VERIFIED. Reserve/refund spend semantics still call
      `ensureGiftWalletRow()` and `applyGiftWalletTransaction()` in the route.
    - Disposition: Deferred. Wallet accounting is revenue-critical and should
      move only under a dedicated wallet/entitlement root with owner review.

12. P2 check — gift-order and delivery state remain route-owned.
    - Result: VERIFIED. Gift-order creation, share-token creation, delivery
      outbox rows, immediate dispatch, retry/cancel/reschedule persistence, and
      recipient contact updates remain in `routes/gifts.js`.
    - Disposition: Deferred. These belong to full gift dispatch/gift-order
      roots, not the reservation-row slice.

## Findings

No P0 findings.

No P1 findings.

Deferred P2: wallet accounting and full gift-order/dispatch persistence remain
outside this slice by design. They are larger revenue-path changes and require
separate characterization tests plus owner review.

## Validation

- `node --check src/database/gift-reservation-repository.js`
- `node --check src/routes/gifts.js`
- `node --check src/routes/tracks.js`
- `node --check test/gift-reservation-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/gift-reservation-repository.test.js test/gifts.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/gift-reservation-repository.test.js test/render-endpoints.test.js`

Focused result: gift-reservation repository coverage passed with 7 tests. Gift
route suite passed with 46 pass / 1 skipped / 0 fail. Repository plus render
endpoint rerun passed with 24 pass / 0 fail.
