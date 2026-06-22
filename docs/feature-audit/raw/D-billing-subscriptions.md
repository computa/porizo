# D — Billing / Subscriptions / Entitlements / Credits

**Feature audit — discovery pass (no code changes)**
Audited: 2026-06-22
Files: `src/routes/billing.js`, `src/services/subscription-manager.js`, `src/services/apple-receipt-validator.js`, `src/services/apple-webhook-handler.js`, `src/services/google-receipt-validator.js`, `src/services/plan-config.js`, `src/services/gift-funding.js`, `src/services/feature-flags.js`, `migrations/pg/*.sql`

---

### 1. Apple Receipt / JWS Validation

**user_story:** iOS client sends a JWS-encoded StoreKit 2 transaction; server validates signature, maps to a plan, grants entitlements.

**expected_behavior:**

- `POST /billing/receipt/apple` → `apple-receipt-validator.js` decodes JWS, verifies ES256 signature using x5c leaf certificate (IEEE P1363 format), verifies certificate chain, extracts payload, maps `productId` to plan via `plan-config`.
- Receipt de-duplicated via `purchase_receipts.transaction_id UNIQUE` constraint.
- `subscriptionManager.syncSubscription()` upserts `subscriptions` row keyed on `original_transaction_id`; grants songs via `recordSongTransaction`.

**status:** IMPLEMENTED

- JWS signature verification: crypto.verify with sha256/ieee-p1363 ✓
- x5c certificate chain validation present ✓
- Unit-test skip path: `options.skipVerification || NODE_ENV=test` ✓ (no prod bypass risk)
- `purchase_receipts` UNIQUE on `transaction_id` ✓

**gaps:**

1. Certificate chain validation is described as "basic" — root anchor is NOT pinned to Apple's known root CA. A compromised or self-signed cert chain could pass if the chain itself is valid but not rooted in Apple's CA.
2. No environment check on the JWS payload `environment` field (sandbox vs production) at the route level — sandbox receipts could be replayed against production if the validator accepts both.
3. Renewal receipts sent by the client (not via ASSN webhook) are re-validated on each call but there is no TTL / freshness check on `expires_at` from the JWS payload before granting songs.

**key_files:** `src/services/apple-receipt-validator.js`, `src/routes/billing.js`
**db_tables:** `purchase_receipts`, `subscriptions`, `entitlements`, `song_transactions`

---

### 2. Google Play Receipt Validation

**user_story:** Android client sends a purchase token + subscription ID; server verifies via Android Publisher API and syncs entitlements.

**expected_behavior:**

- `POST /billing/receipt/google` → `google-receipt-validator.js` uses service account JWT (RS256) to call `androidpublisher.googleapis.com/v3` subscriptionsv2 endpoint.
- Validates token/productId format (alphanumeric, max 500/150 chars) before API call.
- Maps `subscriptionState` enum (ACTIVE, IN_GRACE_PERIOD, etc.) to internal tier.
- `verifyPurchase()` for one-time products; `verifySubscription()` for subscriptions.

**status:** IMPLEMENTED (partial — one-time product path only stubs acknowledgement)

- Input format validation (VALID_ID_PATTERN) ✓
- Service account OAuth2 JWT self-signed ✓
- Subscription state mapping ✓
- NOT_IMPLEMENTED path returns 501 when `GOOGLE_PLAY_CREDENTIALS_JSON` not set ✓

**gaps:**

1. Google Play one-time purchases (consumables) must be **acknowledged** within 3 days or Google auto-refunds. There is no acknowledgement call in `verifyPurchase()` — only verification. If gift bundles ship on Android, tokens will be silently refunded by Google.
2. No Google RTDN (Real-Time Developer Notifications) webhook handler — subscription lifecycle events (renewal, expiry, refund) are only captured on the next client-initiated receipt call. Long gaps between opens = stale entitlement state.
3. `subscriptions` UNIQUE is `(user_id, product_id)` — a user who cancels and resubscribes to the same product gets the row updated, but there is no history. Audit trail relies on `purchase_receipts` only.

