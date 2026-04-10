# Gift SMS + Email Message Redesign

**Date:** 2026-04-10
**Branch:** version3
**Status:** Design approved, plan revised per Codex review
**Approved email variant:** A "The Gift Card"
**Design artifacts:** `~/.gstack/projects/computa-porizo/designs/gift-email-template-20260410/`

## Problem

Gift delivery messages (SMS + email) have low conversion because:
1. "Someone special" — sender is anonymous, feels like spam
2. No recipient name — impersonal "you" instead of "Hey Sarah"
3. Leads with logistics (link, PIN) instead of emotional hook
4. SMS is 4 segments (~280 chars) with no warmth
5. Email subject is generic, body structure is transactional

## Solution

Redesign both SMS and email templates to lead with the human relationship (who → what → why → how) instead of the transaction (link → PIN → claim).

---

## Sender Identity Model

### Resolution Rule

Resolve and freeze `sender_display_name` at finalize time. The composer only asks "How should your name appear?" when no trustworthy sender label can be derived automatically.

### Fallback Chain (in order)

1. Explicit override from composer (if user typed one)
2. `users.display_name` (if non-empty)
3. Auth provider display name (Apple/Google profile)
4. Verified email local-part, cleaned for display (e.g. "ambrose23" → "Ambrose23")
5. `"A friend"` (terminal fallback)

**Never use "Someone special."** The chain always resolves to something.

### Freeze Semantics

- `sender_display_name` is resolved at finalize and stored on `gift_orders`
- Delivery always reads from `gift_orders.sender_display_name`, never from live user profile
- Profile changes after finalize do not affect already-scheduled gifts
- This prevents drift on scheduled gifts where delivery may be days later

### Composer UX

- If sender identity resolves confidently (steps 1-4 produce a real name): **do not show a From field**
- If it cannot resolve (all 4 steps fail, only "A friend" remains): show a lightweight inline prompt before the CTA: "How should your name appear on the gift?" — not as another form field, but as a contextual ask
- The prompt is framed as personalization, not as required data entry

---

## Data Requirements

**New column:**
- `gift_orders.sender_display_name` — nullable, varchar 100
- Populated at finalize from the fallback chain above

**Already available but unused in templates:**
- `gift_orders.recipient_name` — stored, never used in SMS/email
- `gift_orders.message` — included but buried after logistics
- `gift_orders.content_type` — used for noun but not for CTA verb

---

## SMS Template

### Structure

Sender first, gift noun second, action third. Clean, no marketing flourishes.

**With recipient name + personal message:**
```
Hey Sarah, Ambrose sent you a poem on Porizo.
"{message}"
Tap to read: {shortUrl}
PIN: {claimPin}
```

**With recipient name, no message:**
```
Hey Sarah, Ambrose sent you a song on Porizo.
Tap to listen: {shortUrl}
PIN: {claimPin}
```

**No recipient name, with message:**
```
Ambrose sent you a poem on Porizo.
"{message}"
Tap to read: {shortUrl}
PIN: {claimPin}
```

**No recipient name, no message:**
```
Ambrose sent you a song on Porizo.
Tap to listen: {shortUrl}
PIN: {claimPin}
```

### Rules

- Recipient name: use if non-empty, otherwise omit "Hey {name},"
- Sender name: always present (fallback chain guarantees this)
- Personal message: quoted on its own line if non-empty, truncated at 100 chars with "..."
- CTA verb: "Tap to listen" (song), "Tap to read" (poem)
- No emoji in SMS body (risks carrier filtering, looks marketing-like)
- No "Open in the Porizo app to claim." (sounds like work)

---

## Email Template (Variant A: "The Gift Card")

### Subject line

- With recipientName: `Sarah, Ambrose made you a {noun} 🎁`
- Without: `Ambrose made you a {noun} 🎁`

### HTML body structure

