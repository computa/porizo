# App Store Review Audit — 2026-06-21

**Scope:** TestFlight binary upload (internal testing), build **1.5.16 (136)**.
**Branch audited:** `feat/binding-app-only-recipient-first` (device-binding rework — the new surface in this build).
**Upload context:** Internal TestFlight only. No Beta App Review, no screenshots/subscription/EULA review for this step. ASC-side screenshot/subscription/EULA config treated as INFORMATIONAL, not blockers. Blockers below are only things Apple catches at **binary-processing time** or that are **genuinely broken**.

---

## Verdict: GO for TestFlight upload

**0 upload blockers.** The archive is well-formed: privacy manifest, entitlements, usage strings, encryption declaration, and the new Contacts/Phone/MessageUI data flows are all correctly configured. The new code compiles and all unit tests pass (113 backend, 7 new Swift). PhoneNumberKit ships its own privacy manifest (bundled into the `.app`), so no required-reason API gap.

**One real WARNING you must fix before the eventual App Store (production) submission, not before this TestFlight upload:** the privacy policy does not yet disclose collection of the _recipient's phone number_. This will not block binary processing or internal TestFlight, but it is a Guideline 5.1.1/5.1.2 + privacy-policy-accuracy issue that Apple will flag at full App Review.

---

## Blockers (0)

_None for this TestFlight upload._

---

## Warnings (3)

| #   | Cat       | Issue                                                                                                                                                                                                                                                                                                                                                                 | File:Line                                                                                                                            | Fix                                                                                                                                                                                                                                                                                                                                          |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | C / 5.1.1 | Privacy policy discloses recipient **name + relationship** but NOT the recipient **phone number**, which is now collected and stored server-side (`recipient_phone` column). The app collects a third party's (the recipient's) phone number; this must be disclosed before production App Review. Not an upload blocker (no Beta App Review on internal TestFlight). | `public/legal/privacy.html:110` (collection list); code: `src/routes/tracks.js:475`, `migrations/pg/121_add_recipient_contact.sql:1` | Add to §1.3 Song Creation Data: e.g. "Recipient contact details: if you choose 'Pick from Contacts' or one-tap Send, the recipient's phone number (used only to address the share message, captured from your device's contact picker)." Also confirm the ASC Privacy Nutrition Label lists Phone Number as collected for app functionality. |
| 2   | F / 5.1.2 | Server stores `recipient_phone` with no normalization/validation (`body.recipient_phone \|\| null`). Not a security risk (parameterized query), but unvalidated third-party PII at rest. Data-minimization best practice for 5.1.2.                                                                                                                                   | `src/routes/tracks.js:475`                                                                                                           | Normalize to E.164 (or reject) before insert; document retention; confirm the account-deletion cascade purges the new column.                                                                                                                                                                                                                |
| 3   | H / 1.2   | One-tap "Send to [recipient]" pre-fills an outbound iMessage/SMS/WhatsApp to a third party. The send is user-initiated (system compose sheet requires an explicit Send tap), so this is low risk, but it is the pattern Apple scrutinizes for unsolicited messaging.                                                                                                  | `WarmCanvasFlowView.swift:870-946`                                                                                                   | Already mitigated: `MFMessageComposeViewController` always requires the user to tap Send; nothing is sent silently. No change required for upload. Keep it user-confirmed (never move to a background/API send).                                                                                                                             |

---

## Info (4)

