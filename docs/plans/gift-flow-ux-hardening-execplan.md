# Harden Gift Flow Sender UX And Management

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document follows the global ExecPlan standard in `~/.codex/PLANS.MD`.

## Purpose / Big Picture

After this change, a sender can create a gift, pause without losing progress, clearly confirm recipient and delivery timing, and manage scheduled gifts from the app until they are sent. The user-visible difference is that scheduled gifts no longer disappear into backend state after finalize: they are reviewable, editable, and cancellable from the gift UI, and recipient phone entry works for international users instead of assuming US numbers.

## Progress

- [x] (2026-04-09 11:15 AWST) Reviewed the current gift flow end to end and identified the main UX and robustness gaps.
- [x] (2026-04-09 11:35 AWST) Extracted shared phone-number support so auth, profile completion, and gifting can use the same country-aware normalization rules.
- [x] (2026-04-09 11:55 AWST) Added sender-facing scheduled gift list and detail-management sheets in iOS.
- [x] (2026-04-09 12:05 AWST) Reworked gift-flow close behavior to support save-and-close vs discard and removed the auto-jump from content-ready reservation back into recipient step.
- [x] (2026-04-09 12:40 AWST) Ran repo lint, full backend test suite, and iOS simulator builds; fixed the pre-existing lint errors in `marketing/tools/generate-post.js` so validation is clean again.
- [x] (2026-04-09 12:55 AWST) Revalidated the sender flow against a clean sqlite-backed local server after discovering the default local Postgres dev environment is drifted and unsuitable for UI verification.

## Surprises & Discoveries

- Observation: The backend already had the right primitives for update and cancel; the sender experience was weak mainly because the iOS flow never exposed them.
  Evidence: `APIClient+Gifts.swift` already exposes `getGifts`, `updateGift`, and `cancelGift`.

- Observation: Phone handling logic was duplicated across auth and profile completion, which made the gift flow’s US-only normalization harder to fix cleanly.
  Evidence: both `PhoneAuthView.swift` and `ProfileCompletionView.swift` carried their own country/formatting logic before extraction.

- Observation: the default local Postgres dev environment is currently drifted and cannot be trusted for UI verification.
  Evidence: local server logs repeatedly emitted `relation "jobs" does not exist`, and the simulator surfaced `relation "users" does not exist` when opening the gift flow against that stack.

## Decision Log

- Decision: Keep scheduled-gift management in the gift flow for this slice rather than creating a whole new tab or app section.
  Rationale: The review gap was sender management visibility, not navigation architecture. A focused list/detail sheet solves the user problem with less churn.
  Date/Author: 2026-04-09 / Codex

- Decision: Introduce one shared phone-entry support file instead of patching only the gift flow.
  Rationale: The earlier duplication was already a maintainability smell. Fixing gift phone handling in isolation would keep three separate normalization models alive.
  Date/Author: 2026-04-09 / Codex

- Decision: Change close behavior from implicit discard to explicit save-vs-discard.
  Rationale: Reservation restore already exists on the backend. The missing piece was making pause/resume intentional in the UI.
  Date/Author: 2026-04-09 / Codex

## Outcomes & Retrospective

The sender gift flow is materially stronger now. Scheduled gifts are no longer backend-only state, the sender can pause without automatically discarding work, and recipient phone handling no longer assumes a US number. The remaining runtime weakness I found is environmental rather than product-side: the default local Postgres dev setup is drifted and should be repaired separately. The feature code itself is simpler because phone handling moved into one shared utility and sender management is explicit instead of implied.

## Context and Orientation

The sender gift flow lives primarily in `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift`. It creates or resumes a gift reservation, launches the song/poem create flow, collects recipient details, asks whether to send now or later, and finalizes the gift with the backend.

The gift backend already persists scheduled gifts and exposes sender management endpoints in `src/routes/gifts.js`. The iOS client already had corresponding API methods in `PorizoApp/PorizoApp/APIClient+Gifts.swift`, but the UI only showed a static “Scheduled” card.

Phone entry support had been embedded inside `PorizoApp/PorizoApp/PhoneAuthView.swift`, while profile completion in `PorizoApp/PorizoApp/ProfileCompletionView.swift` reused some of the same ideas but not the same implementation. This made the gift flow’s own phone logic divergent and too US-specific.

## Plan of Work

First, extract the country model, country picker, and phone normalization helpers into a shared file so all flows can use one phone-entry model. Then refactor the sender gift flow to consume that shared support and expose explicit save/close behavior, clearer content-resume messaging, and interactive scheduled-gift management. Finally, validate the backend and iOS behavior end to end and correct any issues surfaced by compile or runtime verification.

## Concrete Steps

From the repository root:

1. Edit `PorizoApp/PorizoApp/PhoneNumberFormatting.swift` to define the shared country model, picker, and normalization helpers.
2. Update `PorizoApp/PorizoApp/PhoneAuthView.swift` and `PorizoApp/PorizoApp/ProfileCompletionView.swift` to use those helpers instead of their own copy-pasted logic.
3. Add `PorizoApp/PorizoApp/Flows/GiftScheduleManagementView.swift` with:
   - a sheet listing all scheduled gifts
   - a detail sheet that allows edit and cancel for a scheduled gift
4. Update `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift` to:
   - use the shared phone helpers
   - expose a country picker for recipient phone
   - allow save-and-close vs discard
   - stop auto-jumping back into recipient details on refresh
   - show tappable scheduled gifts and “view all”
   - offer direct management from the success state
5. Run:
   - `npm run lint`
   - `npm test`
   - iOS simulator build/run for `PorizoApp`

## Validation and Acceptance

Acceptance is:

1. A sender can create gift content, close the flow with “Save & Close,” reopen it, and resume with the same reservation still intact.
2. A sender can schedule a gift and then view it in-app with title, recipient, and send time.
3. A sender can open the scheduled gift, edit recipient or send time, save changes, and see the updated scheduled details.
4. A sender can cancel a scheduled gift from the management view.
5. AU-style phone entry works in the gift recipient step without requiring the sender to manually type full `+1`-style US numbers.

## Idempotence and Recovery

The iOS UI changes are safe to rerun and rebuild repeatedly. The backend APIs already support update/cancel idempotently enough for UI retries. If a simulator test creates local reservation state, reopening the gift flow should restore it. If validation leaves a stale local reservation, cancel it from the gift flow rather than editing local storage directly.

## Artifacts and Notes

Key files:

- `PorizoApp/PorizoApp/PhoneNumberFormatting.swift`
- `PorizoApp/PorizoApp/PhoneAuthView.swift`
- `PorizoApp/PorizoApp/ProfileCompletionView.swift`
- `PorizoApp/PorizoApp/Flows/GiftSendFlowView.swift`
- `PorizoApp/PorizoApp/Flows/GiftScheduleManagementView.swift`

## Interfaces and Dependencies

The sender management UI uses existing backend endpoints through `APIClient+Gifts.swift` and does not require new server routes for this slice. The shared phone-entry layer uses the existing `Country` / country-picker interaction model already familiar from phone auth, but makes it available across the app in one place instead of duplicating it inside one view file.