```
┌─────────────────────────────────┐
│  [Porizo logo - small, centered] │
│                                   │
│  🎁                               │
│  Ambrose made you a song          │  ← h1, serif, centered
│  A personal gift is waiting       │  ← subheading with recipientName
│                                   │
│  ┌─ quote card ───────────────┐  │
│  │ "{message}"                │  │  ← warm bg #F8F6F3, gold left border
│  │ — Ambrose                  │  │
│  └────────────────────────────┘  │
│                                   │
│  ┌─ gift card ────────────────┐  │
│  │ ♪  A Song for Sarah        │  │  ← icon + title + occasion badge
│  │    Birthday                │  │
│  └────────────────────────────┘  │
│                                   │
│     [ Listen Now ]                │  ← gold CTA #B0763F
│                                   │
│  Your claim PIN: 542828           │  ← monospace, secondary
│  You'll need this to unlock       │
│                                   │
│  ─────────────────────────────── │
│  Sent with love via Porizo        │
└─────────────────────────────────┘
```

### Color tokens

- Background: #FFFAF5 (warm off-white)
- Gold accent: #B0763F
- Quote card bg: #F8F6F3, left border: #D4A574
- CTA button: #B0763F, text white
- Body text: #1A1A1A, secondary: #666, footer: #BBB

### Conditional sections

- Quote card: only if `message` is non-empty
- Gift card: always shown
- CTA verb: "Listen Now" (song) / "Read Your Poem" (poem)
- Occasion badge: only if occasion data available from content

### Plain text fallback

Mirrors SMS structure:
```
Ambrose made you a song on Porizo.

"For the girl who makes every room brighter."

Claim PIN: 542828
Open your gift: {shortUrl}

You'll need the PIN to unlock your gift in the Porizo app.
```

---

## Gift Link Behavior Contract (`/g/{token}`)

### What `/g/{token}` does

A universal short gift link that resolves to the correct content experience.

### Route resolution

```
GET /g/{shareToken}
  → look up share_tokens WHERE token = {shareToken}
  → determine content_type from associated track or poem
  → redirect to:
      - /song/{shareToken}?sv={version}  (if song)
      - /poem/{shareToken}?sv={version}  (if poem)
```

### Behavior contract

- The link behaves identically to existing shared song/poem links
- Recipient sees the same claim/play experience as a regular share
- PIN entry is required to unlock (existing flow)
- If the gift has not been dispatched yet (scheduled, future send_at), the link returns a "gift not ready yet" page, not a 404

### Backward compatibility

- Existing sent links (`/poem/{token}`, `/song/{token}`) continue to work
- `/g/{token}` is additive, not a replacement
- No migration needed for already-dispatched gifts

### Analytics

- `/g/{token}` hits are tagged with `source=gift_delivery` in share_access_log
- This enables measuring gift-specific conversion (open rate, claim rate) separate from organic shares

---

## Implementation Plan

### Phase 1: Schema + Sender Resolution

- [ ] Migration: add `sender_display_name` column to `gift_orders` (nullable, varchar 100)
- [ ] Server: implement `resolveGiftSenderLabel(userId, explicitOverride)` with full fallback chain
- [ ] Server: call resolver at finalize, store result on `gift_orders.sender_display_name`
- [ ] Server: add `sender_display_name` to FinalizeGiftReservationRequest schema
- [ ] iOS: add `senderDisplayName` to FinalizeGiftReservationRequest in GiftModels.swift
- [ ] iOS: resolve sender label locally (display_name → auth profile → nil) and pass to finalize
- [ ] iOS: if local resolution fails, show inline "How should your name appear?" prompt in composer

### Phase 2: SMS Template

- [x] Rewrite `buildGiftDeliveryMessage()` in server.js — new format: sender-first, gift-noun-second, action-third
- [x] Use `gift_orders.recipient_name` when non-empty (with greeting: "Hey Sarah,")
- [x] Use `gift_orders.message` quoted on its own line, truncated at 100 chars with "..."
- [x] Content-type CTA: "Tap to listen" (song) / "Tap to read" (poem)
- [x] Remove "Open in the Porizo app to claim."
- [x] Remove emoji from SMS body
- [x] Add `sanitizeGiftTextField()` — strips newlines, tabs, collapses whitespace (SMS injection fix)
- [ ] Use `gift_orders.sender_display_name` (requires Phase 1 migration)
- [ ] Test: delivery copy for all 4 combinations (name/no-name × message/no-message)
- [ ] Test: legacy gifts without sender_display_name still get "A friend" fallback
- [ ] Test: recipient_name with newlines/control chars is sanitized

### Phase 3: Email Template

