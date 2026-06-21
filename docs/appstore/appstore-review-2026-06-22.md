# App Store Review Audit — 2026-06-22

**Scope:** TestFlight binary upload (internal testing), builds **1.5.17 (137)** and **1.5.18 (138)**.

**138 delta (`4c3456d`):** the contact picker is now presented imperatively (UIKit `present`) instead of as a SwiftUI `.sheet` root, fixing a dismissal cascade. Same `CNContactPickerViewController`, same data — no new privacy/API/entitlement surface. Verdict unchanged: GO.

**139 delta (`9072a4b`):** after picking a contact, an editable name step (pre-filled, the captured number shown) lets the sender use the real name instead of a saved nickname. Pure SwiftUI view structure — no new privacy/API/entitlement surface. Verdict unchanged: GO.

**140 delta (1.5.20):** one-tap "Send to [name]" now works on the async ("Notify me") path — the library Share (`MySongsView`) and the full player (`TrackPlayerFullView`) offer the same iMessage/WhatsApp pre-addressed send as the reveal, and the reveal's send logic is extracted into a shared `DirectSendModel`. The recipient number is the same `recipient_phone` already collected/declared/audited (2026-06-21); the track API already returns it (no backend change). No new privacy/API/entitlement/framework surface — reuses `MessageUI` + `recipient_phone`. Verdict unchanged: GO.

**Builds covered:** also **1.5.19 (139)** and **1.5.20 (140)**.
**Branch:** `feat/binding-app-only-recipient-first`.
**Delta since the 2026-06-21 full audit:** one commit (`350d731`) — UI restructure of the create-flow name entry (`InlineNamePromptView.swift`) into a two-step "Who's this song for?" → occasion/type flow, plus `.autocorrectionDisabled()` on the name fields.

This is a **delta audit**. The full 14-category audit for the same device-binding feature set was completed 2026-06-21 (`appstore-review-2026-06-21.md`, Verdict: GO). Re-confirming only what the new commit could affect.

---

## Verdict: GO for TestFlight upload

**0 upload blockers.** The change is purely client-side SwiftUI view structure:

- **No new privacy surface.** The change does not add any API, permission, framework, or data collection. It reuses the same `CNContactPickerViewController` (out-of-process, no permission prompt) and the same `recipient_phone` flow already audited 2026-06-21. `PrivacyInfo.xcprivacy` already declares `NSPrivacyCollectedDataTypePhoneNumber`; `NSContactsUsageDescription` is set. No manifest change required.
- **No new entitlements / URL schemes.** Unchanged.
- **`.autocorrectionDisabled()`** is a benign UIKit/SwiftUI input modifier — no compliance implication.
- **Guideline 4.x:** the two-step recipient screen is ordinary in-app UI; no minimum-functionality, web-view, or data-gate concern.
- **Encryption:** `ITSAppUsesNonExemptEncryption=false` unchanged → `exempt`.

## Blockers (0)

_None for this TestFlight upload._

## Warnings (1 — carried over, pre-production only)

| #   | Cat   | Issue                                                                                                                                                                                                                                                                         | Fix                                                                        |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | 5.1.1 | Privacy policy (`public/legal/privacy.html`) still does not disclose the recipient **phone number** collected/stored (`recipient_phone`). Not a TestFlight blocker (no Beta App Review on internal TestFlight). **Must be fixed before the production App Store submission.** | Add recipient contact details to the privacy policy's collected-data list. |

## Verification

- iOS create flow rebuilt + run on simulator: two-step recipient-first flow renders and advances correctly (Step 1 "Who's this song for?" → Step 2 "A song for [name]").
- Backend unchanged this commit (already deployed + verified live 2026-06-21).
