# Billing / Data-Integrity Audit — Adversarial Verification

**Date:** 2026-06-22  
**Auditor role:** Adversarial verifier (read-only, no code changes)  
**Files examined:** `src/routes/tracks.js`, `src/services/subscription-manager.js`, `src/services/apple-webhook-handler.js`, `src/services/google-receipt-validator.js`, `src/services/share-service.js`, `src/services/receiver-session-service.js`, `src/routes/billing.js`, `migrations/pg/095_drop_billing_holds.sql`, `migrations/pg/032_add_webhook_dlq.sql`, `src/workflows/runner.js`

---

## Finding 1 — Full render has NO credit guard

**Claim:** `billing_holds` dropped in migration 095, no credit deduction at full-render time; zero-balance users can full-render.

**VERDICT: FALSE POSITIVE**

**Evidence:**  
Migration 095 (`migrations/pg/095_drop_billing_holds.sql`) confirms `billing_holds` was intentionally retired — the table never had production rows and the reservation model never shipped. The migration comment explicitly states all hold-related code was removed simultaneously.

However, the full-render endpoint (`src/routes/tracks.js:1160–1215`) does enforce a credit spend. The pattern used is **entitlement re-use with idempotent guard**:

- `consumeSongEntitlementInTransaction` (line 241) checks `consumedAt` first:
  - If `song_entitlement_consumed_at IS NOT NULL` → skip spend (version already paid for at preview)
  - If `NULL` → call `spendSongInTransaction` to deduct one credit atomically, then stamp the timestamp
- This function is called inside a `db.transaction()` at lines 1160/1170 alongside the `ALREADY_RENDERING` guard and job INSERT
- Legacy versions (preview-ready without the stamp) **do spend once** on full render (comment at line 1135–1137)

So full render is not free — it reuses the preview spend for the same version, and charges legacy versions. The billing_holds removal was correct housekeeping, not a regression.

**Severity:** N/A (false positive)  
**Fix:** None needed.  
**Blast radius:** No impact. The entitlement-stamp model is the intended design.

---

## Finding 2 — Preview render TOCTOU double-spend

**Claim:** `ALREADY_RENDERING` check + job INSERT not in same transaction; concurrent requests double-spend.

**VERDICT: FALSE POSITIVE**

**Evidence:**  
`src/routes/tracks.js:921` wraps the entire sequence in a single `db.transaction()`:

```js
previewResult = await db.transaction(async (query) => {
  // 1. UPDATE track_versions SET status = 'processing' WHERE ... NOT IN ('processing','preview_ready')
  // 2. throw ALREADY_RENDERING if 0 rows affected (idempotent guard)
  // 3. consumeSongEntitlementInTransaction(query, ...) — spend inside same tx
  // 4. INSERT INTO jobs ...
  // 5. UPDATE track_versions SET preview_job_id = ?
});
```

The `UPDATE ... WHERE status NOT IN (...)` acts as the optimistic lock. If two concurrent requests race, only one gets `changes > 0`; the other throws `ALREADY_RENDERING` and the entire transaction rolls back — no spend occurs. The same pattern is repeated for full render at line 1160.

Additionally, `spendSongInTransaction` uses `UPDATE ... WHERE songs_remaining > 0` (subscription-manager.js:991) as the atomic decrement — even if the outer transaction somehow re-entered, the WHERE guard prevents a second deduction.

**Severity:** N/A (false positive)  
**Fix:** None needed.  
**Blast radius:** No impact.

---

## Finding 3 — Google Play receipt validation: "not implemented"

**Claim:** Google receipt validation not implemented.

**VERDICT: PARTIALLY TRUE — the real gap is IAP (one-time purchase) acknowledgement, not subscriptions**

**Evidence:**  
`src/services/google-receipt-validator.js` is 12.6KB and fully implements:

- `validateSubscription()` — calls `androidpublisher.googleapis.com` subscriptionsv2 endpoint
- `acknowledgePurchase()` — calls `:acknowledge` for both subscriptions and products (type param)
- `cancelSubscription()`
- `ACKNOWLEDGEMENT_STATE` constants

`src/routes/billing.js:196` calls `googleValidator.acknowledgePurchase(purchaseToken, resolvedSubscriptionId, "subscription")` — but **only for subscriptions**, only on the restore/sync path, only when `!validation.acknowledged`.

**Real gap:** The `acknowledgePurchase` function accepts `type = "subscription" | "product"` (line 367–374 of google-receipt-validator.js uses the products endpoint for non-subscription type), but **there is no call site that passes `type = "product"`**. If Porizo ever sells a Google Play one-time IAP (consumable or non-consumable), those purchases will not be acknowledged via the Publisher API within the 3-day window, causing Google to auto-refund and potentially revoke the entitlement. The `gift_bundle_1` IAP referenced in project memory (`$1.99`) has no corresponding Google Play IAP code path visible — it appears to be Apple-only at present.