- [x] Rewrite `sendGiftDeliveryEmail()` in email-service.js — "Gift Card" HTML template
- [x] Dynamic subject line: "{recipientName}, {sender} made you a {noun} 🎁"
- [x] Content-type CTA: "Listen Now" (song) / "Read Your Poem" (poem)
- [x] Conditional quote card (only if message exists)
- [x] Gift preview card with content icon, title, occasion badge
- [x] All user-provided fields escaped via `escapeHtml()` (recipientName, senderName, message, title, occasion)
- [x] Plain text fallback mirroring SMS structure
- [x] Accept new fields: `recipientName`, `contentTitle`, `occasion`
- [x] Warm parchment background (#FFFAF5), gold accents (#B0763F), serif headings
- [ ] Test: email renders correctly in Gmail, Apple Mail, Outlook (manual spot check)

### Phase 3b: Server-side Wiring (done)

- [x] `buildGiftSenderLabel()` updated: reads frozen `sender_display_name` first, trims whitespace, fallback ends at "A friend"
- [x] Dispatch caller passes `gift` row to `buildGiftSenderLabel()` for frozen name access
- [x] Email dispatch caller passes `recipientName`, `contentTitle`, `occasion` to template
- [x] `canEdit == false` → `canEdit != true` in GiftScheduleManagementView (nil-safe)

### Phase 4: Gift Short Link (`/g/{token}`)

- [ ] Add `GET /g/:token` route
- [ ] Look up share_tokens, determine content_type
- [ ] Redirect to existing `/song/{token}` or `/poem/{token}` path
- [ ] Handle not-yet-dispatched gifts (friendly "not ready" page)
- [ ] Tag access_log entries with `source=gift_delivery`
- [ ] Use short URL in SMS/email templates
- [ ] Preserve all existing long-form links (no breaking changes)

### Phase 5: Cleanup + Tests

- [x] Replace "Someone special" with "A friend" as terminal fallback in `buildGiftSenderLabel()`
- [ ] Test: full E2E dispatch for song gift (SMS + email)
- [ ] Test: full E2E dispatch for poem gift (SMS + email)
- [ ] Test: scheduled gift dispatches with frozen sender_display_name
- [ ] Test: gift with no message omits quote card in email and quote line in SMS
- [ ] Test: `/g/{token}` resolves correctly for both songs and poems
- [ ] Test: legacy gifts dispatched before this change still work (no sender_display_name → "A friend")
- [ ] Test: whitespace-only display_name falls through to email local-part
- [ ] Test: `deliveryLocked` for `dispatching` and `dispatched` statuses (not just `partial`)
- [ ] Test: `getGiftShareUrlDeliveryError` with null, empty, malformed URLs

---

## CE Review Findings — Resolved

| # | Finding | Resolution |
|---|---------|------------|
| 1 | `giftUserFacingMessage()` undefined | **False positive** — exists in `GiftErrorFormatting.swift:44` |
| 2 | `sender_display_name` migration missing | **Acknowledged** — Phase 1 todo, requires migration before deploy |
| 3 | Whitespace-only display_name accepted | **Fixed** — `buildGiftSenderLabel()` now trims all candidates |
| 4 | SMS recipient_name injection | **Fixed** — `sanitizeGiftTextField()` strips newlines/tabs/control chars |
| 5 | Email HTML escaping for recipient_name | **Fixed** — all user fields passed through `escapeHtml()` |
| 6 | `canEdit == false` nil bug | **Fixed** — changed to `canEdit != true` (11 occurrences) |
| 7 | `deliveryLocked` test gaps | **Acknowledged** — added to Phase 5 test list |
| 8 | `getGiftShareUrlDeliveryError` test gaps | **Acknowledged** — added to Phase 5 test list |
| 9 | Legacy gifts backward compat | **Fixed** — `buildGiftSenderLabel` reads frozen name first, falls back gracefully |
| 10 | `can_edit`/`can_cancel` semantics change | **Acknowledged** — documented, non-breaking (additive fields) |
| 11 | Partial delivery UX unclear | **Acknowledged** — backlog item for GiftScheduleManagementView |
| 12 | Rate limiter GREATEST→CASE | **Accepted** — correct behavior, NULL handling verified |