**key_files:** `src/services/google-receipt-validator.js`, `src/routes/billing.js`
**db_tables:** `subscriptions`, `purchase_receipts`, `entitlements`

---

### 3. Apple Server-to-Server Notifications v2 (ASSN / Webhook)

**user_story:** Apple POSTs lifecycle events (renew, expire, refund, grace, revoke) to the server; server updates subscription state without waiting for client.

**expected_behavior:**

- `POST /billing/webhook/apple` (registered in billing routes) → `apple-webhook-handler.js`.
- Decodes outer JWS (signed payload), then inner `signedTransactionInfo` and `signedRenewalInfo` — all ES256/x5c verified.
- Idempotency: `webhook_notifications` table tracks `notification_uuid`; duplicate UUIDs return 200 without reprocessing.
- Dead-letter queue: failed notifications → `webhook_dead_letter_queue` with `attempt_count` increment on conflict.
- Handles: SUBSCRIBED, DID_RENEW, EXPIRED, GRACE_PERIOD_EXPIRED, DID_FAIL_TO_RENEW, REFUND, REVOKE, DID_CHANGE_RENEWAL_PREF, DID_CHANGE_RENEWAL_STATUS, TEST.

**status:** IMPLEMENTED

- Idempotency via `notification_uuid` ✓
- DLQ for failures ✓
- All major lifecycle events handled ✓
- REFUND calls `subscriptionManager.handleRefund()` which revokes songs ✓
- GRACE_PERIOD_EXPIRED correctly downgrades tier ✓

**gaps:**

1. Webhook endpoint authentication: the handler verifies the JWS signature of the _payload_ (Apple-signed content), but there is no server-side secret/HMAC or IP allowlist on the HTTP endpoint itself. Any actor who can forge a valid Apple JWS (e.g., using a leaked Apple dev cert) can trigger song revocations.
2. `REFUND_REVERSED` event is declared in the constants but has no handler — falls through to `unknown_notification_type`. If Apple reverses a refund, songs are not re-granted.
3. `OFFER_REDEEMED`, `CONSUMPTION_REQUEST`, `RENEWAL_EXTENDED`, `PRICE_INCREASE` all fall through to `unknown_notification_type` — not necessarily bugs today, but `PRICE_INCREASE` handling may be needed for App Store compliance.
4. DLQ retry is insert-only — there is no scheduled job or admin endpoint to replay DLQ entries. Failed webhooks are permanently silently dropped after being written to the DLQ.

**key_files:** `src/services/apple-webhook-handler.js`, `src/routes/billing.js`
**db_tables:** `webhook_notifications`, `webhook_dead_letter_queue`, `subscriptions`, `entitlements`

---

### 4. Subscription Lifecycle (State Machine)

**user_story:** Subscriptions transition through active → grace → expired → free on billing events; songs are granted on renewal and revoked on refund/expiry.

**expected_behavior:**

- `syncSubscription()`: upserts subscription row, grants delta songs on renewal (compares `renewal_count`), sets `entitlements.tier`, `subscription_renews_at`.
- `handleExpiration()`: sets tier → free, zeroes `songs_remaining` (preserves `songs_used_total`).
- `handleGracePeriod()`: sets subscription status → `grace_period`, keeps tier active.
- `handleRefund()` / `handleRevoke()`: revokes songs proportional to unused period.
- Songs granted per plan read from `subscription_plans` table via `plan-config`.

**status:** IMPLEMENTED

- Renewal idempotency via `renewal_count` delta ✓
- Grace period preserved as distinct status ✓
- Proportional song revocation on refund ✓

**gaps:**

1. `handleExpiration()` zeroes `songs_remaining` — but does not check whether those songs are mid-render (a full render job could be running when expiry fires). No in-flight render protection.
2. `syncSubscription()` reads plan config from DB cache (5-min TTL). If plan songs-per-period changes, users who renewed in the 5-min window get the old grant count.
3. No handling for subscription **pause** (Google Play supports this; Apple does not). `SUBSCRIPTION_STATE_PAUSED` from Google maps to unknown behavior.

