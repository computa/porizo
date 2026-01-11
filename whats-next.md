# Handoff: Song-Based Subscription System Implementation

<original_task>
Implement a complete song-based subscription billing system for the Porizo personalized song platform, replacing the previous credit-based model with a subscription tier system (Free/Plus/Pro) integrated with Apple App Store Server API v2.
</original_task>

<work_completed>

## 1. Database Migrations (Complete)

**Files created:**
- `migrations/017_song_based_subscriptions.sql` - Core schema for subscription model
- `migrations/018_add_subscription_billing_columns.sql` - Additional billing columns

**New tables:**
- `subscription_plans` - Admin-configurable plans (free, plus, pro)
- `plan_products` - Maps App Store product IDs to plans
- `trial_config` - Singleton table for trial configuration
- `song_transactions` - Audit trail for song usage
- `webhook_notifications` - Idempotent webhook processing

**Schema changes to existing tables:**
- `entitlements` - Added: `songs_remaining`, `songs_allowance`, `songs_used_total`, `trial_songs_remaining`, `trial_expires_at`, `trial_started_at`, `plan_id`, `billing_period`, `subscription_starts_at`, `subscription_renews_at`
- `subscriptions` - Added: `environment`, `renewal_count`, `is_in_billing_retry`, `pending_product_id`

**Seeded data:**
- Free tier: 0 songs/month, 5 previews/day
- Plus tier: 4 songs/month, 20 previews/day, $9.99/mo or $99.99/yr
- Pro tier: 10 songs/month, unlimited previews, $14.99/mo or $149.99/yr
- Default trial: 2 songs, 7 days

## 2. Core Services (Complete)

### `src/services/plan-config.js` (445 lines)
- Manages subscription plans with 5-minute cache
- Maps App Store/Play Store product IDs to plans
- CRUD for plans and product mappings
- Trial configuration management
- Key methods: `getPlans()`, `getPlanByProductId()`, `getTrialConfig()`, `getSongAllowance()`

### `src/services/subscription-manager.js` (826 lines)
- Coordinates subscription lifecycle
- Handles: new subscriptions, renewals, trials, expiration, revocation
- Song spending logic (trial songs first, then subscription)
- Full audit trail via `song_transactions` table
- Key methods: `syncSubscription()`, `activateTrial()`, `spendSong()`, `handleExpiration()`, `handleRevocation()`

### `src/services/apple-receipt-validator.js` (528 lines)
- App Store Server API v2 integration
- JWT authentication with ES256 signing
- Transaction and subscription status lookup
- JWS decoding for Apple signed payloads
- Key methods: `verifyTransaction()`, `getSubscriptionStatus()`, `getAllSubscriptions()`

### `src/services/apple-webhook-handler.js` (707 lines)
- Handles App Store Server Notifications v2
- Idempotent processing via `notification_uuid` tracking
- All notification types: SUBSCRIBED, DID_RENEW, EXPIRED, REFUND, REVOKE, GRACE_PERIOD, etc.
- Key method: `processNotification(signedPayload)`

## 3. API Routes (Complete in src/server.js)

Added ~400 lines of billing API routes:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/billing/receipt/apple` | POST | Validate receipt and sync subscription |
| `/billing/webhook/apple` | POST | Process App Store webhooks |
| `/billing/subscription` | GET | Get current subscription status |
| `/billing/entitlements` | GET | Get user's song balance and tier |
| `/billing/trial/activate` | POST | Start free trial |
| `/billing/plans` | GET | List available subscription plans |
| `/billing/plan/:planId` | GET | Get single plan details |

## 4. Test Coverage (Complete)

**Test files created:**
- `test/plan-config.test.js` (11,160 bytes) - Plan service tests
- `test/subscription-manager.test.js` (9,224 bytes) - Subscription lifecycle tests
- `test/apple-receipt-validator.test.js` (5,220 bytes) - Receipt validation tests
- `test/apple-webhook-handler.test.js` (22,432 bytes) - Webhook handler tests
- `test/billing-api.test.js` (12,956 bytes) - API endpoint tests

All tests passing with node:test framework.

</work_completed>

<work_remaining>

## High Priority (Required for MVP)

### 1. Missing Database Table: `purchase_receipts`
The `subscription-manager.js` writes to `purchase_receipts` table (line 191-213) but this table is NOT in any migration file. Need to add:
```sql
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  transaction_id TEXT NOT NULL UNIQUE,
  original_transaction_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  expires_date TEXT,
  is_trial INTEGER DEFAULT 0,
  is_upgrade INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_purchase_receipts_user ON purchase_receipts(user_id);
