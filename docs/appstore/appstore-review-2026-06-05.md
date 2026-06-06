# App Store Review Audit — 2026-06-05

**Target:** TestFlight upload of **1.5.15 (build 131)**. Last App Store-approved/live: **1.5.14 (READY_FOR_SALE)**.
**Scope note:** This is a TestFlight binary upload (no screenshots/metadata are submitted with the binary). Full App Store review with screenshots happens at the next _version_ submission.

## What changed vs approved 1.5.14

- Pay-per-song paywall hero (buy `gift_bundle_1` to make one song) — **gated behind `paywall_pay_per_song_enabled`, OFF in production → not rendered for reviewers**.
- Server-computed entitlement gating (`available_song_credits`, `pay_per_song_enabled`), gift_wallet ledger spend.
- No new permissions, SDKs, visible IAP UI, or binary metadata changes. The only user-visible behavior is identical to 1.5.14 while the flag is off.

## Category checks (verified by reading actual files this session)

| #   | Category                     | Result | Evidence                                                                                                                               |
| --- | ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Build / archive              | ✅     | `** ARCHIVE SUCCEEDED **`, Release, `-validate-for-store` passed; 1.5.15(131).                                                         |
| B   | Encryption export compliance | ✅     | `ITSAppUsesNonExemptEncryption = false` in `PorizoApp/Info.plist:168` (no Missing-Compliance prompt).                                  |
| C   | App Tracking Transparency    | ✅     | ATT requested (`PorizoAppApp.swift:411`) AND `NSUserTrackingUsageDescription` present + meaningful in `Info.plist`.                    |
| D   | Permission usage strings     | ✅     | Mic + Contacts strings present and meaningful (pbxproj INFOPLIST*KEY*\*).                                                              |
| E   | Privacy manifest (TN3181)    | ✅     | `PrivacyInfo.xcprivacy` declares FileTimestamp, SystemBootTime, UserDefaults required-reason APIs.                                     |
| F   | Legal (privacy/terms)        | ✅     | https://porizo.co/legal/privacy & /legal/terms both HTTP 200.                                                                          |
| G   | IAP completeness             | ✅     | Subscriptions Plus/Pro monthly+annual APPROVED; consumables gift_bundle_1/3/5 active; prices ASC↔DB synced.                            |
| H   | Metadata / description       | ✅     | Live description clean ("musical style and voice option"); **promo-text voice false-promise fixed this session**; subtitle/name clean. |
| I   | Screenshots (iPhone)         | ✅     | 6.9″ set = 1320×2868, `hasAlpha: no`. (Not part of a TestFlight upload regardless.)                                                    |
| J   | Backend quality gates        | ✅     | `npm test` 588 pass / 0 fail (billing subset 83/83 re-verified).                                                                       |
| K   | Functional change risk       | ✅     | New code is flag-OFF (invisible); no new attack surface (security + adversarial reviewed).                                             |

## Warnings (NOT TestFlight blockers — address before/at next App Store _version_ submission)

1. **Voice over-promise copy in production UI** — `EmptyStateView.swift:45` ("…songs that sound just like you"), `DesignSampleView.swift:1008/1353` ("in your voice" / "your voice singing"). These shipped in the **already-approved 1.5.14** build, so they are not a new rejection risk, but the recovery plan calls for removing voice-cloning promises (tech not shipped). Action: remove/soften before the next App Store submission. See memory `project_no_voice_cloning_tech.md`.
2. **iPad App Store screenshots** still show "In your own voice" / "Your voice singing" pills. Generator source de-voiced this session (local). Not part of a TestFlight upload; re-render + upload with the next App Store _version_ submission.
3. **Legacy consumable** `com.porizo.gift_token_oneoff` ($2.99) still active in ASC but inactive in DB and hidden in-app. Deactivate in ASC to avoid an orphaned purchasable product.

## Verdict

There are no genuine blockers for this TestFlight binary upload: every compliance item that could block (encryption, ATT + usage string, permission strings, privacy manifest, legal URLs, IAP states, validated archive) is present and unchanged from the approved 1.5.14 build, and the only functional change is invisible flag-OFF code.

Verdict: GO
Blockers: 0
Warnings: 3 (all deferred to the next App Store version submission, not this TestFlight upload)