**key_files:** `src/services/subscription-manager.js`
**db_tables:** `subscriptions`, `entitlements`, `song_transactions`, `subscription_plans`

---

### 5. Entitlement Credits Balance (Songs + Poems)

**user_story:** Every user has a songs and poems balance in `entitlements`; balance is the authoritative source for whether a render is allowed.

**expected_behavior:**

- `entitlements` columns: `songs_remaining`, `songs_allowance`, `songs_used_total`, `trial_songs_remaining`, `trial_expires_at`, `poems_remaining`, `poems_allowance`, `poems_used_total`.
- Balance read in `spendSongInTransaction()` via `SELECT * FROM entitlements WHERE user_id = ?`.
- Gift wallet balance (`gift_wallet_transactions` ledger) is a tertiary source checked after trial and subscription credits are exhausted.

**status:** IMPLEMENTED

- Three-tier spend priority: trial → subscription → gift_wallet ✓
- `songs_used_total` / `poems_used_total` monotonically increment ✓

**gaps:**

1. `poems_remaining` spend path exists in the DB schema but was not found in an explicit `spendPoem()` function in `subscription-manager.js` — poem deduction may be missing or handled inline elsewhere. Needs verification.
2. `trial_songs_remaining` is not zeroed explicitly on trial expiry by a background job — it relies on `trial_expires_at` being checked at spend time. If the check is skipped (bug), expired trial credits could be spent.

**key_files:** `src/services/subscription-manager.js`
**db_tables:** `entitlements`, `gift_wallet_transactions`, `song_transactions`

---

### 6. Server-Authoritative Credit Spend (Song Deduction)

**user_story:** When a user triggers a full render, one song credit is atomically deducted server-side; no client can bypass this.

**expected_behavior:**

- `spendSong(userId, trackId)` → `db.transaction()` → `spendSongInTransaction()`.
- Atomic `UPDATE entitlements SET songs_remaining = songs_remaining - 1 WHERE user_id = ? AND songs_remaining > 0` (or equivalent per tier).
- Returns error if no balance across all tiers.
- Idempotency key `song_spend_<trackVersionId>` on `gift_wallet_transactions` prevents double-ledger on retry.

**status:** IMPLEMENTED

- Atomic UPDATE…WHERE > 0 guard ✓ (BILL-02 fix documented in comments)
- PostgreSQL row-level lock via UPDATE serializes concurrent spends ✓
- Gift wallet idempotency key ✓
- No advisory lock — relies solely on atomic UPDATE (acceptable, documented)

**gaps:**

1. If `spendSong()` succeeds but the subsequent render job creation fails (e.g., DB error), the song is spent but no render exists. There is no compensating transaction / rollback to restore the credit. The user loses a song silently.
2. The `trackVersionId` idempotency key is only set when `trackVersionId` is passed in — the function signature has `trackVersionId = null` default. Call sites that omit it lose the idempotency guarantee on gift wallet ledger entries.

**key_files:** `src/services/subscription-manager.js`
**db_tables:** `entitlements`, `gift_wallet_transactions`, `song_transactions`

---

### 7. Billing Hold Create / Capture / Release

**user_story:** Before rendering, a credit hold is reserved; it is captured on success or released on failure.

**expected_behavior (original spec):** `billing_holds` table would hold credits in escrow during render. Capture on `READY`; release on cancel/fail.

**status:** RETIRED / REMOVED

- Migration explicitly drops `billing_holds` table and `track_versions.billing_hold_id` column.
- Migration comment states: "Production has 0 rows in billing_holds and no code path inserts into it."
- Hold-expiry cleanup loop, `releaseHoldIfNeeded`, and cancel-render refund block all removed in the same migration.
- Spend is now immediate at render-trigger time with no escrow.

