---
title: "Android Skip Third-Party, Toolchain, and Migration Ledger"
date: 2026-06-30
status: u0-ready
source_plan: docs/plans/2026-06-30-001-feat-android-via-skip-plan.md
execution_plan: docs/plans/2026-06-30-002-feat-android-skip-parallel-agents-plan.md
---

# Android Skip Third-Party, Toolchain, and Migration Ledger

## Release Scope

| Release | P0 Scope | Explicitly Not P0 |
| --- | --- | --- |
| Android Recipient MVP | Verified App Link/deferred handoff; auth/session; Android device trust; claim/play; bound stream/key access; playback failure states; analytics/audit/crash minimum; support path; basic accessibility. | Creator create/render, voice enrollment, purchases, marketing push parity, settings/account breadth, tablet/foldable layout, Android Auto/Wear OS. |
| Android Full Parity | Creator create/render; voice enrollment; purchases/entitlements; push polish; settings/account; analytics/attribution parity; Play packaging and Data Safety; full iOS P0 flow parity. | Tablet/foldable optimization, Android Auto/Wear OS, optional on-device Whisper unless U2 proves SpeechRecognizer quality is unacceptable. |

## SDK Ledger

| SDK / Surface | Current Evidence | Current Role | Android Handling | Recipient MVP / Full Parity | Privacy / Secrets Notes |
| --- | --- | --- | --- | --- | --- |
| Firebase | `PorizoApp/PorizoApp/PorizoAppApp.swift:367`, `PorizoApp/PorizoApp/Services/AnalyticsService.swift:146`, `PorizoApp/PorizoApp.xcodeproj/project.pbxproj:821` | iOS Firebase Core, Crashlytics, Analytics. Transactional push is not Firebase today. | Native Android Firebase SDK; optionally SkipFirebase for FCM wrapper after U2. | MVP: not blocking unless crash minimum chooses Firebase. Full: blocking for crash/analytics/push parity. | `GoogleService-Info.plist` is public client config. Privacy manifest tracks Google/Firebase domains at `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:7`. |
| Amplitude | `PorizoApp/PorizoApp/Services/AnalyticsService.swift:10`, `src/services/client-config-service.js:57`, `PorizoApp/PorizoApp.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved:14` | Optional product analytics sink through `/app/config` `AMPLITUDE_API_KEY`. | Defer for MVP or send MVP audit events to backend; native Android SDK for full analytics parity. | MVP: not blocking. Full: parity-only. | Client key is publishable/rotatable; product interactions are tracking-relevant. |
| AppsFlyer | `PorizoApp/PorizoApp/PorizoAppApp.swift:56`, `PorizoApp/PorizoApp/Services/AnalyticsService.swift:198`, `src/services/app-link-service.js:12` | Attribution, conversion/purchase events, deferred deep links for receiver handoff. | Native Android AppsFlyer SDK plus Android App Links; reuse server OneLink generation where valid. | MVP: blocking if install-after-share deferred claim is in scope; App Links are blocking either way. Full: blocking for attribution parity. | Dev key/App ID are client identifiers (`project.pbxproj:599`) but should not be logged. |
| Facebook / Meta | `PorizoApp/PorizoApp/PorizoAppApp.swift:153`, `PorizoApp/PorizoApp/Services/AnalyticsService.swift:255`, `src/services/social-token-verifier.js:349` | Meta app events/ads attribution and Facebook OAuth verification. | Native Android Facebook SDK only if ads/login parity is needed; backend token verification remains server-side. | MVP: not blocking if email auth is available. Full: blocking for Facebook login or Meta paid-attribution parity. | Client token/ads app id are client-side; `FACEBOOK_APP_SECRET` is server-only. ATT gates IDFA on iOS (`PorizoAppApp.swift:425`). |
| OneSignal | `PorizoApp/PorizoApp/PorizoAppApp.swift:33`, `PorizoApp/PorizoApp/Services/LocalNotificationService.swift:48`, `src/services/onesignal.js:1` | iOS marketing push SDK and backend REST marketing sends. Transactional pushes are APNs separately. | Native Android OneSignal SDK for marketing push; FCM/APNs provider abstraction for transactional push. | MVP: not blocking. Full: blocking for marketing push parity; transactional Android push belongs to U8d. | App ID is public (`AppConfig.swift:122`); REST API key is server-only; external IDs are user IDs. |
| TikTok | `PorizoApp/PorizoApp/Services/TikTokShareService.swift:11`, `PorizoApp/PorizoApp/Services/TikTokShareService.swift:58`, `PorizoApp/PorizoApp.xcodeproj/project.pbxproj:853` | TikTok Share Kit for share-card export; Business attribution appears placeholder/empty. | Native Android TikTok OpenSDK; defer TikTok Business SDK unless paid TikTok launches. | MVP: not blocking. Full: only blocking for TikTok share/paid-attribution parity. | Requires Photos/media permission. Real TikTok Business access token must stay server-side; current Xcode value is empty/placeholder (`project.pbxproj:625`). |
| PhoneNumberKit | `PorizoApp/PorizoApp/Util/PhoneNumberNormalizer.swift:5`, `PorizoApp/PorizoApp/Util/PhoneNumberNormalizer.swift:17`, `PorizoApp/PorizoApp.xcodeproj/project.pbxproj:813` | E.164 normalization for one-tap recipient sends. | Native Android `libphonenumber` or server normalization; do not Skip-bridge iOS PhoneNumberKit. | MVP: not blocking for recipient claim/play. Full: blocking for SMS/contact send parity. | Phone numbers are PII; backend normalization exists in `src/services/sms-service.js:104`. |
| ATT / AppTrackingTransparency | `PorizoApp/PorizoApp/PorizoAppApp.swift:19`, `PorizoApp/PorizoApp/PorizoAppApp.swift:425`, `PorizoApp/Info.plist:71` | iOS permission gate for attribution SDK IDFA use. | Android AAID consent/Data Safety handling only if attribution SDKs collect ad ID. | MVP: not blocking. Full: blocking for paid-attribution compliance/quality. | Privacy manifest declares tracking and tracking domains at `PorizoApp/PorizoApp/PrivacyInfo.xcprivacy:5`. |
| AdServices / Apple Ads | `PorizoApp/PorizoApp/PorizoAppApp.swift:105`, `PorizoApp/PorizoApp/Services/AppleAdsAttributionService.swift:30`, `src/routes/analytics.js:93` | Apple Search Ads attribution token capture and server-side resolution. | No Android equivalent; replace with Play Install Referrer / Google Ads / AppsFlyer as needed. | MVP: not blocking. Full: Android paid-attribution parity only. | Attribution token is posted server-side to Apple; campaign IDs are linked to user records. |
| StoreKit / RevenueCat | `PorizoApp/PorizoApp/StoreKitManager.swift:9`, `PorizoApp/PorizoApp/StoreKitManager.swift:509`, `src/routes/billing.js:637`, `src/routes/billing.js:770` | iOS StoreKit 2 purchases; backend is entitlement authority. Google subscription validation exists. No RevenueCat integration found. | Native Play Billing, Skip Marketplace, or RevenueCat broker only to obtain Google purchase tokens; server remains authority. | MVP: not blocking. Full: blocking for subscriptions/gift purchases. | Apple private key and Google service account are server-only. Follow-up: `server.js` reads Google Play config, while `src/config.js` currently lacks `GOOGLE_PLAY_*` definitions/exports. |

