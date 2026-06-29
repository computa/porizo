# Gift + Subscription Flow — Case Study & Fixes (2026-06-29)

**Trigger:** Arlene Leahy (`erin.arlene122@gmail.com`, `user_4abd41bea`) bought a
$4.99 gift bundle (`com.porizo.gift_bundle_3`, +3 credits) on Jun 27. Question:
credited? song created? delivered? Used as a case study for the whole gift +
subscription path.

## Arlene — verified from production

| Question                 | Answer | Evidence                                                                                                                         |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Credited?                | ✅ Yes | `gift_purchase +3`, balance 0→3, `apple_consumable`, receipt `com.porizo.gift_bundle_3`                                          |
| Created a song?          | ✅ Yes | track `13cbaea1` "A Thank You Song for Autom", `full_ready`                                                                      |
| Song gift-funded?        | ❌ No  | `funding_source = standard`, `gift_reservation_id = NULL` — made the normal/free way at 03:53, BEFORE buying the bundle at 05:57 |
| Delivered?               | ❌ No  | share token `8PqtUl3yKN` is `unbound` — never claimed                                                                            |
| Used the 3 gift credits? | ❌ No  | 3 reservations, ALL empty (no content), all expired/cancelled → auto-refunded. Balance still 3.                                  |

Her ledger: `gift_purchase +3` → 3× (`gift_reserve −1` → `gift_reserve_refund +1`).
All 3 reservations: `content_type`/`content_id` **empty**, `reservation_expired`/`user_cancelled`.

## Systemic funnel (ALL gift buyers, production)

- **6** users bought gift credits.
- **15** reservations made — **0 with content attached** (9 cancelled, 6 expired).
- **1** reservation ever finalized (the only completed gift in the product's history).
- **→ ~94% of gift reservations die at the "attach content" step; ~83% of paying gift buyers never sent a single gift.**

Track funding distribution: **266 `standard`** + **1 `gift_wallet`**. Of 88 ready
standard songs, **0 are linked to any gift reservation.**

## Root cause (verified in code)

The gift flow is: `POST /gifts/reservations` (reserve credit) →
`POST /gifts/reservations/:id/content` (attach song) →
`POST /gifts/reservations/:id/finalize` (create `gift_order` + dispatch).

**The song users make never gets linked to their reservation.** Two contributing defects:

1. **Lifecycle race (gift-funded path).** A gift-funded track is created as a
   `draft` with no rendered `track_versions` URL (`story.js:4143`). Both `/content`
   (`validateGiftContent`, `gifts.js:324-328`) and `/finalize` hard-require
   `preview_url || full_url` → throw `TRACK_NOT_READY`. The reservation TTL is **45
   min** (`gifts.js:51`), racing an async render. `reconcileReservationContentIfNeeded`
   (`gifts.js:439`) marks a still-draft track `content_ready` with no readiness
   check, so the UI can show "ready to send" while `/finalize` rejects it.

2. **Linkage gap (standalone path — Arlene's mode, the dominant one).** Users
   overwhelmingly create songs the standard way (266 vs 1). `/content` _will_ accept
   any owned, rendered song (`validateGiftContent` checks ownership + rendered, NOT
   funding source) — but in practice the client never calls `/content` with the
   existing song's id, so 88 ready standard songs sit unattached while reservations
   expire empty next to them.

The credit auto-refunds on expiry (`refundReservationTokenIfNeeded`, `gifts.js:378`),
so this is a **conversion/abandonment leak, not a money-loss leak** — but it kills
~94% of gift sends.

## Twilio / Resend delivery — verified configured

Production env (Railway): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_PHONE_NUMBER (+17405357070)`, `TWILIO_STATUS_CALLBACK_BASE_URL`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` — **all SET.**
Dispatch code (`sendGiftSmsViaTwilio`, `server.js:2831`) is wired and throws
`SMS_NOT_CONFIGURED` only if env missing (it isn't). **Delivery infra works; the
problem is upstream — users never reach the dispatch step.** Only 0 gift_orders +
0 outbox rows for Arlene; 1 order total in the whole system.

## Secondary issue found en route

`gift_unknown_receipt` incidents: **2,576 open**, Apr 10 → today. The Resend webhook
routes EVERY email event through `applyGiftDeliveryReceipt`; non-gift mail
(cold-email/nurture/transactional) finds no gift outbox row → raises a warning
incident. `gift_delivery_outbox` has 1 row total → essentially all 2,576 are false
alarms. Fix: early-return (no incident) when a receipt's `provider_message_id`
isn't in the outbox; bulk-close the 2,576 existing.