**gaps:**

1. Without a hold model, a failed render does not automatically refund the spent song. The manual refund path (admin complimentary grant) exists but is not automated.
2. No in-flight protection: two near-simultaneous full render requests for the same user could both pass the balance check before either spend commits (mitigated by atomic UPDATE but not guaranteed at application layer if called from two request handlers in the same ms).

**key_files:** (none — feature retired)
**db_tables:** `billing_holds` (dropped)

---

### 8. Pay-Per-Song / Gift Bundle (gift_bundle_1)

**user_story:** User buys a one-time consumable (`gift_bundle_1`, $1.99) which adds tokens to their gift wallet, spendable on songs.

**expected_behavior:**

- `POST /billing/receipt/apple` with consumable product ID → validates receipt, looks up bundle config in `gift_bundles` table, calls `applyGiftWalletTransaction()` with `idempotencyKey: gift_receipt_<transactionId>`.
- Duplicate receipt for same user → 200 with balance (idempotent via receipt lookup + gift wallet check).
- Duplicate receipt for different user → 409 PURCHASE_CONFLICT.
- Reconciliation path: if `purchase_receipts` row exists but `gift_wallet_transactions` row is missing → re-applies credit (`apple_consumable_reconcile` source).

**status:** IMPLEMENTED

- `paywall_pay_per_song_enabled` flag removed permanently (ce04fe4) — always on ✓
- Receipt idempotency ✓
- Cross-user conflict detection ✓
- Reconciliation path for partial failures ✓

**gaps:**

1. Reconciliation path (`apple_consumable_reconcile`) runs inside the same HTTP request as the duplicate-receipt detection — it is not triggered automatically on server startup or by a background job. A crash between `purchase_receipts` insert and `gift_wallet_transactions` insert leaves a gap until the user retaps "buy".
2. Gift wallet balance is read from `gift_wallet_transactions` ledger aggregation — there is no cached `balance` column. High-frequency reads require a SUM over the ledger, which could be slow as the ledger grows.

**key_files:** `src/routes/billing.js`, `src/services/gift-funding.js`
**db_tables:** `purchase_receipts`, `gift_wallet_transactions`, `gift_bundles`, `entitlements`

---

### 9. Gift Funding of Sender's Own Songs

**user_story:** A sender who creates a song for someone else uses gift wallet tokens (not subscription credits) to fund the render.

**expected_behavior:**

- `gift-funding.js` / `spendSongInTransaction()`: when `voice_mode = 'gift'` (or equivalent flag), gift wallet tokens are preferred / required.
- `song_spend` ledger entry with `source: 'gift_token'` and `idempotency_key: song_spend_<trackVersionId>`.
- Gift tokens are non-expiring.

**status:** IMPLEMENTED (partial)

- Gift wallet spend path exists in `spendSongInTransaction()` as the tertiary tier ✓
- Idempotency key on gift ledger entry ✓

**gaps:**

1. Gift tokens are spent as a _fallback_ after subscription + trial credits. A premium subscriber creating a gift song would consume their subscription credit, not their purchased gift token — this may contradict user expectation ("I bought tokens to send gifts").
2. No separate `spendGiftToken()` function that _only_ draws from gift wallet — the current design forces depletion of all other credits first.

**key_files:** `src/services/subscription-manager.js`, `src/services/gift-funding.js`
**db_tables:** `gift_wallet_transactions`, `entitlements`

---

### 10. Restore Purchases

**user_story:** User reinstalls app or signs in on new device; taps "Restore" to recover subscription or consumable purchases.

**expected_behavior:**

- `POST /billing/restore` accepts `{ platform, transactionId | purchaseToken, subscriptionId }`.
- Apple path: calls `validateAppleTransaction()` then `syncSubscription()` — same flow as `/receipt/apple` but triggered by restore.
- Google path: calls `googleValidator.verifySubscription()` then `syncSubscription()`.
- Consumable path: transaction ID looked up in `purchase_receipts`; if found for same user, re-applies gift wallet credit if missing.

