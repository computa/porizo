# Gift Prepay-First Flow Plan (Song/Poem Gifts)

## Goal

Enforce **payment before content creation** for gift flow:

- User must spend (reserve) one gift token before opening Song/Poem creation for gifting.
- Final gift scheduling/sending consumes the reservation, not another debit.
- Abandoned flows auto-refund safely.

## Current Gaps (with evidence)

1. Payment is currently late in flow:
   - Create actions are available immediately: `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift:230`
   - Buy token appears only on review step: `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift:397`
2. Backend `/gifts` order is non-atomic:
   - Share token setup runs before wallet debit: `src/routes/gifts.js:114`, debit at `src/routes/gifts.js:134`
   - Risk: orphan gift-share mutations when debit fails.
3. Idempotent API shape mismatch:
   - `/gifts` idempotent branch omits `wallet_balance`: `src/routes/gifts.js:97`
   - iOS decoder requires it: `PorizoApp/PorizoApp/Models/GiftModels.swift:162`
4. Client does not get gift availability flags from `/app/config`:
   - only `show_design_screens`, `my_voice_enabled` returned: `src/services/admin-service.js:2039`

## Target Design

### Core decision

Adopt **token reservation** before creation:

- Reserve (debit) one token at flow entry/first create intent.
- Hold reservation while user creates content + configures recipient/delivery.
- Finalize gift using reservation.
- Cancel/expire reservation returns token.

This avoids “pay late” behavior and prevents wallet race conditions during finalize.

## API Changes

### 1) Reserve token (prepay)

`POST /gifts/reservations`

Request:

```json
{
  "flow_type": "gift",
  "idempotency_key": "gift_reserve_ios_<uuid>"
}
```

Response `200`:

```json
{
  "reservation": {
    "id": "gres_xxx",
    "status": "reserved",
    "expires_at": "2026-02-24T12:00:00.000Z",
    "token_transaction_id": "gwtx_xxx",
    "content_type": null,
    "content_id": null,
    "version_num": null
  },
  "wallet_balance": 0
}
```

Errors:

- `402 INSUFFICIENT_GIFT_TOKENS`
- `409 RESERVATION_ALREADY_ACTIVE` (optional if we enforce one active reservation/user)

### 2) Attach created content to reservation

`POST /gifts/reservations/:id/content`

Request:

```json
{
  "content_type": "song",
  "content_id": "track_id_or_poem_id",
  "version_num": 3
}
```

Response `200`: updated reservation with `status: "content_ready"`.

Errors:

- `404 RESERVATION_NOT_FOUND`
- `409 RESERVATION_NOT_EDITABLE`
- `409 TRACK_NOT_READY` / `409 POEM_NOT_READY`

### 3) Finalize reservation into gift order

`POST /gifts/reservations/:id/finalize`

Request:

```json
{
  "delivery_mode": "immediate",
  "sender_timezone": "America/New_York",
  "channels": ["sms", "email"],
  "recipient_phone": "+12025550123",
  "recipient_email": "recipient@example.com",
  "message": "Happy birthday",
  "send_at": "2026-02-25T10:00:00.000Z",
  "expires_in_days": 30,
  "idempotency_key": "gift_finalize_ios_<uuid>"
}
```

Response `200`:

```json
{
  "gift": { "...": "renderGiftSummary" },
  "wallet_balance": 0
}
```

### 4) Cancel reservation (manual refund)

`POST /gifts/reservations/:id/cancel`

Response `200`:

```json
{
  "cancelled": true,
  "reservation": { "...": "cancelled" },
  "wallet_balance": 1
}
```

## Data Model / Migration

Add table `gift_reservations` in both:

- `migrations/058_gift_reservations.sql`
- `migrations/pg/058_gift_reservations.sql`

