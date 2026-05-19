# App Store Review Audit — 2026-05-20

**App:** Porizo: AI Song Gift Maker
**Version / Build:** 1.5.12 / 124
**Archive:** `PorizoApp/build/PorizoApp-124.xcarchive`
**Target window:** Father's Day 2026-06-15
**Last shipped:** 1.5.11 — `READY_FOR_SALE`
**Audit framework:** `~/.claude/agents/appstore-reviewer.md` (14-category checklist)
**Auditor:** appstore-reviewer subagent

## Verdict: NO-GO

**3 BLOCKERS + 7 WARNINGS.** Resolvable in <1 day. None are deep architectural problems — all blockers are fixable by editing metadata, adding one consent screen, and uploading the binary. Father's Day deadline is achievable if blockers are fixed and resubmitted by 2026-05-25.

---

## Blockers (must fix before submit)

### 🟥 B1 — Metadata "1-minute" claim is inaccurate (Guideline 2.3.1 / 2.3.7)

- **File:** `marketing/appstore/metadata/version/1.5.12/en-US.json`
  - Line 6: `promotionalText` — "Make a 1-minute song for Dad..."
  - Line 7: `whatsNew` — "...a 1-minute custom song..."
- **Evidence:** `specs/personalized-song-platform-spec.md` (lines 75, 845, 1442, 1479) — the default preview is **15–25 seconds**, not ~60s. Full render is 45–90s and requires explicit user confirmation / credit spend after preview. Father's Day rush users get 15–25s by default.
- **Fix copy:**

  | Field             | New copy                                                                                                                            | Chars    |
  | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
  | `promotionalText` | `✨ Make a personal song for Dad in his voice or yours. Preview free — finish it for Father's Day, June 15.`                        | 110/170  |
  | `whatsNew`        | `🎁 New: Father's Day song gifts. Your voice + their name + a memory = a custom song you can preview free and send before June 15.` | 137/4000 |

### 🟥 B2 — Voice enrollment has no consent gate (Guideline 5.1.1 / 5.6)

- **Files:**
  - `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift` lines 100–202 — Welcome view with CTA "Start Recording" at lines 180–190 calls `startEnrollment()` directly. No checkbox, no consent affirmation rendered. Subtitle at line 138 is "Record a few phrases and your songs will sing in your voice" — does not affirm ownership of the voice.
  - `PorizoApp/PorizoApp/APIClient+Enrollment.swift` lines 21–24 — `consent_accepted: true` is **hardcoded** in the request body so the server believes consent happened.
- **Context:** AI voice cloning is under elevated Apple scrutiny in 2026. `public/legal/terms.html §3.1` already states the user "Confirm that you are the owner of the voice" — but that affirmation never surfaces at the enrollment moment.
- **Fix shape (SwiftUI):** Add to Welcome view above the CTA:

  ```swift
  @State private var consentChecked = false

  // In view body, above "Start Recording":
  Toggle(isOn: $consentChecked) {
      Text("I confirm this is my own voice, I'm 13+, and Porizo may create a mathematical voice model used only to sing my songs. I can delete it from Settings.")
          .font(.footnote)
  }

  Button("Start Recording") { startEnrollment() }
      .disabled(!consentChecked || isLoading)
  ```

### 🟥 B3 — Build 124 not in App Store Connect

