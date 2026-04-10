# Implement "The Envelope" — Schedule & Send Redesign

**Branch:** `version3`
**Approved Design:** Variant A "The Envelope" from `/design-shotgun` (2026-04-10)
**Design Artifact:** `~/.gstack/projects/computa-porizo/designs/schedule-send-e2e-20260410/`
**HTML Mockup:** `variant-A-envelope.html`
**Codex Review:** Approved with refinements (2026-04-10)

## Context

Replace the current 5-step checkout-style `GiftSendFlowView` (Content → Recipient → Delivery → Review → Success) with a single-screen emotional flow that follows YC research design principles:
- One screen, one action, one CTA
- No progress dots, no step indicators, no "Loading gift wallet..."
- Internal states stay invisible — just who, when, send
- Feels like wrapping a gift, not filling out a shipping form

## Design Decisions (from YC Research + Codex Review)

1. **Emotional arc over state machine** — compress 5 backend steps to 1 user moment
2. **One dominant action per screen** — single gold CTA at bottom
3. **Sharing must be fast** — 1 screen from reveal to send
4. **Song stays emotionally dominant** — not a tiny utility row, the emotional header
5. **Delivery as collapsed toggle** — "Send Now" default, "Schedule" expands inline
6. **Recipient = delivery destination** — abstract as "who + how", not phone-only
7. **Natural-language summary above CTA** — "Sending Sarah your song by SMS on Apr 15 at 9:00 AM"
8. **Dynamic CTA** — "Send Gift" (immediate) / "Schedule Gift" (scheduled)
9. **Billing only on block** — wallet check on CTA tap, not screen load. Frame as "unlock this gift"
10. **Flat state model** — one composer, one submit. No 5-step skeleton underneath.

## Hard Rules (from Codex)

- No progress dots
- No hidden "review" screen
- No separate "success details confirmation" masquerading as closure
- No top-of-screen wallet bootstrapping states
- No forced bundle picker before user tries to send
- No step-driven view model with screen names that leak into UX copy
- Implementation collapses the old state model, does not just hide it

## Screen Hierarchy (top to bottom)

1. **Hero** — song preview card: title, occasion art, subtle playback state (waveform). Reminds user what they're sending.
2. **Recipient** — "Who's this for?" Name field, then delivery method picker (SMS / Email), then destination input. Not prematurely phone-specialized.
3. **Note** — personal message, 3-line field, warm placeholder. Visible and inviting but not dominant. ("Write something from the heart...")
4. **Timing** — collapsed by default to "Send now". Tap to expand schedule picker. Once selected, immediately shows natural-language summary.
5. **Delivery summary** — one sentence confirming recipient + method + timing. Sits directly above CTA.
6. **CTA** — single button. "Send Gift" or "Schedule Gift". No ambiguity.

## Plan

### Phase 1: Understand
- [ ] Read GiftSendFlowView.swift fully — map all state, backend calls, edge cases
- [ ] Read GiftModels.swift, APIClient+Gifts.swift — document the API contract
- [ ] Identify: wallet check, reservation, gift creation, StoreKit sync, delivery dispatch
- [ ] List every backend call that must survive the redesign

### Phase 2: Architecture
- [ ] Design flat state model for EnvelopeSendView (no Step enum, no progress tracking)
- [ ] Define: one `@State` struct for form data, one `submit()` async action
- [ ] Plan inline sub-sheets: contact method picker, date/time picker, credit resolution
- [ ] Map wallet/billing to lazy check pattern (check on submit, not on appear)

### Phase 3: Build
- [ ] Create EnvelopeSendView.swift — single-screen composer
- [ ] Implement: song hero card with playback state
- [ ] Implement: recipient section (name + delivery method + destination)
- [ ] Implement: personal note field (3-line, warm placeholder)
- [ ] Implement: timing section (collapsed "Send now" default, expandable schedule)
- [ ] Implement: natural-language delivery summary above CTA
- [ ] Implement: dynamic CTA ("Send Gift" / "Schedule Gift")
- [ ] Implement: submit action — wallet check → reserve → create gift → dispatch
- [ ] Implement: inline credit resolution sheet (only if wallet blocks send)
- [ ] Implement: success state (inline confirmation, not a new screen)

### Phase 4: Wire & Replace
- [ ] Wire EnvelopeSendView into navigation from WarmCanvasFlowView reveal
- [ ] Deprecate old GiftSendFlowView (keep file, mark deprecated, remove from nav)
- [ ] Test E2E: create song → reveal → send gift → success

### Phase 5: QA
- [ ] Visual QA against refined mockup
- [ ] Test: immediate send path
- [ ] Test: scheduled send path
- [ ] Test: wallet empty → inline credit resolution → send
- [ ] Test: email delivery path
- [ ] Test: SMS delivery path
- [ ] Verify no leaked internal states (no loading spinners, no step language)
