# Implementation Spec — Pay-Per-Song as the Paywall Face

**Date:** 2026-06-04 · Goal: make one-off **pay-per-song** the hero of the live paywall (`SubscriptionViewV2`), subscription + gift demoted.

> ## ⚠️ APPROACH UPDATED 2026-06-04 — REUSE bundle_1, no new SKU
>
> Per Ambrose: **don't create new products** — `gift_bundle_1` already _is_ "1 song." Reuse the existing (approved) gift bundles as the pay-per-song products. This **supersedes** the "create `song_bundle_*` SKU + new song-consumable endpoint" sections below (kept for reference only).
>
> **DONE (2026-06-04):** Repriced in ASC + synced DB — `gift_bundle_1` **$1.99** (the face), `gift_bundle_3` **$4.99**, `gift_bundle_5` **$7.99**; DB `gift_bundles`/`subscription_plans` reconciled (Plus $6.99, Pro $14.99). ASC ⇄ DB verified equal.
>
> **The real remaining build (replaces the "new SKU" wiring):**
>
> 1. **Create flow consumes the one-off pool.** Today the create flow checks/consumes only `entitlements.songs_remaining`. Change the entitlement check (`checkEntitlementsForSong` / `getEntitlements`) and consumption to count **`songs_remaining` (ongoing) + `gift_wallet.balance` (one-off)** — spend `songs_remaining` first, then a `gift_wallet` token. This is what makes buying `gift_bundle_1` actually let you _make_ a song. **(Open: confirm with Ambrose that gift tokens are spendable on make-your-own, not gift-only.)**
> 2. **Expose `gift_wallet_balance`** in `buildEntitlementsPayload` (billing.js) so the app shows total available one-off credits.
> 3. **V2 paywall hero** purchases `gift_bundle_1` via the **existing** `syncAppleGiftConsumable` path (→ `gift_wallet`) — no new endpoint. (§Phase 2 below still applies for the UI.)
> 4. (Optional) Rename ASC display name + DB `display_name` "Gift Bundle N" → "N Song(s)".
>
> Two-ledger model (confirmed): **one-off = `gift_wallet`** (bundles), **ongoing = `songs_remaining`** (subscription + trial); both spendable to make a song.

---

## Phase 0 — Prerequisites (manual, blocking)

**Verified live USD prices via `asc` CLI (2026-06-04):** Plus $6.99/mo · Pro $14.99/mo · Gift Bundle 1/3/5 = $2.99/$5.99/$7.99 · legacy `gift_token_oneoff` $2.99 (inactive). All APPROVED, base territory USA. **The DB was stale** ($4.99/$12.99/$17.99) — not the real prices.