- **Evidence:** Local archive `Info.plist` shows `CFBundleShortVersionString=1.5.12`, `CFBundleVersion=124`, signed `Apple Development: Ambrose Obimma (HZTRUSQCZ4)`. `asc versions list --app 6758205028` returns only 1.5.11 as `READY_FOR_SALE`. No 1.5.12 record exists.
- **Fix sequence:**
  1. Resolve Apple Distribution cert (current pause point on task #9).
  2. `xcodebuild -exportArchive -archivePath PorizoApp/build/PorizoApp-124.xcarchive -exportOptionsPlist PorizoApp/ExportOptions.plist -exportPath PorizoApp/build/export -allowProvisioningUpdates`
  3. Wait ~30–60 min for ASC processing.
  4. `asc versions create --app 6758205028 --version 1.5.12 --platform IOS`
  5. Push metadata (with B1 fixes), attach build 124, validate, submit.

---

## Warnings (resolve before next major release)

### 🟧 W1 — Privacy policy IP-hashing language vs. raw logging (Category C)

- `public/legal/privacy.html:122` says IPs "may be hashed in audit logs." Code writes `request.ip` **raw** at: `src/routes/sharing.js:331, 1115, 1261, 1831, 1918, 2186, 2236, 2303, 2350, 2776`, and `src/routes/poems.js:676`.
- Grep for any IP hashing function in `src/` → 0 matches.
- **Fix:** Either (a) update policy text to drop "may be hashed" — fastest; or (b) implement SHA-256 with per-deployment salt before writing IPs to audit metadata.

### 🟧 W2 — iPad screenshots use older 12.9" size (Category J)

- `marketing/appstore/screenshots/current/ipad/*.png` — 5 files at **2048×2732**, 72 dpi, no alpha, PNG.
- Modern ASC prefers 2064×2752 (M4 iPad Pro 13") but accepts 2048×2732. Not a rejection trigger. Optional re-export if Remotion source available.

### 🟧 W3 — Subtitle stuffs title tokens (Category A, 2.3.7)

- App name "Porizo: AI Song Gift Maker" + subtitle "Personal AI Song & Voice Gifts" share **AI / Song / Gift** tokens.
- Low risk. Optional alternatives: "Make personal songs in their name" (30c) or "Voice-powered song gifting" (26c).

### 🟧 W4 — Shared web player has no AI label for recipients (Category H)

- `src/routes/sharing.js:863-` (the `/play/:shareId` HTML view) — no "AI generated" copy visible to recipients.
- In-app surfaces correctly label AI ("AI generated · tap any section to edit" in `PostCreateTransformView.swift:58`, "AI writes the lyrics" in `UnifiedCreationFlowView.swift:304`).
- **Fix:** Add footer to `/play/:shareId`: "Made with Porizo, an AI song studio." Defensive only.

### 🟧 W5 — Two paywall views exist; confirm which one ships (Category G)

- `SubscriptionView.swift` (V1): disclosure text at lines 615–622, rendered in body at lines 75–86 — ✅ verified rendered.
- `SubscriptionViewV2.swift` (V2): disclosure at line 440 — rendering in body **not verified** this session.
- Both include Apple-required language (product name, price/period, auto-renew, charge, manage). Restore Purchases present in V1 (line 580) and V2 (line 303).
- **Fix:** Confirm which paywall is the active one in 1.5.12. If V2, trace `:440` reference into a rendered body element.

### 🟧 W6 — Privacy manifest review (Category B, informational)

- `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy` (185 lines, read in full): declares 11 data types — Name, Email, PhoneNumber, AudioData, OtherUserContent, UserID (tracking=true), DeviceID (tracking=true), PurchaseHistory, CrashData, PerformanceData, ProductInteraction (tracking=true). NSPrivacyTracking=true with allow-list for Meta + Google + Apple Search Ads. API reasons declared (UserDefaults: CA92.1, FileTimestamp: C617.1, SystemBootTime: 35F9.1). All map to actual SDK usage (Firebase Crashlytics, Amplitude, AppsFlyer, OneSignal, Meta SDK, TikTok SDK).
- **No action.** Maintain when SDKs change.

### 🟧 W7 — Universal app (iPad in scope, manual usability check) (Category E)

- `project.pbxproj:612, 656, 671, 699, 714, 743` — all `TARGETED_DEVICE_FAMILY="1,2"`. iOS 17.0 minimum. `Info.plist:157–167` — iPhone portrait only, iPad all 4 orientations.
- **Fix:** Manual: launch on iPad simulator before submission. Confirm the new AI-generator + voice + occasion flow renders without broken layouts.

---

## 12+ → 4+ Age Rating Feasibility

| Trigger                  | 12+ contributor today?             | 4+ feasible?                       | Notes                                                                                                            |
| ------------------------ | ---------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| UGC without moderation   | Mild                               | YES                                | Server-side moderation in `src/providers/moderation.js`. Shares are private 1:1 links. Answer "infrequent/mild". |
| Unrestricted web access  | Possibly answered YES historically | YES — answer NO                    | App opens only Porizo-controlled domains. No arbitrary WKWebView.                                                |
| AI-generated content     | Not a rating axis                  | NEUTRAL                            | Already disclosed via `contentRightsDeclaration`.                                                                |
| Mature/suggestive lyrics | Possible via AI                    | YES with moderation strength claim | Run a 100-prompt adversarial test before claiming "Profanity: None".                                             |
| Horror/violence          | n/a                                | YES                                |                                                                                                                  |
| Drugs/alcohol            | n/a                                | YES                                |                                                                                                                  |
| Gambling                 | n/a                                | YES                                |                                                                                                                  |
| IAP                      | Doesn't raise rating               | n/a                                |                                                                                                                  |

**Recommendation:** 4+ is achievable but **defer to v1.5.13**. Father's Day is too close to risk a re-review on the age-rating questionnaire. Keep 12+ for v1.5.12, pursue 4+ in v1.5.13 (early July).

---

## Father's Day Deadline Risk Assessment

| Date                  | Milestone                                   | Status / Risk                             |
| --------------------- | ------------------------------------------- | ----------------------------------------- |
| 2026-05-20            | Audit complete                              | ✅ Done                                   |
| 2026-05-21            | Fix 3 blockers + push metadata              | 1 working day; consent UI ~3h             |
| 2026-05-22            | Re-export distribution build, upload to ASC | ~30–60 min after cert installed           |
| 2026-05-23            | Submit for review                           | Saturday acceptable                       |
| 2026-05-24–2026-05-27 | Apple review                                | AI/voice apps sometimes slower; budget 5d |
| 2026-05-28–2026-06-01 | Rejection-fix-resubmit buffer               | One round possible                        |
| 2026-06-02            | Approval + manual release                   | Realistic                                 |
| 2026-06-02–2026-06-15 | 13d to market                               | Sufficient for paid + organic + ASO       |

**Confidence:** **>80%** if blockers fixed by 2026-05-22 and submitted 2026-05-23. Risk rises above 30% if blocker fixes slip past 2026-05-26.

**Fallback plan if running late:** Submit a **1.5.11.x metadata-only update** with just the Father's Day `promotionalText` first (no binary review, typically <24h live). Then ship 1.5.12 with the AI-generator pivot when ready.

---

## Quality Gates

| Gate                             | Result                 | Details                                                                                                 |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run lint`                   | ⚠️ FAIL (pre-existing) | 1 error: `test/web-player-motion-helpers.test.js:136` `no-regex-spaces`. Not introduced by 1.5.12.      |
| `npm test`                       | ✅ PASS                | 588 tests · 582 pass · 6 skipped · 0 fail · 90.8s                                                       |
| Xcode build (Release)            | ✅ PASS                | Archive built 2026-05-19T14:42:51Z, arm64, dev-signed. Needs distribution-cert re-export before upload. |
| Privacy URL 200                  | ✅ PASS                | `https://porizo.co/legal/privacy` → HTTP/2 200                                                          |
| Terms URL 200                    | ✅ PASS                | `https://porizo.co/legal/terms` → HTTP/2 200                                                            |
| Support URL 200                  | ✅ PASS                | `https://porizo.co/support` → HTTP/2 200                                                                |
| ASC: EULA configured             | ✅ PASS                | EULA id `b741bf8c-5cb9-47d6-9be9-db2ee8cdca7d` matches `public/legal/terms.html`                        |
| ASC: 4 consumable IAPs           | ✅ APPROVED            | `gift_token_oneoff`, `gift_bundle_1/3/5`                                                                |
| ASC: 4 subscriptions             | ✅ APPROVED            | `plus_monthly/annual`, `pro_monthly/annual` in group "Porizo Premium" (id 21921151)                     |
| iPhone screenshots               | ✅ PASS                | 6.9": 5 × 1320×2868 / 72dpi / no alpha / PNG. 6.5", 6.3", 6.1" also present.                            |
| iPad screenshots                 | ⚠️ PASS (W2)           | 5 × 2048×2732 / 72dpi / no alpha / PNG                                                                  |
| ASC version 1.5.12 exists        | ❌ FAIL                | Only 1.5.11 exists — must upload binary (B3)                                                            |
| Build 124 uploaded               | ❌ FAIL                | Local archive only                                                                                      |
| Description has no placeholder   | ✅ PASS                | Clean                                                                                                   |
| `contentRightsDeclaration` set   | ✅ PASS                | `USES_THIRD_PARTY_CONTENT` (covers Suno + ElevenLabs + Seed-VC)                                         |
| **Submission checklist overall** | **11/14 PASS**         | Blocked on: binary upload + metadata rewrite + voice consent                                            |

---

## Info / Context

1. `contentRightsDeclaration: USES_THIRD_PARTY_CONTENT` correctly discloses Suno + ElevenLabs + Seed-VC.
2. EULA `b741bf8c-5cb9-47d6-9be9-db2ee8cdca7d` configured in ASC with text matching `public/legal/terms.html`. No EULA blocker.
3. App description is clean: no "coming soon", no Lorem Ipsum, no placeholder. Father's Day pitch correctly scoped to `whatsNew` + `promotionalText` only.
4. Previous audit `marketing/appstore/docs/review-and-submission/app-review-rejection-audit-2026-02-07.md` resolved all blockers from the Feb 2026 cycle (privacy identifier mismatch, retention mismatch, expanded data category disclosure, demo account). Those fixes are still in place.

---

## Pre-Submit Action List (urgency-ordered)

1. **🟥 BLOCKER** Rewrite `whatsNew` and `promotionalText` in `marketing/appstore/metadata/version/1.5.12/en-US.json` — remove "1-minute" claim (B1).
2. **🟥 BLOCKER** Add voice consent toggle to `EnrollmentFlowView.swift` Welcome view (~30 lines SwiftUI) (B2).
3. **🟥 BLOCKER** Re-export archive with distribution signing and upload build 124 to ASC (B3).
4. **🟧 WARNING** Pick an IP-hashing path: update policy text OR implement SHA-256 hashing in audit-log writes (W1).
5. **🟧 WARNING** Visual check on iPad simulator (W7).
6. **🟧 WARNING** Confirm V1 vs V2 paywall ships in 1.5.12 and V2's disclosure is rendered in its view body (W5).
7. **ℹ️ NICE-TO-HAVE** Optional subtitle tightening (W3).
8. **ℹ️ NICE-TO-HAVE** Add AI footer to `/play/:shareId` (W4).

---

## Files Inspected (verification trail)

- `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy` (185 lines)
- `PorizoApp/Info.plist`
- `PorizoApp/PorizoApp/PorizoApp.entitlements`
- `PorizoApp/PorizoApp.xcodeproj/project.pbxproj`
- `PorizoApp/PorizoApp/StoreKitManager.swift`
- `PorizoApp/PorizoApp/SubscriptionView.swift`
- `PorizoApp/PorizoApp/SubscriptionViewV2.swift`
- `PorizoApp/PorizoApp/Flows/EnrollmentFlowView.swift`
- `PorizoApp/PorizoApp/APIClient+Enrollment.swift`
- `PorizoApp/build/PorizoApp-124.xcarchive/Info.plist`
- `public/legal/privacy.html`
- `public/legal/terms.html`
- `src/routes/sharing.js`
- `src/routes/poems.js`
- `src/providers/moderation.js`
- `marketing/appstore/metadata/app-info/en-US.json`
- `marketing/appstore/metadata/version/1.5.12/en-US.json`
- `marketing/appstore/screenshots/current/{6.9,6.5,6.3,6.1,ipad}/*.png`
- `specs/personalized-song-platform-spec.md`

Plus ASC API queries: `asc versions list`, `asc eula get`, `asc subscriptions groups list`, `asc iap list`.