**status:** IMPLEMENTED

- Dual-platform support ✓
- Handles legacy field names (`transaction_id` / `transactionId`) ✓
- Consumable reconciliation on restore ✓

**gaps:**

1. Restore does not return a list of _all_ restorable purchases — it restores exactly one transaction per call. iOS clients sending multiple consumable receipts must call restore N times. A network failure midway leaves partial restore.
2. No rate limit on `/billing/restore` — an attacker who knows another user's transaction ID (possible via receipt sharing) can call restore repeatedly to probe account ownership.

**key_files:** `src/routes/billing.js`
**db_tables:** `purchase_receipts`, `subscriptions`, `gift_wallet_transactions`, `entitlements`

---

### 11. Subscription Status / Entitlements Query

**user_story:** App polls current entitlement state on launch and after purchases.

**expected_behavior:**

- `GET /billing/subscription-status` (alias: `GET /billing/subscription`) returns tier, `songs_remaining`, `poems_remaining`, `trial_*`, subscription dates, gift wallet balance.
- Builds payload via `buildEntitlementsPayload()`.
- Trial expiry checked inline — expired trial credits excluded from response.

**status:** IMPLEMENTED

- Backward-compat alias ✓
- Trial expiry check ✓

**gaps:**

1. No ETag / cache header — iOS clients polling on every app foreground generate unnecessary DB reads. No `If-None-Match` support.
2. `gift_wallet` balance in the response requires a ledger SUM — not cached (same concern as feature 8).

**key_files:** `src/routes/billing.js`, `src/services/subscription-manager.js`
**db_tables:** `entitlements`, `subscriptions`, `gift_wallet_transactions`

---

### 12. Trial Entitlement

**user_story:** New users get N free songs for M days (admin-configurable); trial credits expire and cannot be extended.

**expected_behavior:**

- `trial_config` singleton table (admin-configurable via `/admin` routes): `songs_allowed`, `duration_days`, `is_active`.
- On first render request: `trial_songs_remaining` seeded from `trial_config.songs_allowed`; `trial_expires_at` = now + `duration_days`.
- Spend path: trial credits used first if `trial_expires_at > now`.

**status:** IMPLEMENTED

- Admin-configurable ✓
- Expiry enforced at spend time ✓
- `is_active` flag respected ✓

**gaps:**

1. No background job zeroes `trial_songs_remaining` on expiry — the column retains a non-zero value until the next spend attempt. This means admin reports showing `trial_songs_remaining > 0` overstate available credits for expired-trial users.
2. Trial is per-user, not per-device — a user can create multiple accounts with the same email domain to farm trial credits (no dedup mechanism beyond auth).

**key_files:** `src/services/subscription-manager.js`
**db_tables:** `entitlements`, `trial_config`

---

### 13. Plan / Tier Configuration

**user_story:** Plans map App Store / Play Store product IDs to tier names, song grants, and billing periods; admin can change these without a code deploy.

**expected_behavior:**

- `plan-config.js` reads `subscription_plans` and `trial_config` tables with 5-minute in-memory cache.
- `getPlanByProductId(productId, platform)` used by both receipt validators and subscription manager.
- Cache invalidated via `invalidateCache()` (called by admin plan update endpoints).

**status:** IMPLEMENTED

- DB-backed plan config ✓
- In-memory cache with TTL ✓
- Manual invalidation hook ✓

**gaps:**

1. Cache is per-process — in a multi-instance Railway deployment, invalidating cache on one instance does not invalidate others. A plan change may take up to 5 minutes to propagate across all instances.
2. `subscription_plans` table has no audit history — plan changes are not versioned, making it impossible to reconstruct what grant a user received if plan config changed between their purchase and a dispute.

**key_files:** `src/services/plan-config.js`
**db_tables:** `subscription_plans`, `trial_config`

---

### 14. Preview / Render Rate Limits