CREATE INDEX idx_purchase_receipts_transaction ON purchase_receipts(transaction_id);
```

### 2. Integrate Song Spending into Track Rendering
File: `src/workflows/runner.js` or `src/server.js`
- Call `subscriptionManager.spendSong(userId, trackId)` when full render completes
- Currently the system has billing holds but needs to actually deduct songs

### 3. Preview Rate Limiting Based on Tier
- Free tier: 5 previews/day
- Plus tier: 20 previews/day
- Pro tier: Unlimited (-1)
Need to check `preview_count_today` against tier limits before allowing preview renders

### 4. Environment Variables Documentation
Add to README or .env.example:
```
APPLE_APP_STORE_KEY_ID=       # Key ID from App Store Connect
APPLE_APP_STORE_ISSUER_ID=    # Issuer ID from App Store Connect
APPLE_APP_STORE_PRIVATE_KEY=  # Contents of .p8 file
APPLE_BUNDLE_ID=              # App bundle identifier
APPLE_ENVIRONMENT=production  # or "sandbox" for testing
```

## Medium Priority (Post-MVP)

### 5. Google Play Billing Integration
- Create `google-receipt-validator.js` service
- Create `google-webhook-handler.js` service
- Add `/billing/receipt/google` endpoint
- Add `/billing/webhook/google` endpoint

### 6. Subscription Upgrade/Downgrade Flow
- Handle `pending_product_id` for plan changes at renewal
- Pro-rate song grants for mid-cycle upgrades
- UI for managing subscription tier

### 7. Admin API for Plan Management
- PUT `/admin/plans/:id` - Update plan pricing/limits
- PUT `/admin/trial` - Update trial configuration
- POST `/admin/plans/:id/products` - Add product mappings

### 8. Daily Preview Count Reset Job
- Reset `preview_count_today` column at midnight user local time
- Or add `preview_count_reset_at` timestamp and reset on first daily access

## Low Priority (Future)

### 9. Webhook Retry Queue
- Handle failed webhook processing
- Retry with exponential backoff
- Dead letter queue for persistent failures

### 10. Subscription Analytics
- Churn tracking
- Conversion rates (trial → paid)
- Revenue metrics

</work_remaining>

<attempted_approaches>

## What Worked

1. **Song-based model over credits** - Simpler for users to understand "4 songs per month" vs abstract credits
2. **Trial songs in separate column** - `trial_songs_remaining` separate from `songs_remaining` allows trial songs to be consumed first
3. **Idempotent webhook processing** - `notification_uuid` tracking prevents duplicate processing
4. **JWS decoding without full verification** - For development, decode payload without Apple certificate chain verification
5. **5-minute cache for plan config** - Reduces database queries for frequently accessed plan data

## Decisions Made

1. **Keep `credits_*` columns for backward compatibility** - Sync `credits_balance` with `songs_remaining` during transition
2. **Songs never expire (except trial)** - Unused subscription songs roll over (no `songs_expires_at` column)
3. **Trial prevents subscription song grant** - During trial period, `syncSubscription` grants 0 songs to avoid double-granting
4. **Revocation removes current period songs only** - `handleRevocation` removes up to `songs_allowance`, not entire balance

## Not Yet Attempted

1. Google Play RTDN (Real-Time Developer Notifications) - Completely separate webhook format
2. Signature verification using Apple's certificate chain - Using basic JWS decode for now
3. StoreKit 2 original application version tracking - Not needed for MVP

</attempted_approaches>

<critical_context>

## Architecture Decisions

1. **Service pattern** - Each service is a factory function (`createXxxService(db, options)`) returning methods
2. **Transaction support** - `db.transaction(async (query) => {...})` for atomic multi-table operations
3. **Audit-first design** - All song balance changes logged to `song_transactions` table

## Key Code Locations

| Concern | File:Line |
|---------|-----------|
| Song spending priority | `subscription-manager.js:577-637` (trial first) |
| Plan-to-product mapping | `plan-config.js:123-158` |
| Webhook idempotency | `apple-webhook-handler.js:105-134` |
| JWT generation for Apple | `apple-receipt-validator.js:72-118` |
| API routes initialization | `server.js:85-106` (service setup) |
| Billing endpoints | `server.js:3313-3720` |

## Environment Requirements

- Node.js with native `fetch` (Node 18+)
- SQLite via sql.js (dev) or PostgreSQL (production)
- Apple App Store Connect API credentials for receipt validation
- Webhook endpoint must be publicly accessible for Apple callbacks

## Test Execution

```bash
npm test -- test/plan-config.test.js
npm test -- test/subscription-manager.test.js
npm test -- test/apple-receipt-validator.test.js
npm test -- test/apple-webhook-handler.test.js
npm test -- test/billing-api.test.js
```

## Known Edge Cases

1. **Webhook before app receipt** - When SUBSCRIBED webhook arrives before app calls `/billing/receipt/apple`, no user association exists. Current behavior: log and defer
2. **Multiple active subscriptions** - `getActiveSubscription` returns most recent. Consider handling family sharing scenarios
3. **Sandbox vs Production** - `environment` column tracks this; use `APPLE_ENVIRONMENT` config for API endpoint selection

## Spec Reference

See `specs/personalized-song-platform-spec.md` sections:
- §7.2 Subscription Tiers
- §7.3 Billing Integration
- §7.4 Entitlement Management

</critical_context>

<current_state>

## Git Status

**Modified (unstaged):**
- `src/server.js` - Added 427 lines (billing routes + service initialization)

**Untracked (new files):**
- `migrations/017_song_based_subscriptions.sql`
- `migrations/018_add_subscription_billing_columns.sql`
- `src/services/apple-receipt-validator.js`
- `src/services/apple-webhook-handler.js`
- `src/services/plan-config.js`
- `src/services/subscription-manager.js`
- `test/apple-receipt-validator.test.js`
- `test/apple-webhook-handler.test.js`
- `test/billing-api.test.js`
- `test/plan-config.test.js`
- `test/subscription-manager.test.js`

## Completion Status

| Component | Status |
|-----------|--------|
| Database schema | ✅ Complete |
| Plan config service | ✅ Complete |
| Subscription manager | ✅ Complete |
| Apple receipt validator | ✅ Complete |
| Apple webhook handler | ✅ Complete |
| Billing API routes | ✅ Complete |
| Unit tests | ✅ Complete |
| `purchase_receipts` table | ❌ MISSING - add migration |
| Song spending integration | ❌ Not wired up |
| Preview rate limiting | ❌ Not implemented |
| Google Play integration | ❌ Not started |

## Immediate Next Step

Create migration `019_add_purchase_receipts.sql` with the `purchase_receipts` table schema, or add it to migration 017. Then run migrations and verify tests still pass.

</current_state>