Suggested columns:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `status TEXT NOT NULL` (`reserved|content_ready|finalized|cancelled|expired`)
- `content_type TEXT`
- `content_id TEXT`
- `version_num INTEGER`
- `token_transaction_id TEXT NOT NULL`
- `refund_transaction_id TEXT`
- `gift_order_id TEXT`
- `idempotency_key TEXT`
- `expires_at TEXT NOT NULL`
- `cancel_reason TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Indexes:

- `idx_gift_reservations_user_status` on `(user_id, status, created_at DESC)`
- Unique `(user_id, idempotency_key)` where key not null
- Optional partial unique for active reservation per user (`status IN ('reserved','content_ready')`)

Wallet ledger event types to use:

- `gift_reserve` (`amount = -1`)
- `gift_reserve_refund` (`amount = +1`)

## Backend Implementation Plan

### A) Route layer

File: `src/routes/gifts.js`

1. Add reservation endpoints listed above.
2. Keep existing `POST /gifts` for backward compatibility; if new FF `gift_prepay_enforced=true`, reject direct create without reservation.
3. Normalize response shape so all gift create/finalize responses include `wallet_balance`.

### B) Atomic finalize

Implement finalize in `db.transaction(...)`:

1. Lock/read reservation.
2. Validate ownership + status + not expired.
3. Build/attach share token (song/poem) inside same transaction context.
4. Insert `gift_orders` row using reservation `token_transaction_id`.
5. Mark reservation `finalized`.
6. Commit.

Refactor share helper functions to support transaction query context:

- `ensureTrackGiftShareToken(...)`
- `ensurePoemGiftShareToken(...)`

### C) Reservation expiry worker

Add periodic job (similar pattern to gift dispatch job):

- Find expired `reserved|content_ready` reservations.
- Refund if no existing `refund_transaction_id` (idempotent key: `gift_reserve_refund_<reservation_id>`).
- Mark `status='expired'`.

### D) App config flags

Expose these in `/app/config` payload:

- `gift_scheduling_enabled`
- `gift_prepay_enforced`

Update `src/services/admin-service.js:getAppConfig()` and iOS `ClientFlags`.

## iOS Implementation Plan

### Files

- `PorizoApp/PorizoApp/Models/GiftModels.swift`
- `PorizoApp/PorizoApp/APIClient+Gifts.swift`
- `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift`

### Flow/state changes

New state:

- `reservation: GiftReservation?`
- `isReserving: Bool`

New behavior:

1. On first create intent:
   - If no reservation: call reserve endpoint.
   - If wallet=0: show Buy token CTA, sync consumable, then reserve.
2. Disable create buttons until reservation exists.
3. After create completes, call attach-content endpoint.
4. Replace current `createGift` call with `finalizeReservation`.
5. On flow cancel/dismiss before finalize:
   - call `cancelReservation` best-effort.

UI copy changes:

- Content step card:
  - “1 gift token is required before creating gift content.”
  - When reserved: “1 token reserved for this gift.”
- Remove review-step buy CTA (payment has already happened).

## Test Plan

### Backend

Extend `test/gifts.test.js`:

1. Reserve creates ledger debit once (idempotent).
2. Cannot create content/finalize without active reservation when `gift_prepay_enforced`.
3. Finalize succeeds and does not double-debit.
4. Cancel reservation refunds token once.
5. Expired reservation auto-refunds once.
6. Concurrency: two reserve attempts with one token => exactly one success.
7. Response contract always includes `wallet_balance`.

### iOS

1. No token -> cannot open create flow until reserve succeeds.
2. Buy token + reserve path works.
3. Dismiss mid-flow returns reservation token.
4. Finalize path returns success with expected wallet balance.

## Rollout

1. Deploy backend with new endpoints + migration + compatibility mode.
2. Ship iOS client using reservation flow.
3. Enable FF `gift_prepay_enforced` after client adoption threshold.
4. Monitor metrics:
   - `gift_reserve_created`
   - `gift_reserve_cancelled`
   - `gift_reserve_expired`
   - `gift_finalize_success`
   - `gift_finalize_fail`

## Risks / Mitigations

1. Abandoned reserved tokens:
   - Mitigation: expiry worker + user-visible timeout.
2. Backward compatibility:
   - Mitigation: FF-gated enforcement for old clients.
3. Orphan share state:
   - Mitigation: transactional finalize and add orphan cleanup script for existing data.
