# Monetization Design: Pay-per-Song with Subscription Upsell

**Date:** 2026-03-27
**Status:** Design approved, ready for implementation
**Branch:** version3

---

## Model

```
User Lifecycle:
  Sign up → credits_balance = 1 (free song grant)

  FIRST SONG (free):
    Chat → Voice → Lyrics → Preview → Full Render → Share
    credits_balance: 1 → 0

  SECOND SONG (paywall):
    Chat → [PAYWALL] → Voice → Lyrics → Preview → Full Render → Share
    Paywall shows: Subscribe (primary) / Buy tokens (secondary)
```

**Rules:**
- New users get `credits_balance = 1` on account creation (1 free song)
- Each song creation (preview + full render) costs 1 credit
- The paywall appears when a user with 0 credits tries to start a new song
- Plus subscribers: 10 songs + 10 poems per month
- Pro subscribers: 20 songs + 20 poems per month
- Token purchases add to `credits_balance` (on top of subscription allowance)
- The credit is deducted at song creation start (not at full render) via existing `billing_holds` mechanism

## Products (existing in StoreKit)

| Product | ID | Type | Price |
|---------|----|----|-------|
| Plus Monthly | `com.porizo.plus_monthly` | Auto-renewable | $9.99/mo |
| Plus Annual | `com.porizo.plus_annual` | Auto-renewable | $99.99/yr |
| Pro Monthly | `com.porizo.pro_monthly` | Auto-renewable | $14.99/mo |
| Pro Annual | `com.porizo.pro_annual` | Auto-renewable | $149.99/yr |
| Single Token | `com.porizo.gift_token_oneoff` | Consumable | $2.99 |
| 3-Song Bundle | `com.porizo.gift_bundle_3` | Consumable | $5.99 |
| 5-Song Bundle | `com.porizo.gift_bundle_5` | Consumable | $7.99 |

**Plus limits:** 10 songs + 10 poems per month. All occasions and music styles.
**Pro limits:** 20 songs + 20 poems per month. All occasions and music styles. Priority rendering.

## Paywall UX

**Trigger:** User taps "Create Song" or "Create Poem" with `credits_balance == 0` AND no active Plus subscription.

**Location:** Inside MainTabView, before launching the creation flow. The paywall is the SubscriptionView (existing), enhanced with token purchase options.

**Layout:**
```
┌──────────────────────────────────────────┐
│  ← Back                                 │
│                                          │
│         🎵                               │
│   Keep Creating Songs                    │
│   Make unlimited personalized songs      │
│   for every special occasion.            │
│                                          │
│  ┌── PORIZO PLUS ──────────────────────┐ │
│  │  ✓ 10 songs per month               │ │
│  │  ✓ 10 poems per month               │ │
│  │  ✓ All occasions & music styles     │ │
│  │                                     │ │
│  │  Monthly    Annual (save XX%)       │ │
│  │  [$X.XX]    [$XX.XX]               │ │
│  │                                     │ │
│  │  [  Subscribe — gold CTA button  ]  │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ─── or buy individual songs ──────────  │
│                                          │
│  [1 Song — $2.99]                        │
│  [3 Songs — $5.99]  [5 Songs — $7.99]   │
│                                          │
│  Restore Purchases                       │
└──────────────────────────────────────────┘
```

**After purchase:**
- Subscription: dismiss paywall, launch creation flow, `entitlements.tier = "plus"`
- Token: dismiss paywall, launch creation flow, `credits_balance += N`

## Backend Changes

### 1. Free credit grant on signup
In `ensureUser()` (src/server.js), when creating the entitlements row:
```sql
INSERT INTO entitlements (user_id, tier, credits_balance, ...)
VALUES (?, 'free', 1, ...)
```

### 2. Credit check before creation
In the creation flow start (either in the iOS client before launching the flow, or in `POST /story/start`):
```
IF entitlements.tier IN ('plus', 'pro'):
    check songs_used_this_month < songs_per_month (10 for Plus, 20 for Pro)
ELSE IF entitlements.credits_balance > 0:
    allow (deduct via billing_hold)
ELSE:
    show paywall (HTTP 402 or client-side check)
```

**Recommendation:** Client-side check. The iOS app reads entitlements from `/app/config` or a dedicated `/entitlements` endpoint, and shows the paywall before making any API call. This avoids wasted server-side work.

### 3. Token purchase webhook
App Store Server Notifications (or StoreKit 2 transaction listener) → increment `credits_balance`:
- `gift_token_oneoff`: +1
- `gift_bundle_1`: +1
- `gift_bundle_3`: +3
- `gift_bundle_5`: +5

The StoreKit listener already exists in `StoreKitManager.swift` (line 324+). Wire it to call a backend endpoint like `POST /billing/redeem-purchase` with the transaction ID.

### 4. Subscription verification
The StoreKit listener already handles subscription state. Wire subscription validation to update `entitlements.tier = 'plus'` on the backend. On expiry, revert to `tier = 'free'`.

## iOS Changes

### 1. Paywall gate in MainTabView
Before launching the creation flow in `.fullScreenCover`:
```swift
if storeKit.subscriptionState.tier != "free" || storeKit.credits > 0 {
    // Launch creation flow
} else {
    // Show paywall (SubscriptionView)
    activeSheet = .upgrade
}
```

### 2. Enhanced SubscriptionView
Add token purchase section below the subscription card. Use the existing `storeKitManager.purchase()` method for consumables.

### 3. Credits display
Show remaining credits in the profile/settings tab: "1 song remaining" or "Porizo Plus — Unlimited".

## Metrics to Track

| Event | When |
|-------|------|
| `paywall_shown` | User hits paywall |
| `paywall_dismissed` | User backs out without purchase |
| `purchase_started` | User taps Subscribe or Buy Tokens |
| `purchase_completed` | Transaction succeeds |
| `purchase_failed` | Transaction fails |
| `first_song_completed` | Free song fully rendered |
| `first_song_shared` | Free song share link generated |

## What This Does NOT Include

- Pro tier (deferred — launch with Plus only)
- Referral credits (deferred — "invite a friend, get a free song")
- Family sharing (deferred)
- Promotional pricing (deferred — App Store offers can be added later)
- Android (iOS only for now)
