# App Store Connect Setup & Verification

## Subscription Group Configuration

### 1. Create Subscription Group

In App Store Connect > your app > Subscriptions:

1. Create subscription group: **Porizo Premium**
2. Set group display name for all localizations

### 2. Create Products

Create these auto-renewable subscriptions inside the group:

| Product ID | Reference Name | Duration | Tier |
|------------|---------------|----------|------|
| `com.porizo.plus_monthly` | Plus Monthly | 1 Month | Plus |
| `com.porizo.plus_annual` | Plus Annual | 1 Year | Plus |
| `com.porizo.pro_monthly` | Pro Monthly | 1 Month | Pro |
| `com.porizo.pro_annual` | Pro Annual | 1 Year | Pro |

If gift-token purchase is user-reachable in the current build, also create this consumable:

| Product ID | Reference Name | Type |
|------------|----------------|------|
| `com.porizo.gift_token_oneoff` | Gift Token (1) | Consumable |

### 3. Subscription Group Ordering

Order determines upgrade/downgrade/crossgrade behavior. Higher rank = higher tier.

**Required order (top to bottom):**
1. `com.porizo.pro_annual` (Level 1 - highest)
2. `com.porizo.pro_monthly` (Level 1 - same rank as annual)
3. `com.porizo.plus_annual` (Level 2)
4. `com.porizo.plus_monthly` (Level 2 - same rank as annual)

Products at the same level are crossgrades (no proration). Moving from Level 2 to Level 1 is an upgrade (immediate). Level 1 to Level 2 is a downgrade (takes effect at next renewal).

### 4. Pricing

Set pricing in each product's Pricing section. The backend `subscription_plans` table stores reference prices in cents but the actual price shown to users comes from StoreKit.

### 5. Metadata Completeness

Each submitted product requires:
- [x] Display name (localized)
- [x] Description (localized)
- [x] Promotional image (optional but recommended)
- [x] Review screenshot (required for first submission)
- [x] Review notes explaining the subscription

### 6. Introductory Offers (Optional)

If offering a free trial:
- Set offer type: Free Trial
- Duration: 7 days (matches backend `trial_config.duration_days`)
- Eligibility: New subscribers only

## Server-Side Configuration

### App Store Server API

Required environment variables for receipt validation:

```env
APPLE_APP_STORE_KEY_ID=<from ASC Keys page>
APPLE_APP_STORE_ISSUER_ID=<from ASC Keys page>
APPLE_APP_STORE_PRIVATE_KEY=<contents of .p8 file>
APPLE_BUNDLE_ID=com.porizo.PorizoApp
```

Generate the key at App Store Connect > Users and Access > Integrations > In-App Purchase.

### Server Notifications v2

Configure webhook URL in ASC:
- URL: `https://api.porizo.co/billing/webhooks/apple`
- Version: v2

This catches subscription lifecycle events (renewals, cancellations, billing retries) that might otherwise be missed.

## Verification Checklist

Before each TestFlight submission:

```bash
# 1. Verify product IDs match between backend DB and ASC
NODE_ENV=test node tools/verify-asc-products.js

# 2. Verify against production DB
NODE_ENV=production node tools/verify-asc-products.js
```

### Manual Verification

1. **ASC Product Status**: All 4 products should show "Ready to Submit" or "Approved"
2. **Subscription Group Order**: Pro products above Plus products
3. **Sandbox Testing**: Create a sandbox tester account in ASC > Users and Access > Sandbox
4. **Environment Handling**: Backend auto-falls back between production and sandbox APIs

### Runtime Preflight (Staging/Production)

Run this before TestFlight rollout to validate deployed runtime billing config:

```bash
API_BASE_URL=https://api.porizo.co \
ADMIN_EMAIL=<admin-email> \
ADMIN_PASSWORD=<admin-password> \
EXPECTED_APPLE_BUNDLE_ID=porizo.ios.app.PorizoApp \
npm run preflight:subscriptions
```

This verifies:
- Runtime `APPLE_BUNDLE_ID` matches expected app bundle
- Apple receipt validator is configured
- Active paid plans have Apple monthly/annual product mappings
- Apple product IDs are not duplicated across plans

## Sandbox Testing

1. Sign out of App Store on test device (Settings > Media & Purchases > Sign Out)
2. In the app, trigger a purchase - iOS will prompt for sandbox credentials
3. Use sandbox tester account created in ASC
4. Sandbox subscriptions auto-renew at accelerated rates (monthly = every 5 min)
5. Check backend logs for receipt validation: `[Billing] Apple receipt validation`

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Products not loading | Product IDs mismatch | Run `verify-asc-products.js` |
| "Product not available" | Agreements not signed | Check ASC Agreements page |
| Receipt validation 404 | Wrong environment | Backend auto-falls back prod<->sandbox |
| Subscription not syncing | Webhook not configured | Set v2 webhook URL in ASC |
