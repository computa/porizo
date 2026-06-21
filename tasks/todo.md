# Fix: one-tap "Send to [recipient]" must work on the async ("Notify me") path

## Problem (verified)

Feature 2's one-tap send only exists on the **synchronous reveal** (`RevealBloomView` →
`onDirectSend` → `WarmCanvasFlowView.startDirectSend`). When a render is slow (the user's
took ~4 min, tripping the `waitTimeout` "Notify me when ready" screen), the user exits to
home, gets a push, and opens the finished song from the **library** — a path with only a
**generic Share**, no send-to-the-collected-number. The number is saved server-side
(`tracks.recipient_phone`, migration 121) but is **not returned by the track API** and the
iOS `Track` model **doesn't carry it**, so nothing downstream can use it.

## Goal

Wherever a finished song is opened (reveal OR library/full player), the Share CTA one-taps
the recipient number collected upfront (iMessage/WhatsApp, PIN-free link) — not a generic share.

## Plan

### Phase 1 — Backend: expose recipient_phone on tracks

- [ ] Find the track row→response serializer (GET `/tracks/:id`, GET `/tracks`) and add
      `recipient_phone` + `recipient_channel` to the output.
- [ ] Test: a track created with `recipient_phone` returns it on GET (extend `test/recipient-contact.test.js`).

### Phase 2 — iOS Track model

- [ ] Add `recipientPhone` (`recipient_phone`) + `recipientChannel` (`recipient_channel`) to
      `Track` in `Models/SharedModels.swift`.

### Phase 3 — iOS: reusable one-tap send

- [ ] Extract direct-send logic from `WarmCanvasFlowView.startDirectSend`
      (pinless link via `ShareController.makePinlessShareLink` → `RecipientMessage.body` →
      iMessage `MessageComposeSheet` / WhatsApp `wa.me`) into a reusable coordinator usable
      outside the create flow. Refactor `WarmCanvasFlowView` to use it (no behavior change).

### Phase 4 — iOS: surface on the async/library path

- [ ] Make the existing Share entry recipient-aware: in `TrackPlayerFullView` (and
      `SongActionMenu`), when `track.recipientPhone != nil`, the Share button becomes
      "Send to [name]" → one-tap. Otherwise the generic `SharePostcardView` (unchanged).

### Phase 5 — verify + ship

- [ ] Backend tests green; deploy (push → Railway) + curl-verify a track returns recipient_phone.
- [ ] iOS build; sim-verify library "Send to [name]" opens the composer pre-addressed.
- [ ] Ship TestFlight build 140 (also carries the held PressableButtonStyle polish — builds clean).

## Out of scope (flagged separately)

- 🚨 Prod **Anthropic API out of credits** ("credit balance too low") — degrading renders
  (also a likely cause of the 4-min render → timeout). User to top up.
- The `waitTimeout` threshold itself (render legitimately took 4 min).

## Open decision

Surface for the async send CTA: **(A) repurpose the existing Share button** to become
"Send to [name]" when a recipient phone exists (recommended — no new clutter), vs
**(B) add a distinct "Send to [name]" button** alongside Share.