| #   | Cat        | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                 | File:Line                                                                                |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | B          | `NSContactsUsageDescription` is set via `INFOPLIST_KEY_NSContactsUsageDescription` in all build configs. `CNContactPickerViewController` is out-of-process, so iOS does **not** prompt for permission on the new recipient-first path — the usage string is harmless and a safe belt-and-suspenders. The pre-existing gift flow calls `CNContactStore.authorizationStatus(for:)` (status read only, no `requestAccess`), so the string is justified. | pbxproj:601; `GiftSendFlowView.swift:990`                                                |
| 2   | B / TN3181 | **PhoneNumberKit 4.3.0 bundles its own `PrivacyInfo.xcprivacy`**, copied into the built app (`PhoneNumberKit_PhoneNumberKit.bundle/PrivacyInfo.xcprivacy`). It declares no accessed APIs and no data collection, so **no app-side required-reason declaration is needed**. No action.                                                                                                                                                                | DerivedData bundle + `SourcePackages/checkouts/PhoneNumberKit/.../PrivacyInfo.xcprivacy` |
| 3   | G / 4.2    | Feature 1 (browser app-wall) is a **landing page**, not the app in a web view. It shows artwork + "Open in Porizo" / "Get Porizo — Free on the App Store" + Smart App Banner + preview teaser; social unfurl/OG previews still render. Legitimate share hand-off; does not trip 4.2.3 because the binary itself has full standalone functionality. No action for the binary.                                                                         | `web-player/index.html:38,103-124,180-185`                                               |
| 4   | E          | `whatsapp` present in `LSApplicationQueriesSchemes`; `canOpenURL("whatsapp://")` correctly gated by it. WhatsApp deep link uses `https://wa.me/...` (universal link). MessageUI gated by `MFMessageComposeViewController.canSendText()` with a `UIActivityViewController` fallback for non-SMS devices. All correct.                                                                                                                                 | Info.plist:55; `WarmCanvasFlowView.swift:902-905,925`; `RecipientMessage.swift:21`       |

---

## Pre-Submit Action List (ordered by rejection risk)

**For THIS TestFlight upload:** none. Proceed.

**Before the eventual production App Store submission:**

1. [WARNING] Add recipient phone number to privacy policy §1.3 and to the ASC Privacy Nutrition Label. (`public/legal/privacy.html:110`)
2. [WARNING] Normalize/validate `recipient_phone` to E.164 server-side; confirm account-deletion cascade purges it. (`src/routes/tracks.js:475`)
3. [INFO] Keep the recipient send strictly user-confirmed via the system compose sheet (no silent send).

---

## Focus-Area Findings (per request)

### 1. Privacy / manifest

- `NSContactsUsageDescription`: **PRESENT** (pbxproj:601, all configs). Out-of-process picker = no runtime prompt; the string is correct and safe.
- `PrivacyInfo.xcprivacy`: already declares `NSPrivacyCollectedDataTypePhoneNumber` (lines 43-54) — **the phone-number data flow IS declared in the manifest.** Contacts access via the system picker is not a manifest required-reason category (the app never ingests the address book; it receives only the single selected contact). No manifest change required.
- **Recipient phone is a 5.1.1/5.1.2 concern at the policy/label layer, not the manifest layer.** The manifest is correct; the privacy policy HTML is the gap (Warning 1).
- PhoneNumberKit required-reason APIs: **N/A** — PNK ships its own manifest declaring zero accessed APIs (Info 2).

### 2. Entitlements / URL schemes

- `whatsapp` in `LSApplicationQueriesSchemes`: present, correctly used with `canOpenURL`. No `canOpenURL` abuse (single declared scheme). MessageUI needs no entitlement. No issue.

### 3. Guideline 4.2 / 4.2.3 (web app-wall)

- Browser app-wall is a recipient landing/hand-off page with a preview teaser, not a download-gate that strips functionality. The iOS binary is fully functional standalone. **No 4.2 minimum-functionality issue.** (Info 3.)

### 4. PhoneNumberKit (TN3181)

- Bundles `PrivacyInfo.xcprivacy`; declares no required-reason APIs and no data collection. **No action.** (Info 2.)

### 5. Standard binary checks

- `ITSAppUsesNonExemptEncryption` = `false` (Info.plist:168-169). Correct — only standard HTTPS/Keychain (exempt). No export-compliance prompt at upload.
- Usage strings: Microphone, Speech, PhotoLibraryAdd, UserTracking present and descriptive (Info.plist:69-78); Contacts via pbxproj. No missing-usage-string crash risk on the new paths.
- `UIBackgroundModes`: `audio, fetch, remote-notification, processing` — pre-existing and exercised (background playback, BGTask render polling, APNs). Untouched by this build.
- ATS: no `NSAppTransportSecurity` exception dict (clean — all HTTPS). `wa.me`/`whatsapp://` are HTTPS/native. No ATS issue.
- `TARGETED_DEVICE_FAMILY` = `"1,2"` consistent across all configs; `IPHONEOS_DEPLOYMENT_TARGET` = `17.0` consistent. `MARKETING_VERSION` = `1.5.16`, `CURRENT_PROJECT_VERSION` = `136`, consistent. No mixed-config rejection risk.

