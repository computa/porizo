# Web Gift Delivery Operations

## State and support actions

- `gift_reserve` commits one fungible credit to a draft or paid web order.
- Manual `ready_to_share` means the gift exists and the buyer sends the stable
  link themselves.
- Delivery stop cancels only selected unsent SMS/email rows. It does not change
  the wallet or share.
- Full gift cancellation returns the reserved credit only before provider
  acceptance and before first recipient access/claim.
- Content/render failure restores the reservation debit once.
- Provider delivery exhaustion leaves the gift playable and sends the buyer a
  manual-fallback notice. It is not a refund.
- Stripe or Apple refund/reversal adjusts the original purchase grant through
  the common wallet ledger. Spent value may create internal debt while the
  consumer-visible balance remains zero.

Support should identify an order using `web_orders.id`, then follow
`gift_reservation_id` to `gift_reservations.gift_order_id`. Never copy raw
recipient phone/email values into tickets, analytics, incidents, or logs.

## Feature flag rollout

`web_automated_gift_delivery` gates only new recipient SMS/email configuration.
The common reservation/funding lifecycle and manual sharing remain active while
the flag is off. Existing scheduled outbox rows continue through the dispatcher.

Roll out in this order:

1. Keep the flag off after migration and verify manual web gifts plus wallet
   conservation.
2. Enable for internal accounts and use provider fakes locally.
3. In staging, send one approved SMS and one approved email; verify provider
   acceptance and final receipt reconciliation.
4. Enable a small production cohort, watching acceptance, bounce/failure,
   duplicate-send, wallet debt, and manual-fallback rates.
5. Expand only when those metrics remain within the existing gift-delivery
   baseline.

Rollback by disabling the flag. Do not delete preferences, gift orders, or
outbox rows; already-confirmed delivery must continue.

## Incident checklist

1. Confirm content status separately from delivery status.
2. Confirm the share remains playable before changing financial state.
3. Inspect outbox channel state and provider receipt timestamps.
4. Use delivery stop for unsent channels; use full cancellation only when the
   eligibility guard permits it.
5. Use purchase reversal only for a provider-confirmed payment refund/dispute.
6. Escalate duplicate provider acceptance, wallet conservation drift, raw PII in
   logs, or an order/reservation ownership mismatch immediately.
