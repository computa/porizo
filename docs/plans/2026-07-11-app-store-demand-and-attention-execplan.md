# Build Porizo's App Store demand and attention engine

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. It follows `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Porizo already ranks for high-intent song-gift phrases, but ranking has not become meaningful traffic or usage. This program makes the acquisition loop measurable, earns more trustworthy rating evidence, publishes the regional metadata that currently exists only on disk, routes search intent to the right custom product page, and gives recipients an Apple-native path into the product. Success is visible as an attributable funnel from App Store impression to download, completed gift, recipient action, and review rather than as rank alone.

## Progress

- [x] (2026-07-11 03:20 AWST) Audited current rankings, Apple Ads terms, live metadata, reviews, custom product pages, App Tags, App Clips, product-page experiments, in-app events, promoted purchases, and featuring nominations.
- [x] (2026-07-11 03:25 AWST) Confirmed the title decision: preserve `Porizo: Song Gift Maker`.
- [ ] P0: Restore official App Store acquisition analytics access and produce a repeatable search/browse funnel report. The fail-loud command is implemented; the ASC API-key role change remains external.
- [x] (2026-07-11 03:36 AWST) P1: Replace review gating with a direct, policy-aligned native review request at a verified emotional success moment; 4 focused tests pass.
- [x] (2026-07-11 03:47 AWST) P1: Route recipient-played notifications through configured OneSignal external IDs, retaining raw APNs as fallback; focused service tests and lint pass.
- [x] (2026-07-11 03:43 AWST) P2: Prepare the evergreen US keyword field, preserving the title and removing unsupported or off-season tokens.
- [x] (2026-07-11 03:44 AWST) P2: Publish and verify `en-AU`, `en-GB`, and `en-CA` localizations on editable version 1.5.27; live readback confirms 99-character keyword fields and complete descriptions.
- [x] (2026-07-11 03:39 AWST) P3: Record and verify all five visible CPP IDs and URLs in a machine-readable manifest; live audit passes.
- [ ] P3: Add CPP conversion measurement and route owned web/email/social links to intent-matched CPP URLs. Measurement is blocked by the ASC analytics role.
- [ ] P3: Create a product-page optimization experiment only after the analytics report can measure it.
- [ ] P4: Implement the smallest useful App Clip: code, receiver attribution, preview playback, AASA contract, embedding, and simulator build are complete. Apple identifier provisioning and physical invocation remain.
- [x] (2026-07-11 03:50 AWST) P5: Create and submit the Australian Father’s Day event with en-AU copy, AU-only schedule, deep link, and two processed assets; event `6789699290` is `WAITING_FOR_REVIEW`. A truthful 1.5.27 featuring nomination is drafted but held until App Clip provisioning succeeds.
- [ ] P5: Investigate the live zero-App-Tags state and record the App Store Connect/support resolution.
- [x] (2026-07-11 04:01 AWST) P6: Run focused and full validation, update operating docs, and record final evidence and remaining external gates. Backend: 3,198 tests, 0 failures; ASO: 60 tests, 0 failures; review policy: 4 tests, 0 failures; lint and iOS parent+embedded-Clip simulator build pass.

## Surprises & Discoveries

- Observation: Only `en-US` exists in live App Store Connect version and app-info localizations even though `en-AU`, `en-GB`, and `en-CA` files exist under `PorizoApp/fastlane/metadata/`.
  Evidence: `asc localizations list` returned one `en-US` version localization and one `en-US` app-info localization.
- Observation: Porizo has five approved, visible custom product pages but no product-page optimization experiment.
  Evidence: `asc product-pages custom-pages list` returned five visible pages; the v2 experiments endpoint returned no experiment.
- Observation: Porizo has zero App Tags, zero App Clips, and zero promoted purchases. The only in-app event is the past Father's Day 2026 event.
  Evidence: read-only `asc app-tags`, `asc app-clips`, `asc iap promoted-purchases`, and `asc app-events` queries on 2026-07-11.
- Observation: The current App Store Connect API key can manage metadata but is forbidden from analytics report requests.
  Evidence: `asc analytics requests --app 6758205028` returned an API-key permission error.
- Observation: The `Porizo Reports` ASC profile can list analytics requests but the collection is empty and that key cannot create the ongoing request. The regular `Porizo` profile cannot list the collection.
  Evidence: profile-specific read/create probes on 2026-07-11. An Admin must create the request once; subsequent reporting should use `Porizo Reports`.
- Observation: The live review corpus is only two written reviews, while the app's strongest review trigger depends on the unresolved production APNs path and fallback thresholds require five plays or two shares.
  Evidence: `asc reviews list` plus `PorizoApp/PorizoApp/Services/ReviewManager.swift`.
- Observation: The submitted March featuring nomination describes voice conversion, conflicting with current truthful product constraints.
  Evidence: nomination `85f0986e-6a25-4d72-b7cc-c8ce5072736c` is still submitted.
- Observation: Regional metadata bulk push created empty version localizations before returning a duplicate-locale error.
  Evidence: live readback showed `en-AU`, `en-GB`, and `en-CA` records with null fields. The idempotent `apply-version-localizations.mjs` updater then filled each record and readback verified all four locales.
- Observation: Production has OneSignal credentials but no raw APNs credentials; the recipient-completion route used only raw APNs even though the iOS app links authenticated users through `OneSignal.login(user.id)`.
  Evidence: Railway variable-name audit and route/service inspection on 2026-07-11. The route now uses OneSignal by external ID and raw APNs only as fallback.
- Observation: The live AASA file used the obsolete app identifier `5VCH6937XM.com.porizo.PorizoApp`; the shipping identifier is `5VCH6937XM.porizo.ios.app.PorizoApp`.
  Evidence: live AASA readback and Xcode build settings. The canonical dynamic/static AASA sources and contract test are corrected; production deployment remains required.
- Observation: The App Clip compiles and embeds in the simulator build, but device signing fails until Apple provisions `porizo.ios.app.PorizoApp.Clip` with App Clip and Associated Domains capabilities.
  Evidence: simulator parent build succeeded; direct device-SDK target build reported missing capabilities in the wildcard profile.
- Observation: The public ASC API can create generic explicit App IDs but cannot create the parent-linked App Clip identifier type. A generic identifier and its profiles were tested, shown to lack the on-demand-install and parent-app entitlements, then deleted from Apple and the local profile store.
  Evidence: decoded development profile plus Apple’s App Clip registration documentation. The remaining identifier action is web-portal-only.

## Decision Log

- Decision: Preserve `Porizo: Song Gift Maker` and treat generic AI-generator keywords as a measured support lane, not the default identity.
  Rationale: Gift/occasion Apple Ads produced seven installs from thirteen taps in the latest reviewed window, while the AI-generator lane had no impressions and has difficulty near 90 against established incumbents.
  Date/Author: 2026-07-11, Ambrose and Codex.
- Decision: Fix measurement and rating evidence before scaling paid traffic.
  Rationale: Apple uses behavior, downloads, ratings, and reviews alongside text relevance. More impressions without conversion evidence will not create durable visibility.
  Date/Author: 2026-07-11, Codex.
- Decision: Keep live App Store mutations reversible and evidence-gated.
  Rationale: Metadata, events, nominations, and CPP assignments affect production discovery and must be verified after each mutation.
  Date/Author: 2026-07-11, Codex.
- Decision: Do not create an artificial non-consumable purchase merely to gain search placement.
  Rationale: Porizo's approved gift products are consumables, and Apple states consumables do not appear in search results. Product truth takes precedence over a discoverability hack.
  Date/Author: 2026-07-11, Codex.
- Decision: Use OneSignal for authenticated recipient-played transactional delivery rather than adding a second production credential stack solely for this event.
  Rationale: The app already establishes the user-to-OneSignal external-ID mapping and production has the required OneSignal credentials. This removes a dead configuration dependency while preserving APNs fallback for existing raw-token flows.
  Date/Author: 2026-07-11, Codex.

## Outcomes & Retrospective

Planning and code-owned implementation are complete. Review acquisition, recipient-played delivery, regional metadata, CPP drift detection, the bounded receiver App Clip, corrected Universal Links, and the next AU seasonal event are implemented. Version 1.5.27 exists in `PREPARE_FOR_SUBMISSION`; live metadata readback is complete. Production AASA and recipient delivery code were deployed and health-checked. Remaining work is externally gated: ASC analytics role, App Clip identifier/profile/default experience, physical invocation evidence, Apple-generated App Tags, and conversion data after traffic accrues.

## Context and Orientation

The canonical marketing operating procedure is `docs/marketing/PIPELINES.md`. App Store keyword and rank state lives under `marketing/appstore/aso/`; metadata is mirrored in `marketing/appstore/metadata/` and `PorizoApp/fastlane/metadata/`. The iOS review flow is owned by `PorizoApp/PorizoApp/Services/ReviewManager.swift`, `PorizoApp/PorizoApp/Views/ReviewPrePromptSheet.swift`, and integration call sites in player, render, sharing, and app-root views. Production push delivery is owned by `src/services/push-notification.js` and sharing routes.

A custom product page (CPP) is an alternate App Store page with intent-specific screenshots, promotional text, and an optional app deep link. An App Clip is a small Apple-distributed part of the iOS app that can launch from a URL without installing the full app.

## Plan of Work

Milestone 1 establishes measurement and review acquisition. Repair App Store Connect analytics credentials or document the exact external role change, add a read-only reporting command that fails loudly when data is unavailable, and remove the custom positive/negative pre-prompt gate. The native StoreKit review request should occur after a first verified high-value outcome and remain subject to Apple's system limits. Negative feedback should use a separate support path rather than controlling who may see Apple's prompt. Verify APNs configuration independently; never place private keys in the repository.

Milestone 2 prepares metadata and localizations. Keep the title and subtitle. Replace unsupported `voice` and expired seasonal tokens with evidence-backed evergreen intent while retaining a measured `ai` support token. Add regional metadata to the actual next editable App Store version and app-info localizations, then read them back from App Store Connect before considering the milestone complete.

Milestone 3 turns CPPs into an operating system. Inventory approved versions, deep links, localizations, assets, and keyword relationships in a machine-readable manifest. Every keyword cluster gets one page. Owned links use the matching CPP URL. A report compares page impressions, downloads, and conversion when analytics access is restored. No experiment starts without a baseline and enough traffic to make a decision.

Milestone 4 implements the App Clip as a bounded recipient flow. Reuse existing share/receiver APIs and playback policy. The clip must not contain creation, billing, account management, or sender-only library behavior. It accepts an invocation URL, resolves the recipient session, plays the gift, records attribution, and offers a full-app continuation with the receiver handoff preserved. If the resulting binary or entitlement design exceeds App Clip constraints, record the blocker rather than weakening security.

Milestone 5 establishes Apple-native attention operations. Prepare a legitimate upcoming event with accurate dates and deep link, create a new nomination tied to shipped functionality, and investigate why App Tags are absent. Update `docs/marketing/PIPELINES.md` so weekly status covers analytics permission, reviews, localizations, tags, CPP conversion, and events.

## Concrete Steps

Work from the repository root. Start with focused tests, then run the full gates:

    npm run lint
    npm test
    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -configuration Debug -sdk iphonesimulator build

Use `asc` read commands before and after any App Store mutation. Never infer success from a write response alone. Re-read the mutated localization, CPP, event, or nomination and record its ID and state in this plan.

## Validation and Acceptance

Measurement is accepted when a documented read-only command reports App Store Search and Browse impressions, product-page views, first-time downloads, and conversion by equal date windows, or exits with a precise permission remediation instead of returning zeros.

Review acquisition is accepted when tests prove the first eligible success can request the native review prompt, repeated events respect cooldown policy, failed/cancelled flows never request it, and no custom yes/no gate controls access to Apple's review prompt.

Localization is accepted only when App Store Connect readback returns `en-US`, `en-AU`, `en-GB`, and `en-CA` for app-info and the target editable version, with locale-appropriate keywords and no duplicate title/subtitle words except a documented CPP-assignment requirement.

CPP work is accepted when a manifest and live readback agree on five page IDs, approved versions, deep links, unique keyword ownership, and routed URLs. App Clip work is accepted when a clean install can open a representative share invocation, play authorized media, preserve receiver attribution, and continue into the full app.

## Idempotence and Recovery

Read-only audits and local generators must be safe to repeat. Metadata and localization writes must export the live state first and keep rollback files. Never delete an approved CPP or old nomination to make the dashboard cleaner. If an App Store write partially succeeds, stop, read back the state, and continue from the server's state rather than rerunning the whole batch blindly.

The worktree contains unrelated ASO, iOS metadata, parity, and documentation changes. Only files named in this plan may be staged for this program, and existing user changes must be preserved.

## Artifacts and Notes

Primary evidence captured before implementation:

    Gift/occasion Apple Ads: 114 impressions, 13 taps, 7 installs.
    Live reviews returned by ASC: 2.
    Live regional localizations: en-US only.
    Visible approved CPPs: 5.
    App Tags: 0. App Clips: 0. Product-page experiments: 0.

## Interfaces and Dependencies

Use StoreKit's native review API through one `ReviewManager` boundary. Use existing receiver-session, handoff, streaming, and attribution contracts for the App Clip; do not create parallel backend endpoints unless an App Clip constraint proves the existing contract unsuitable. Use `asc` for App Store Connect reads and reversible writes. Production APNs secrets remain in Railway variables and Apple Developer credentials, never source control.

Revision note 2026-07-11: Initial implementation-ready plan created from live App Store Connect inspection and repository evidence.

Revision note 2026-07-11 04:02 AWST: Code-owned implementation and validation completed. Overall plan is approximately 80% complete; remaining gates require Apple account changes or observed production traffic rather than additional speculative code.

Revision note 2026-07-11 04:09 AWST: Added and verified the shared App Clip invocation scheme, isolated the required web-only parent-linked identifier registration, removed invalid generic identifier/profile artifacts, and found the dedicated read-only analytics credential. Overall plan is approximately 85% complete.