---

## Quality Gates

| Gate                                                    | Result         | Details                                                                                                               |
| ------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| ESLint (changed backend files)                          | **PASS**       | clean (exit 0) on tracks/sharing/share-service/track-urls/request-context/share-video-source/player.js                |
| Backend tests (`node --test`, share + recipient suites) | **PASS**       | 113 passed, 0 failed, 0 skipped across 25 suites                                                                      |
| iOS unit tests (new)                                    | **PASS**       | `** TEST SUCCEEDED **` — PhoneNumberNormalizerTests (3) + RecipientMessageTests (4) = 7/7 on iPhone 17 / iOS 26.5 sim |
| iOS test build (binary deps link)                       | **PASS**       | Test target built + ran — confirms PhoneNumberKit, MessageUI, ContactsUI link and the new flow compiles               |
| ASC: EULA / screenshots / subscriptions                 | **N/A (INFO)** | Internal TestFlight upload — out of scope per instructions                                                            |

**Test-runner note:** `npx jest` reports "0 tests / TypeError" because this repo uses Node's built-in `node:test`, not Jest. The real `npm test` (`node --test`) yields 113/113 passing. The Jest output was a harness mismatch, not a real failure.

---

## Web Research: privacy-manifest requirements for contacts/phone (light)

- Apple requires third-party SDKs (esp. "commonly used" ones) to ship their own `PrivacyInfo.xcprivacy`; if an SDK lacks one you must declare its required-reason APIs in your app's manifest. **PhoneNumberKit 4.3.0 ships one**, so no app-side declaration needed. (TN3183 / Apple privacy-manifest docs.)
- Contacts accessed solely via `CNContactPickerViewController` (out-of-process) does not trigger a permission prompt and is not itself a manifest required-reason category; the collected _phone number_ is the disclosable item, already declared in our manifest.

Sources:

- https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest
- https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk

---

## Verification Log

1. **Version 1.5.16/136** — pbxproj `MARKETING_VERSION=1.5.16`, `CURRENT_PROJECT_VERSION=136` across all configs (lines 595-751). VERIFIED consistent.
2. **NSContactsUsageDescription present** — pbxproj:601, present in both Debug/Release config blocks. VERIFIED.
3. **Manifest declares PhoneNumber** — `PrivacyInfo.xcprivacy:43-54`. Read full file. VERIFIED (no gap at manifest layer).
4. **PhoneNumberKit ships its own manifest** — `find` located the bundle manifest inside the built `.app` and in SourcePackages; read it: empty accessed-API + collected-data arrays. VERIFIED no required-reason gap.
5. **Contacts picker out-of-process, no permission request** — `ContactPickerSheet.swift` uses `CNContactPickerViewController` only; no `requestAccess` anywhere; only `authorizationStatus(for:)` (status read) at `GiftSendFlowView.swift:990`. VERIFIED.
6. **Send flow user-confirmed + gated** — `WarmCanvasFlowView.swift:870-946`: `canSendText()` guard + `UIActivityViewController` fallback; WhatsApp only when `canOpenURL("whatsapp://")` AND valid E.164. Both `directSendPayload` `.sheet` (310) and `directSendChannelChoice` dialog (293) rendered in body. VERIFIED reachable.
7. **Recipient phone stored, unvalidated** — `tracks.js:466-476` parameterized INSERT `body.recipient_phone || null`; migration adds nullable TEXT columns. VERIFIED (no injection; no E.164 validation — Warning 2).
8. **Privacy policy gap** — `privacy.html:106-115` §1.3 lists recipient name + relationship; phone appears only under §1.2 account auth (line 101), never as recipient data. VERIFIED gap (Warning 1).
9. **Web app-wall is a landing page** — `web-player/index.html:38,103-124,180-185`. Read full file. VERIFIED legitimate hand-off (Info 3).
10. **Encryption / ATS / device family** — Info.plist:168 `ITSAppUsesNonExemptEncryption=false`; no ATS exception; device family + deployment target consistent across configs. VERIFIED.
11. **Tests** — backend 113/113; iOS `** TEST SUCCEEDED **` 7/7; eslint exit 0. VERIFIED.