**user_story:** Free and premium users have daily preview and render quotas enforced server-side.

**expected_behavior:**

- `rate_limits` table: `(user_id, action_type, window_start_ms)` primary key with sliding window.
- `consumeRateLimit(userId, action, limit, windowSeconds)` used at render-preview and enrollment endpoints.
- `preview_count_today` column in `entitlements` (from original spec) appears to have been superseded by `rate_limits` table approach.

**status:** IMPLEMENTED (via rate_limits table)

- Sliding window rate limiting ✓
- `rate_limits` table with composite PK ✓

**gaps:**

1. No rate limit found on `POST /billing/receipt/apple` or `/billing/receipt/google` — a compromised client can hammer receipt validation without throttling, causing excessive calls to Apple/Google APIs and potential account lockout.
2. Render rate limits are not per-tier in the code found — premium users may hit the same cap as free users (needs verification in track routes).

**key_files:** `src/routes/billing.js`, `src/routes/tracks.js` (rate limit enforcement)
**db_tables:** `rate_limits`, `entitlements`

---

### 15. Admin Complimentary Grants / Upgrades

**user_story:** Support team can grant complimentary songs or temporary tier upgrades to users.

**expected_behavior:**

- `addComplimentarySongs(userId, count, reason, adminId)` → `UPDATE entitlements SET songs_remaining = songs_remaining + ?`.
- `grantAdminUpgrade(userId, tier, durationDays, reason)` → sets `admin_upgrade_tier`, `admin_upgrade_expires_at`, increments songs + poems.
- `revokeAdminComplimentary(userId)` path exists.
- All actions recorded in `song_transactions` (ADMIN_UPGRADE type) and `audit_logs`.

**status:** IMPLEMENTED

- Audit trail ✓
- Expiry-based upgrade ✓
- Revocation path ✓

**gaps:**

1. `admin_upgrade_expires_at` is stored but the spend path checks `admin_upgrade_tier` without also verifying `admin_upgrade_expires_at <= now` — admin upgrades may remain active past their intended expiry if the expiry check is only enforced on the status endpoint, not the spend path.
2. No rate limit or 2FA requirement on admin grant endpoints — any authenticated admin token can issue unlimited complimentary songs.

**key_files:** `src/services/subscription-manager.js`, `src/routes/billing.js` (admin section)
**db_tables:** `entitlements`, `song_transactions`, `audit_logs`

---

### 16. Feature Flags (Billing / Paywall)

**user_story:** Billing behaviors (free tier grants, paywall variants, player rollouts) are gated by admin-toggleable feature flags.

**expected_behavior:**

- `feature_flags` table: `(id TEXT PK, value TEXT, description, updated_at, updated_by)`.
- `feature-flags.js` service reads flags by ID with caching.
- Known billing flags: `free_tier_songs_grant`, `free_tier_poems_grant`, `paywall_pay_per_song_enabled` (removed ce04fe4), `web_player_letterbox_enabled`, `web_player_letterbox_rollout_percent`.

**status:** IMPLEMENTED

- DB-backed flags ✓
- `paywall_pay_per_song_enabled` correctly removed (flag row inert, code removed) ✓

**gaps:**

1. Same multi-instance cache invalidation problem as plan-config — flag changes require all instances to expire their cache before taking effect.
2. No flag change audit history — `updated_at` / `updated_by` are last-write-wins with no log of previous values.

**key_files:** `src/services/feature-flags.js`
**db_tables:** `feature_flags`

---

### 17. Webhook Notification Idempotency Store

**user_story:** Apple webhook notifications must be processed exactly once even if Apple retries.

**expected_behavior:**

- `webhook_notifications` table tracks `(platform, notification_uuid)` with status (`pending` → `processed` / `failed`).
- Before processing: check if UUID exists; if already `processed`, return 200 immediately.
- After processing: UPDATE status to `processed` with `processed_at`.
- DLQ: `webhook_dead_letter_queue` table with `attempt_count`, `last_failed_at`, `error_message`.