## Legal And Toolchain Ledger

| Component | Current Evidence | License / Obligation | Gate A Status |
| --- | --- | --- | --- |
| Skip CLI / SkipStone | Local `skip version` -> 1.9.4. GitHub API for `skiptools/skipstone` reports `AGPL-3.0`. | Treat `skipstone` as AGPL-3.0 build tooling/plugin. Legal review must confirm whether generated artifacts and build-time use are acceptable before committing generated Skip project output. | Blocks Gate A verdict until reviewed. |
| Skip Fuse UI | GitHub API for `skiptools/skip-fuse-ui` reports `MPL-2.0`; Skip docs show Fuse dependency `https://source.skip.tools/skip-fuse-ui.git`. | MPL-2.0 component; preserve notices and source availability for modified MPL-covered files. | Review required before merged dependency. |
| SkipAV | GitHub API for `skiptools/skip-av` reports `MPL-2.0`. | MPL-2.0 component; review Android playback/recording scope in U2. | Review required before U7. |
| skip-keychain | GitHub API for `skiptools/skip-keychain` reports `MPL-2.0`. | MPL-2.0 component; candidate for Android Keystore-backed secure storage. | Review required before U3a/U4. |
| Skip Marketplace | Skip docs show active module releases through `0.4.1` on 2026-06-27. | Candidate purchase adapter only; not entitlement authority. Must verify Play Billing fit in U2/U1. | Blocks billing adapter choice, not Recipient MVP. |
| SkipFirebase | Skip docs show active module releases through `0.20.0` on 2026-06-17. | Candidate Firebase wrapper for Android FCM/crash/analytics. Must verify whether direct native SDK is simpler. | Blocks U8d/U9 choice, not Recipient MVP. |
| Local Android toolchain | `skip doctor` passed outside sandbox with Gradle 9.6.1, Java 26.0.1, Android SDK 37.0.0, ADB 1.0.41. | Toolchain is reproducible locally, but sandboxed Gradle can false-fail because of native-cache restrictions. | Ready for build/spike; hardware still missing. |
| Physical Android hardware / emulator | `adb devices -l` returned no attached Android devices; `skip devices` listed no Android devices. Follow-up Argent `list-devices` returned no devices and no AVDs, and the local SDK has no `emulator/` package installed. | Physical hardware is required for U1 30-minute run, Gate B, U7/U8/U9 hardware confidence. Emulator can supplement UI smoke testing, but cannot replace the physical-device Gate A proof. | Blocks Gate A pass until a physical Android device is attached and tested. |