1. **Create 3 NEW consumable IAPs in ASC** (the only new products; real charged price, app shows StoreKit's localized price):
   - `com.porizo.song_bundle_1` — **$1.99** · `song_bundle_3` — **$4.99** · `song_bundle_5` — **$7.99**
   - Type: **Consumable** (credit `songs_remaining`). Via `asc iap setup --app 6758205028 --type CONSUMABLE --product-id ... --price 1.99 --base-territory "United States"`.
2. **Leave existing IAP prices unchanged in ASC.** Gift bundles stay $2.99/$5.99/$7.99 (the +$1 vs pay-per-song = "delivery premium"); subs stay $6.99/$14.99 (already a clear per-song discount). Retire legacy `gift_token_oneoff` (mark unavailable — confusing name).
3. Confirm the new pay-per-song price ($1.99) before creating products.

---

## Phase 1 — The pay-per-song SKU (backend + iOS wiring)

All file:line targets verified against current code.

### 1.1 Migration — `song_bundles` table

New: `migrations/pg/116_song_bundles.sql` (+ SQLite mirror `migrations/116_song_bundles.sql`). Mirror of `gift_bundles`:

```sql
CREATE TABLE IF NOT EXISTS song_bundles (
  id TEXT PRIMARY KEY DEFAULT ('sb_' || substr(md5(random()::text),1,12)),
  product_id TEXT NOT NULL UNIQUE,
  song_count INTEGER NOT NULL CHECK (song_count BETWEEN 1 AND 20),
  price_cents INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL, description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT, created_at TEXT DEFAULT (NOW()::text), updated_at TEXT DEFAULT (NOW()::text)
);
INSERT INTO song_bundles (product_id, song_count, price_cents, display_name, sort_order, is_active) VALUES
  ('com.porizo.song_bundle_1', 1, 199, '1 Song',  1, 1),
  ('com.porizo.song_bundle_3', 3, 499, '3 Songs', 2, 1),
  ('com.porizo.song_bundle_5', 5, 799, '5 Songs', 3, 1)
ON CONFLICT (product_id) DO NOTHING;
```

`price_cents` is display/reference only — must mirror ASC. Apply via `railway connect postgres` (auto-applies on boot too).

### 1.2 Backend — `src/services/subscription-manager.js`

- Add `SONG_PURCHASE: "song_purchase"` to `TRANSACTION_TYPES` (~line 46).
- Add `grantSongPack(userId, amount, receiptId, source)` and `grantSongPackInTransaction(query, userId, amount, receiptId, source)` alongside `adminGrantSongs` (~line 1110) — acquire user lock, increment `entitlements.songs_remaining`, `recordSongTransaction(SONG_PURCHASE)`. (Reuses the exact pattern subscription grants use.)
- Export both (~line 1551).

### 1.3 Backend — `src/routes/billing.js`

- Add `resolveSongBundle(productId)` alongside `resolveGiftBundle` (~line 204) → looks up `song_bundles`.
- Add route **`POST /billing/receipt/apple/song-consumable`** after the gift consumable route (~line 540). Near-exact mirror of `/billing/receipt/apple/consumable` (lines 303–540), differing only: dedup on `song_transactions`, credit via `grantSongPackInTransaction`, audit/event `song_pack_purchased`, response `{ success, already_processed, songs_remaining }`. Keep the same idempotency + reconcile-on-existing-receipt logic.

### 1.4 iOS — `StoreKitManager.swift`

- `ProductID` enum (~line 47): add `songBundle1/3/5` (`com.porizo.song_bundle_1/3/5`); add `isSongBundleProduct`; branch `tier`→"song", `billingPeriod`→"one_time".
- `syncTransaction` (line 502): add `else if pid.isSongBundleProduct { apiClient.syncAppleSongConsumable(...) }` between the gift and default branches.
- Add `syncPendingSongTransactions()` (mirror `syncPendingGiftTransactions`) and `songBundleProducts` computed var (mirror `giftBundleProducts`).

### 1.5 iOS — `APIClient+Gifts.swift` + `Models/BillingModels.swift`

- Add `syncAppleSongConsumable(transactionId:)` → `POST /billing/receipt/apple/song-consumable`, idempotency key `apple_song_consumable_<user>_<txn>`, 5-retry (mirror `syncAppleGiftConsumable`).
- Add `SongConsumableSyncResponse { success, already_processed, songs_remaining }`.
- No entitlements-payload change: `buildEntitlementsPayload` already returns `songs_remaining` (billing.js:120).

---

## Phase 2 — Make it the paywall FACE (`SubscriptionViewV2.swift`)

The live paywall (cream, "Subscription", Free/Plus/Pro cards, SAVE 40%) has **no one-off purchase today**. Add it as the hero.

- **Insert `songPackSection`** in the ScrollView VStack **between `creditsLabel` (~line 47) and `billingToggle` (~line 48)** — so it's the first thing below the credits line, above the subscription toggle/cards.
- **Design (refine, not redesign):** match the existing V2 card styling (cream cards, coral accents, Fraunces). Reuse the visual pattern of V1's `tokenPurchaseSection` (1/3/5 rows with coral "Buy" pills) but as the **hero**: a prominent "$1.99 — Make this song" primary, with 3-for-$4.99 / 5-for-$7.99 as smaller anchors. Pull prices from `storeKit.songBundleProducts` (StoreKit localized price — never hardcode).
- **Demote subscriptions:** keep the Free/Plus/Pro cards + billing toggle, but under a quieter header "**or subscribe & save**". No structural removal.
- **Personalize:** thread `recipientName: String?` from `WarmCanvasFlowView.swift:1049` into `SubscriptionViewV2`; hero copy "Make **{recipientName}**'s song — $1.99" when present.
- **Add `purchaseSongPack(_ product:)`** (mirror `purchasePlan`) → `storeKit.purchase(product)` directly.
- **`NoCreditsView`** (`WarmCanvasFlowView.swift:951–967`): CTA "Upgrade" → "Make {recipientName}'s song · $1.99", routing to the same paywall.

---

## Phase 3 — Price propagation (verified USD)

1. **ASC** — add only the 3 new `song_bundle_*` consumables ($1.99/$4.99/$7.99). Existing prices unchanged.
2. **DB reconcile to ASC** (DB is stale): `song_bundles` (new, 199/499/799); `gift_bundles.price_cents` → **299/599/799** (real, was wrong at 499/1299/1799); `subscription_plans` → Plus **699**, Pro **1499**. Display/gating only; never diverge from ASC.
3. **Website** (porizo.co) — pricing copy to match.

---

## Phase 4 — Flag, tests, measurement

- **Feature flag** `paywall_pay_per_song_enabled` (default off) gating the `songPackSection` + the create-entry framing, for a clean A/B.
- **Tests:**
  - Backend: song-consumable route — happy path credits `songs_remaining`; idempotent replay (same txn → `already_processed`, no double credit); cross-user conflict 409; reconcile when receipt exists but no `song_transactions` row; invalid product 400. Mirror the gift-consumable test file.
  - iOS: `syncTransaction` routes song product to the song endpoint; `songBundleProducts` filters/sorts correctly.
- **Measurement** (daily_aggregates is broken — Issue 9a): track from `purchase_receipts` (product_id LIKE 'com.porizo.song_bundle%'), `song_transactions` (type='song_purchase'), and `events` (`song_pack_purchased`). Primary metric: **paywall view → song purchase conversion**; secondary: AOV (1 vs 3 vs 5 mix).

---

## Sequencing

1. Phase 0 (ASC products) — start now; review lag is the long pole.
2. Phase 1 (SKU wiring) — buildable immediately in parallel with Phase 0.
3. Phase 2 (V2 hero) — after 1.
4. Ship behind flag; enable for the test.
5. **Then** the viral-loop A+B+C + onboarding/reveal copy refinements (separate spec, see `porizo-monetization-viral-decisions-2026-06.md` §F–I) — these compound the funnel but the monetization test can run first.

## Open items

1. **Final price confirm** (esp. Pro $22.99→$14.99) before creating ASC products.
2. ASC consumable products must be **Approved** before the test can run (Phase 0 lead time).
3. Decide: enable the flag for 100% or a % A/B vs the current subscription-first paywall.
