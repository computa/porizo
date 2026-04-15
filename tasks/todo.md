# Pre-submission Comprehensive Review + Simplification (2026-04-15)

**Goal:** Before submitting next TestFlight build, run `/ce:review` and `/simplify` on every user flow. Fix only confirmed issues; apply only confirmed simplifications. Maintain ship-readiness.

## User Flow Inventory (5 groups, all must be covered)

1. **Auth + Onboarding entry path** — `Onboarding/`, `AuthView`, `AuthManager`, `AccountExistsView`, `PhoneAuthView`, `RootView`
2. **Voice Enrollment** — `VoiceEnrollmentView`, `AudioRecorder`, `APIClient+Enrollment`
3. **Song Creation** — `Flows/WarmCanvasFlowView`, `SongFlowCoordinator`, `StoryFlowCoordinator`, `CreateFlowAsyncService`, `CustomCreateView`
4. **Playback + Library + Sharing + Gifting** — `MySongsView`, `PlayerComponents`, `Tabs/ExploreTabView`, `SharePostcardView`, `GiftSendFlowView`, `Flows/share*`
5. **Launch Flash + Lifecycle + Settings** — `Launch/*`, `MainTabView`, `Tabs/SettingsTabView`, scene-phase handling in `RootView`

## Phases

### Phase A — Parallel REVIEW (5 agents)
- [ ] Dispatch 5 parallel `ce:review`-equivalent agents, one per flow group
- [ ] Each agent identifies CONFIRMED issues only (no speculation)
- [ ] Aggregate findings into a single severity-sorted list

### Phase B — Fix confirmed issues (sequential)
- [ ] Triage by severity (P1 ship-blocker, P2 should-fix, P3 polish)
- [ ] Apply fixes for P1 + P2 only — defer P3
- [ ] Re-build + smoke test after each fix cluster

### Phase C — Parallel SIMPLIFY (5 agents)
- [ ] Dispatch 5 parallel simplification agents on the same flow groups
- [ ] Each agent proposes simplifications that preserve all behavior
- [ ] Aggregate proposals; reject any that risk regressions

### Phase D — Apply confirmed simplifications (sequential)
- [ ] Apply low-risk consolidations + dead-code removal
- [ ] Re-build + smoke test after each simplification cluster
- [ ] Commit logically grouped changes

### Phase E — Verify + commit
- [ ] iOS Debug build succeeds
- [ ] Server tests pass
- [ ] All commits pushed
- [ ] Document findings in `tasks/e2e-testflight-2026-04-15.md` results section

---

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

---

# Meta Ads SDK Integration (Active — 2026-04-11)

**Trigger:** Campaign `PORIZO_INSTALLS_Women25-45_2026Q2` burned $78.30 over 30 days with zero installs. Root cause confirmed: Facebook SDK was never integrated in iOS app. Events Manager shows "Inactive — Never received event" on Porizo dataset (App ID `1984455025792561`).

**Goal:** Wire up Facebook SDK + SKAdNetwork so Meta Ads App Install campaigns can actually measure and optimize for installs.

## Phase 1: iOS SDK Wire-Up (Code)
- [x] Add `FacebookAppID`, `FacebookClientToken`, `FacebookDisplayName`, `FacebookAutoLogAppEventsEnabled`, `FacebookAdvertiserIDCollectionEnabled` to `PorizoApp/Info.plist`
- [x] Add required `fbapi`, `fbauth2`, `fb-messenger-share-api`, `fbshareextension` entries to `LSApplicationQueriesSchemes`
- [x] Add `SKAdNetworkItems` array with Meta's published ad network IDs
- [ ] Add `ApplicationDelegate.shared.application(...)` call in `AppDelegate.didFinishLaunchingWithOptions` (gated behind `#if canImport(FacebookCore)`)
- [ ] Add `AppEvents.shared.activateApp()` call on `scenePhase == .active` (gated behind `#if canImport(FacebookCore)`)

## Phase 2: Build System (User, in Xcode)
- [ ] Open Xcode → File → Add Package Dependencies → `https://github.com/facebook/facebook-ios-sdk`
- [ ] Add `FacebookCore` product to `PorizoApp` target
- [ ] Set `PORIZO_FACEBOOK_CLIENT_TOKEN` env var in .xcconfig (value from Meta App Dashboard → Settings → Advanced → Client Token)
- [ ] Build → verify no FBSDK link errors
- [ ] Archive → upload to TestFlight

## Phase 3: Meta Business Manager Setup (User, in browser)
- [ ] Meta App Dashboard: confirm App ID `1984455025792561` is set up as iOS type with correct bundle ID
- [ ] Copy Client Token from Settings → Advanced
- [ ] Events Manager → Datasets → Porizo → link to App Store app (Porizo, id6758205028)
- [ ] Events Manager → Test Events tab → install TestFlight build → verify `fb_mobile_activate_app` fires
- [ ] Confirm red warning triangle disappears from Porizo dataset (status should flip Inactive → Active)