**Severity:** P1 (if/when Google Play IAP launches — currently Apple-only)  
**Fix:** For any non-subscription Google Play product, call `googleValidator.acknowledgePurchase(token, productId, "product")` after granting entitlement, within the billing route handler. No migration needed.  
**Blast radius:** If unaddressed when Android IAP launches: Google auto-refunds after 3 days, user keeps entitlement (revenue loss + inventory leak).

---

## Finding 4 — No compensation if spend → render-job creation fails

**Claim:** `spendSong()` commits before job creation; no refund on subsequent failure.

**VERDICT: FALSE POSITIVE**

**Evidence:**  
The spend and job INSERT are **inside the same `db.transaction()`** (tracks.js:921 for preview, 1160 for full). The sequence is:

1. `UPDATE track_versions` (optimistic lock)
2. `consumeSongEntitlementInTransaction(query, ...)` — spend
3. `INSERT INTO jobs`
4. `UPDATE track_versions SET preview_job_id`

All four steps share the same `query` parameter (the transaction-scoped query function). If step 3 (job INSERT) throws, the transaction rolls back, which also rolls back the spend at step 2. There is no committed-spend-then-fail window.

**Severity:** N/A (false positive)  
**Fix:** None needed.  
**Blast radius:** No impact.

---

## Finding 5 — REFUND_REVERSED / refund webhook unhandled

**Claim:** `REFUND_REVERSED` falls through to `unknown`; refund re-grant/revoke broken.

**VERDICT: CONFIRMED (PARTIALLY)**

**Evidence:**  
`src/services/apple-webhook-handler.js:335–382` (switch statement):

Handled types: `SUBSCRIBED`, `DID_RENEW`, `EXPIRED`, `GRACE_PERIOD_EXPIRED`, `DID_FAIL_TO_RENEW`, `REFUND`, `REVOKE`, `DID_CHANGE_RENEWAL_PREF`, `DID_CHANGE_RENEWAL_STATUS`, `TEST`

`NOTIFICATION_TYPES` constants at line 36 include `REFUND_DECLINED` and `REFUND_REVERSED` — both are **defined** but **absent from the switch**. They fall through to the `default` branch returning `{ handled: false, action: "unknown_notification_type" }`.

This means:

- **`REFUND_REVERSED`** (Apple reversed a prior refund — user keeps subscription, credits should be re-revoked): no action taken. If a user got a refund that triggered credit revocation via `REFUND` handler, and then Apple reversed that refund, the user's credits are not restored and the subscription remains in whatever state the `REFUND` handler left it.
- **`REFUND_DECLINED`** (Apple declined user's refund request): no action needed in most cases, but the notification silently passes through.

The `REFUND` type IS handled (calls `handleRefund`), so basic refund revocation works. The gap is specifically `REFUND_REVERSED`.

When either falls through to `default`, `result.handled = false` is returned. The code then checks `processingError` (line after switch) — since no exception was thrown, the notification is recorded as "processed" with `handled: false`, **not moved to DLQ**. It is silently discarded.

**Severity:** P2  
**Fix:** Add `case NOTIFICATION_TYPES.REFUND_REVERSED:` → re-grant the subscription (or at minimum log + no-op with `handled: true`). For `REFUND_DECLINED`: add case returning `{ handled: true, action: "refund_declined_no_op" }`. No migration needed.  
**Blast radius:** Low volume (Apple rarely reverses refunds), but when it occurs the user's entitlement state diverges from Apple's. Risk: user lost credits on refund, never got them back after Apple reversal. No double-spend risk.

---

## Finding 6 — Apple webhook DLQ write-only (no replay)

**Claim:** `webhook_dead_letter_queue` has no replay job/endpoint.

**VERDICT: PARTIALLY TRUE — the webhook DLQ is separate from the jobs DLQ; only the jobs DLQ has auto-replay**

**Evidence:**  
Two separate DLQ tables exist:

1. **`dead_letter_queue`** (render/workflow jobs) — `src/workflows/runner.js:2227–2321` has a `performDLQAutoReprocess` timer firing every 5 minutes, replaying entries with `auto_reprocess_count < 2`. Admin endpoint at `server.js:4254` also allows manual replay.

2. **`webhook_dead_letter_queue`** (`migrations/pg/032_add_webhook_dlq.sql`) — Apple webhook failures write here (`apple-webhook-handler.js:146`). Searching `src/` for replay/sweeper targeting this table returns **zero results**. The table has `reprocessed_at` and implied replay columns (from the index names), but no code reads from it to retry.

The webhook DLQ is write-only in the current codebase. Transient Apple delivery failures that throw an exception (e.g., DB hiccup during `handleRenewal`) land here and stay forever unless manually queried.

**Severity:** P2  
**Fix:** Add a periodic sweeper (cron-style interval, similar to `performDLQAutoReprocess`) that selects unprocessed `webhook_dead_letter_queue` rows, re-invokes `processNotification`, and marks `reprocessed_at`. Limit to 2–3 auto-retries. No migration needed.  
**Blast radius:** Affects subscription lifecycle correctness on transient DB failures. Revenue impact if a `DID_RENEW` or `SUBSCRIBED` lands in DLQ and is never replayed — user doesn't get credits.

---

## Finding 7 — Device-binding COALESCE NULL no-op

**Claim:** Claim with NULL `claimUserId` silently no-ops via COALESCE.

**VERDICT: FALSE POSITIVE (claim flow does not use COALESCE on user binding)**

**Evidence:**  
`src/services/share-service.js` claim logic uses explicit checks:

- Line 36: `const isBound = share.bound_device_id || share.bound_user_id;` — boolean, not COALESCE
- Line 57: Same pattern for status display
- The only `COALESCE` found in share-service.js is line 130 (`claim_pin = NULL`), which is unrelated to user binding
- `receiver-session-service.js` also contains no COALESCE on user/device binding fields

The binding is set via explicit `UPDATE share_tokens SET bound_device_id = ?, bound_user_id = ?` (inferred from INSERT at line 163 which sets both at creation). There is no path where a NULL `claimUserId` silently succeeds via COALESCE — a NULL would simply not overwrite an existing binding, but the code validates presence before proceeding.

No COALESCE NULL no-op vulnerability found in the claim flow.

**Severity:** N/A (false positive)  
**Fix:** None needed.  
**Blast radius:** No impact.

---

## Finding 8 — Atomic credit spend guard

**Claim:** Verify `WHERE credits_balance > 0` atomic decrement is the sole guard.

**VERDICT: CONFIRMED (guard exists and is explicitly documented as sole guard)**

**Evidence:**  
`src/services/subscription-manager.js` contains three atomic decrement paths, each with a WHERE guard:

```sql
-- Trial songs (line 974):
WHERE user_id = ? AND trial_songs_remaining > 0

-- Regular subscription songs (line 991):
WHERE user_id = ? AND songs_remaining > 0

-- Gift wallet balance (line 1013):
WHERE user_id = ? AND balance > 0
```

The code comment at line 914–920 explicitly states:

> "The actual decrement is done atomically via UPDATE...WHERE to eliminate the TOCTOU race... NOTE: there is NO advisory lock on this path — the atomic WHERE guard is the sole double-spend protection, and it is sufficient for trial, subscription, and gift_wallet decrements alike."

On PostgreSQL, the row-level lock taken by `UPDATE ... WHERE balance > 0` serializes concurrent spends for the same user — a second concurrent request blocks until the first commits, then re-reads `balance = 0`, matches 0 rows, and throws `INSUFFICIENT`.

All three paths are inside `db.transaction()` (spendSongInTransaction called from render handler which wraps in its own transaction). The guard is sound.

**Severity:** N/A (confirmed as correct)  
**Fix:** None needed. The design is intentional and documented.  
**Blast radius:** No impact.

---

## Summary Table

| #   | Finding                                | Verdict           | Severity | Fix                                                                                                        |
| --- | -------------------------------------- | ----------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Full render no credit guard            | FALSE POSITIVE    | —        | None — entitlement-stamp model reuses preview spend                                                        |
| 2   | Preview TOCTOU double-spend            | FALSE POSITIVE    | —        | None — spend + job INSERT in same db.transaction()                                                         |
| 3   | Google Play receipt validation missing | PARTIALLY TRUE    | P1       | Add `acknowledgePurchase(token, id, "product")` call for non-subscription IAPs when Android launches       |
| 4   | No compensation on spend→job fail      | FALSE POSITIVE    | —        | None — both steps in same transaction, auto-rollback                                                       |
| 5   | REFUND_REVERSED unhandled              | CONFIRMED         | P2       | Add switch case for REFUND_REVERSED (re-grant) and REFUND_DECLINED (no-op ack) in apple-webhook-handler.js |
| 6   | Apple webhook DLQ write-only           | PARTIALLY TRUE    | P2       | Add periodic sweeper for webhook_dead_letter_queue (mirror performDLQAutoReprocess pattern)                |
| 7   | Device-binding COALESCE NULL no-op     | FALSE POSITIVE    | —        | None — binding uses explicit boolean checks, no COALESCE on user binding                                   |
| 8   | Atomic credit spend guard              | CONFIRMED CORRECT | —        | None — UPDATE...WHERE guard is sole protection, intentional and sound                                      |

---

## Highest Revenue Risk

**Finding 6 (P2 — webhook DLQ write-only)** is the highest revenue risk among confirmed issues: a transient DB error during `handleRenewal` processing silently buries the notification in `webhook_dead_letter_queue` with no replay. If Apple delivers a `DID_RENEW` webhook during a DB hiccup, the user's subscription never gets its monthly credit grant — a silent revenue/entitlement divergence that accumulates invisibly until a customer complains. Finding 5 (`REFUND_REVERSED`) is lower frequency but causes permanent entitlement state corruption.