Primary references:

- `https://skip.dev/docs/modes/`
- `https://skip.dev/docs/project-types/`
- `https://skip.dev/docs/modules/skip-marketplace/`
- `https://skip.dev/docs/modules/skip-firebase/`
- `https://github.com/skiptools/skipstone`
- `https://github.com/skiptools/skip-fuse-ui`
- `https://github.com/skiptools/skip-av`
- `https://github.com/skiptools/skip-keychain`

## Backend Migration Reservations

Latest PostgreSQL migration at U0: `123_drop_sqlite_legacy_billing_artifacts.sql`.

Duplicate numeric prefixes already exist (`080`, `120`, `121`). The runner sorts full filenames and records full filename IDs (`src/database/postgres.js:397`, `src/database/postgres.js:415`), so duplicates are technically tolerated but must not be introduced by Android parallel work.

| Stream Task | Primary Migration | Reserved Overflow | Ownership Notes |
| --- | --- | --- | --- |
| U8a-server: email magic-link auth | `124_email_magic_link_auth.sql` | `125_email_magic_link_auth_followup.sql` | Owns auth-token tables/service additions. |
| U8b-server: App Links + device trust | `126_android_device_trust.sql` | `127_android_device_trust_followup.sql` | Asset Links may be static-only; use migration only for attestation/App Set state. |
| U6-server: Google consumable route | `128_google_consumable_ledger.sql` | `129_google_consumable_ledger_followup.sql` | Owns purchase ledger/catalog/idempotency schema if needed. |
| U8d: provider-aware push | `130_push_provider_environment.sql` | `131_push_provider_environment_followup.sql` | Owns provider/environment push-token fields. Do not rebuild the existing `devices.platform` column. |

## Backend Reality Evidence

| Claim | Evidence |
| --- | --- |
| Passwordless email is absent | Password auth schemas require email + password in `src/routes/auth.js:518` and `src/routes/auth.js:532`; password credential creation is at `src/routes/auth.js:735`; phone OTP exists at `src/routes/auth.js:2507`, `src/routes/auth.js:2604`, `src/routes/auth.js:2714`; searches for passwordless/magic-link/email OTP found no implementation. |
| `devices.platform` exists | `migrations/pg/022_add_devices.sql:3`; repository reads/writes it at `src/database/device-repository.js:4`, `src/database/device-repository.js:21`, `src/database/device-repository.js:35`. |
| Google one-time helper exists but consumable route is absent | `verifyPurchase()` exists at `src/services/google-receipt-validator.js:273`; product acknowledgement support exists at `src/services/google-receipt-validator.js:360`; Apple consumable route is at `src/routes/billing.js:359`; Google subscription receipt route is at `src/routes/billing.js:762`; no route uses `verifyPurchase(`. |
| Device binding is client-asserted and unattested | `/device/register` accepts client `device_id`, `platform`, `push_token` at `src/routes/enrollment.js:517`; device JWT signing at `src/routes/enrollment.js:533` and `src/services/device-token.js:28`; claim uses token `device_id/platform` at `src/routes/sharing.js:1896` and binds transactionally at `src/database/share-token-repository.js:233`; no Play Integrity/App Set/attestation implementation found. |
| Transactional push is APNs-only today | `src/services/push-notification.js:1`, APNs token validation at `src/services/push-notification.js:95`, APNs sends at `src/services/push-notification.js:179` and `src/services/push-notification.js:227`; render completion calls at `src/workflows/runner.js:3337`; OneSignal marketing service is separate at `src/services/onesignal.js:1`. |
