# Root 1 Gift Wallet Repository — Adversarial Review 1

## Slice

- Added `src/database/gift-wallet-repository.js`.
- Delegated wallet row creation, balance reads, wallet summary reads,
  receipt-credit reconciliation reads, idempotent wallet ledger mutations,
  transaction-scoped receipt crediting, and gift-token song-spend ledger writes
  to the repository.
- Updated `server.js`, `routes/gifts.js`, `routes/billing.js`, and
  `services/subscription-manager.js` to depend on the repository boundary.
- Added `test/gift-wallet-repository.test.js`.

## Adversarial Checks

1. P0 check — receipt insert can commit without wallet credit.
   - Result: NOT FOUND. `routes/billing.js` still passes the transaction query
     into the wallet repository for receipt + wallet atomicity.
   - Coverage: `test/billing-api.test.js` still covers rollback and missing
     wallet-credit reconciliation.

2. P0 check — idempotency replay drifts wallet balance.
   - Result: NOT FOUND. The repository preserves the old pre-check,
     unique-conflict recovery, and balance revert behavior.
   - Coverage: repository tests assert replay returns the original transaction
     and does not change balance.

3. P0 check — gift-token song spend can double-spend the final token.
   - Result: NOT FOUND. The repository keeps the atomic
     `UPDATE gift_wallet ... WHERE balance > 0` guard inside the caller
     transaction.
   - Coverage: `test/subscription-manager.test.js` still covers final-token
     double-spend prevention, and the repository test covers ledger shape.

4. P1 check — route code still owns wallet table SQL.
   - Result: NOT FOUND for route/server targets. `rg` shows wallet table SQL only
     in `gift-wallet-repository.js`; route files retain only response-field
     names and comments.

5. P1 check — repository absorbs business decisions.
   - Result: NOT FOUND. Gift reservation, delivery, receipt validation,
     bundle-resolution, and spend-order decisions remain in routes/services.
     The repository owns persistence only.

6. P1 check — over-cap wallet credit changes error surface.
   - Result: NOT FOUND. The repository preserves the existing
     `INSUFFICIENT_GIFT_TOKENS` failure code for overdrafts and balance cap
     violations.

7. P2 check — full gift-order/dispatch persistence is still route/server-owned.
   - Result: FOUND and deferred. Gift order creation, outbox binding, dispatch
     status transitions, and delivery retries remain separate Root 1 / Root 3b
     seams.

## Validation

- `node --check src/database/gift-wallet-repository.js`
- `node --check src/server.js`
- `node --check src/routes/billing.js`
- `node --check src/routes/gifts.js`
- `node --check src/services/subscription-manager.js`
- `node --check test/gift-wallet-repository.test.js`
- `NODE_ENV=test ALLOW_ANON_USER_ID=true ALLOW_DEVICE_TOKEN_FALLBACK=true node --test --test-concurrency=1 test/gift-wallet-repository.test.js test/subscription-manager.test.js test/billing-api.test.js test/gifts.test.js test/render-endpoints.test.js`

Focused result: 151 pass / 1 skipped / 0 fail across wallet, subscription,
billing, gift, and render endpoint coverage.