## Phase 4: Rebuild Campaign (User, in Ads Manager)
- [ ] Delete or archive old `PORIZO_INSTALLS_Women25-45_2026Q2`
- [ ] Create new App Install campaign
- [ ] Budget: $50-100/day minimum (learning phase needs ~50 conversions/week)
- [ ] Geo: single country (Canada — lowest CPM in previous data)
- [ ] Placements: manual — Facebook Feed + Reels + Stories, Instagram Feed + Reels + Stories ONLY. **Exclude Audience Network** and Messenger.
- [ ] Targeting: broad (age 22-55, any gender) — let algorithm optimize once it has conversion signal
- [ ] Creative: use counseling videos `young-couple-reel.mp4` + `established-couple-reel.mp4` from `marketing/remotion/out/facebook/` (3-4 ad variants)
- [ ] Bid: Highest volume
- [ ] Attribution: 7-day click, 1-day view (default)

## Phase 5: Interim Traffic Campaign (Optional Stopgap)
- [ ] If app rebuild is delayed, launch the "Porizo to the rescue" Traffic campaign Meta suggested at $20/day (doesn't need SDK, counts link clicks)
- [ ] Use as bridge for max 2 weeks while SDK integration ships

## Phase 6: Verify
- [ ] After 48h of new campaign: confirm installs are being attributed in Ads Manager
- [ ] Confirm CPM is now in expected $15-30 range (tier-1 women 25-45)
- [ ] Confirm events flowing into Events Manager (not just install — session, signup, render_complete)
- [ ] Document lesson in `tasks/lessons.md`

## Artifacts
- Setup checklist: `docs/marketing/meta-ads-setup-checklist.md` (Phase 2+3 detailed walkthrough)
- Old campaign creative: `marketing/remotion/out/facebook/` (4 video variants, rendered 2026-03-17)
- Previous ad design brief: `marketing/remotion/2026-03-17-counseling-ad-design.md`

---

# Scope expansion: All Ad Platform SDKs (Active — 2026-04-11, build 88+)

**Trigger:** User decision to focus all efforts on marketing. Meta SDK shipped in build 88 to TestFlight. Now adding remaining ad platform SDKs so all campaigns can launch from a single instrumented build.

**Status:** In progress — code-side work, user-blocked on platform credentials.

## Phase 7: TikTok Business SDK
- [x] Add `https://github.com/tiktok/tiktok-business-ios-sdk` v1.6.0 via xcodeproj gem + SPM
- [x] Add `PORIZO_TIKTOK_BUSINESS_ACCESS_TOKEN`, `PORIZO_TIKTOK_BUSINESS_APP_ID`, `PORIZO_TIKTOK_BUSINESS_TIKTOK_APP_ID` keys to Info.plist
- [x] Add `TikTokBiz.isConfigured` runtime guard in PorizoAppApp.swift
- [ ] Wire `TikTokBusiness.initializeSdk(TikTokConfig(...))` call in `AppDelegate.didFinishLaunchingWithOptions`
- [ ] Get Access Token from TikTok Events Manager → Assets → Events → Web Events → API *(user action)*
- [ ] Get numeric TikTok App ID from TikTok Events Manager → App registration *(user action)*
- [ ] Replace `$(PORIZO_TIKTOK_BUSINESS_*)` placeholders in Info.plist with real values *(user action)*

## Phase 8: Apple Search Ads (AdServices.framework)
- [x] Link `AdServices.framework` as weak-linked system framework via xcodeproj gem
- [x] Add `AppleAdsAttribution.captureTokenIfAvailable()` helper in PorizoAppApp.swift
- [x] Add `Notification.Name.appleAdsAttributionTokenCaptured` for backend consumption
- [ ] Wire `AppleAdsAttribution.captureTokenIfAvailable()` in `AppDelegate.didFinishLaunchingWithOptions`
- [ ] Backend: implement endpoint to receive the token and call `https://api-adservices.apple.com/api/v1/` to resolve campaign metadata *(deferred)*
- [ ] Apple Search Ads campaign setup in https://searchads.apple.com *(user action, only if running Apple Search Ads)*

## Phase 9: Google Ads (UAC — Universal App Campaigns)
- [x] Verified Firebase Analytics is already integrated (provides Google Ads attribution for UAC)
- [x] Confirmed GoogleAdsOnDeviceConversion SDK is in Package.resolved as transitive dep (not needed for MVP)
- [ ] Add Google's SKAdNetwork IDs to Info.plist
- [ ] Link Firebase Analytics to Google Ads account in Google Ads → Tools → Linked accounts → Firebase *(user action)*
- [ ] Configure UAC campaign in Google Ads *(user action, only if running Google Ads)*

## Phase 10: Cross-Platform SKAdNetwork IDs
- [x] Meta's 30 IDs added
- [ ] Add TikTok's ~15 published ad network IDs
- [ ] Add Google's ~8 published ad network IDs
- [ ] Dedup against existing entries

## Phase 11: Multi-SDK Build Verification
- [ ] Build for simulator with all 3 new SDKs
- [ ] Launch + verify init log lines for each: `[FBSDK] Initialized`, `[TikTokBiz] Initialized` or `Skipped`, `[AppleAds] Captured` or `No token available`
- [ ] No crashes regardless of which credentials are missing
- [ ] Release config build + archive verification

## Phase 12: Docs + Rollout
- [ ] Extend `docs/marketing/meta-ads-setup-checklist.md` with TikTok + Apple Search Ads + Google Ads sections
- [ ] Document MMP (AppsFlyer/Adjust/Singular) as future option when spend > $10K/month
- [ ] Ship new TestFlight build (89) once all SDKs are wired