**status:** IMPLEMENTED

- UUID dedup ✓
- DLQ on failure ✓

**gaps:**

1. No DLQ replay mechanism — entries accumulate with no automated retry or admin UI to trigger replay. Manual SQL required to reprocess failed webhooks.
2. `webhook_notifications` table has no expiry / cleanup job — it will grow unboundedly. Apple sends notifications for every renewal, so 1000 active subscribers = 12,000+ rows/year.
3. ASSN v2 endpoint URL must be registered in App Store Connect. There is no test confirming the endpoint is reachable from Apple's servers (no smoke test or `/billing/webhook/apple/test` echo endpoint).

**key_files:** `src/services/apple-webhook-handler.js`
**db_tables:** `webhook_notifications`, `webhook_dead_letter_queue`

---

### 18. Song Transaction Ledger

**user_story:** Every credit change (grant, spend, refund, admin) is recorded for audit and dispute resolution.

**expected_behavior:**

- `song_transactions` table: `(id, user_id, type, amount, balance_before, balance_after, source, reference_type, reference_id, description, created_at)`.
- `recordSongTransaction()` called from all grant/spend/revoke paths in subscription-manager.
- Types: SUBSCRIPTION_GRANT, TRIAL_GRANT, ADMIN_UPGRADE, SONG_SPEND, SONG_REFUND, etc.

**status:** IMPLEMENTED

- All major paths write ledger entries ✓
- `balance_before` / `balance_after` snapshots ✓

**gaps:**

1. Gift wallet spend (`gift_wallet_transactions`) is a _separate_ ledger — there is no unified transaction log across both ledgers. Auditing a user's complete credit history requires joining two tables.
2. Poem transactions use `entitlements.poems_remaining` directly with no `poem_transactions` ledger — poem usage is unauditable beyond the current balance.

**key_files:** `src/services/subscription-manager.js`
**db_tables:** `song_transactions`, `gift_wallet_transactions`, `entitlements`

---

## Summary Table

| #   | Feature                           | Status      | Top Gap                                               |
| --- | --------------------------------- | ----------- | ----------------------------------------------------- |
| 1   | Apple JWS Receipt Validation      | Implemented | Root CA not pinned                                    |
| 2   | Google Play Receipt Validation    | Partial     | No purchase acknowledgement for consumables           |
| 3   | Apple ASSN v2 Webhook             | Implemented | REFUND_REVERSED unhandled; DLQ no replay              |
| 4   | Subscription Lifecycle            | Implemented | In-flight render on expiry not protected              |
| 5   | Entitlement Balance (Songs/Poems) | Implemented | Poem spend function unclear                           |
| 6   | Server-Authoritative Credit Spend | Implemented | No compensating tx if render creation fails           |
| 7   | Billing Hold                      | Retired     | Spend now immediate; failed renders don't auto-refund |
| 8   | Pay-Per-Song / Gift Bundle        | Implemented | Reconciliation not background-triggered               |
| 9   | Gift Funding Own Songs            | Partial     | Tokens spent as fallback, not priority                |
| 10  | Restore Purchases                 | Implemented | No rate limit; single-receipt per call                |
| 11  | Subscription Status Query         | Implemented | No ETag; gift wallet requires ledger SUM              |
| 12  | Trial Entitlement                 | Implemented | Stale trial balance not background-zeroed             |
| 13  | Plan / Tier Config                | Implemented | Multi-instance cache staleness                        |
| 14  | Preview / Render Rate Limits      | Implemented | No rate limit on receipt validation endpoints         |
| 15  | Admin Complimentary Grants        | Implemented | Admin upgrade expiry may not gate spend               |
| 16  | Feature Flags (Billing)           | Implemented | Multi-instance cache; no flag audit history           |
| 17  | Webhook Idempotency Store         | Implemented | No DLQ replay; no table expiry                        |
| 18  | Song Transaction Ledger           | Implemented | Split ledgers; poems unaudited                        |
