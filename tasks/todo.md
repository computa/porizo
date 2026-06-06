# ACTIVE — Viral-loop gap-close (2026-06-06)

**Source:** review of `docs/porizo-monetization-viral-decisions-2026-06.md` §F + `docs/porizo-recovery-plan-2026-06.md` Issue 2 (P0). Supersedes the open V-B / V-D items in the (prior) viral-loop plan below.
**Method:** `/executing-plans` → implement → `/ce-review-code` per change → `finishing-a-development-branch`.
**Branch:** `feat/viral-loop-gap-close` — do NOT implement on `main`.

## Verified state (2026-06-06)

- 🔴 `APPSFLYER_ONELINK_BASE_URL` **absent in Railway prod** (0/90 vars) → every recipient gets the plain `/download` fallback that does NOT survive an App Store install. OneLink never fires.
- 🔴 `receiver_sessions.matched_user_id` **never back-populated** after signup (`markAppOpened` called w/o `userId` at `sharing.js:1112`; no back-link in `auth.js`) → recipient→registration stays NULL even if a deep link landed.
- iOS deep-link wiring (`PorizoAppApp.swift` `DeepLinkDelegate` → `handleMakeOneBack`) and server OneLink builder (`app-link-service.js`) are **already built** — just dark.
- Web V-A **teaser** copy (`web-player/index.html:140`) still "Save this song in Porizo" (only post-play CTA was converted).
- V-B keepsake features (HD download / reveal video / lyric card / library) **do not exist** in the app (0 matches) → copy promising them = false promise.

## Tasks (status: ⬜ todo · 🔵 wip · ✅ done · ⛔ decision)

### G — Attribution (closes V-D, the real blocker)

- [x] **G1. matched_user_id back-link at registration — ✅ DONE + tested.** `auth.js`: added `matchReceiverAttribution(userId, clientIp)` (mirrors the proven `matchDownloadAttribution` IP + 72h-window backfill), fired fire-and-forget at all 3 signup sites (email/social/phone). Idempotent (`WHERE matched_user_id IS NULL`). Server-only — no iOS/schema change (claim is anonymous, so no deterministic userId there; IP backfill is the established pattern). Test: `test/receiver-attribution.test.js` (same-IP attributes, different-IP does not) — 2/2 green; `registration-country-attribution` 2/2, `receiver-session` 23/23 green.
- [x] **G2. Smart App Banner `app-argument` — ❎ DROPPED.** Redundant + ineffective: `app-argument` only passes to an _already-installed_ app (does NOT survive a fresh App Store install — the actual gap), and the in-page OneLink CTA (`receiverSaveUrl`) already covers both installed (direct deep link) and fresh-install (deferred) cases. Adding it = speculative complexity that doesn't move recipient→registration. Real fix = G1 + G3.
- [ ] **G3. `APPSFLYER_ONELINK_BASE_URL` in Railway prod** — ⏳ AWAITING URL from Ambrose (walkthrough provided). Code path already built (`app-link-service.js`); set the var via `rw-use abcobimma` once the OneLink template URL exists.
- [ ] **G4. End-to-end verify** — after G3 (install → pre-filled "make one back" → attributed registration via DB query on `receiver_sessions.matched_user_id`).

### B — Web V-A teaser copy

- [x] **B1. ✅ DONE.** `index.html` teaser headline → `id="teaser-unlock-headline"`; `player.js` `endTeaser()` sets it sender-aware + keepsake-framed: `senderName ? "Keep {Sender}'s song forever" : "Save this song in Porizo"` (textContent only). Deliberately NOT "make one back": the teaser fires mid-song (preview end), so reply reciprocity stays at post-play (already shipped) — mid-song is too early to ask the recipient to create. Lint clean.

### C — V-B keepsakes — ❎ DROPPED (Ambrose 2026-06-06)

- features don't exist (0 matches); promising them = false promise. Revisit as a real feature build later, not copy.

### D — Sender-reciprocal-free — ⏸️ DEFERRED (Ambrose 2026-06-06)

- recipient-first-free already holds via `free_tier_songs_grant`; don't touch billing until attribution proves the loop converts.

## Status: code complete + reviewed for this batch.

- G1 ✅, B1 ✅; G2 ❎ dropped (redundant). `/ce-review-code` ran (4 personas: security/correctness/testing/maintainability).
- Review fixes applied: `"unknown"`-IP guard; dropped `download_attributed_at` overload; two-writer comment; tests expanded to 8 (email/social/phone call sites, isNewUser gate, idempotency, 72h boundary, most-recent-candidate, deterministic negatives).
- Verify: ESLint clean; 33/33 tests green (registration-country 2 + receiver-session 23 + receiver-attribution 8); diff surgical (auth.js +38, player.js +12, index.html +2−1) — formatter pollution reverted.
- Residual (noted, non-blocking): XFF-spoof/shared-NAT mis-attribution is pre-existing + analytics-only (inherited from `matchDownloadAttribution`); web teaser headline has no JS test harness.
- ⏳ Remaining: G3 (set `APPSFLYER_ONELINK_BASE_URL` once Ambrose provides the OneLink URL) → G4 verify. Then commit.

---

# Active Plan — Unify paywall to ONE canonical screen (SubscriptionViewV2 / Direction A)

**Goal:** Every paywall/subscription surface uses the ONE design we decided in the
design-consultation (Direction A, implemented in `SubscriptionViewV2`): header "Make a
song" → pay-per-song hero (one-tap buy) → "or subscribe & save" → progressive-disclosure
subscription teaser ("See all plans" expander). No second/different paywall.

**Source of truth:** `SubscriptionViewV2.swift` (the decided design). Decision log:
`docs/porizo-monetization-viral-decisions-2026-06.md` §I/§K ("the live paywall is
SubscriptionViewV2 — refine that one").

**User decisions locked (2026-06-05):**

- Out-of-credits → slim "you're out, Upgrade" interstitial → the unified paywall (one tap on the paywall hero buys).
- One-off = single song only ($2.99). NO multi-song bundles for now.
- Hide the Free plan option once the user's free song is used.

## Tasks

- [x] **U-1 Thread context into V2.** Add `var recipientName: String? = nil` and
      `var offerPayPerSong: Bool = true` to `SubscriptionViewV2`. Pass `recipientName` into
      `PayPerSongHeroView(storeKit:recipientName:)`. Drive `heroActive =
offerPayPerSong && PayPerSongHeroView.shouldDisplay(storeKit:)` so a POEM context
      (offerPayPerSong:false) falls back to the existing subscription-first layout (songs-only
      invariant preserved).
- [x] **U-2 Point create-flow at V2.** `WarmCanvasFlowView.swift:1053` `.upgrade` case →
      present `SubscriptionViewV2(apiClient:storeKit:recipientName: setup.recipientName,
offerPayPerSong: resolvedSelectedType == .song)` instead of the old `SubscriptionView`.
- [x] **U-3 Slim the out-of-credits interstitial.** `NoCreditsView`: drop the
      `payPerSongPrice` param + fake-buy CTA; primary CTA becomes "Make another song" (opens
      the paywall via the existing `onUpgrade`). Price now lives ONLY on the paywall hero (kills
      the double-buy-button confusion). Update the `.noCredits` call site (remove the
      `pendingEntitlementFlowType == .song` price gate; keep `onUpgrade`).
- [x] **U-4 Hide Free when free song spent (#1).** In V2 `planCards`, filter out the `free`
      tier card when `currentCredits == 0` (out of credits) — Free stays only while actionable.
- [x] **U-5 Retire old V1 `SubscriptionView`** once unreferenced in production: delete the
      file + the `V1ScreenCatalogView.swift:185` entry (verify nothing else imports it). Defer
      if it risks the build; otherwise dead-code removal.
- [x] **U-6 Verify.** `xcodebuild` BUILD SUCCEEDED; sim: out-of-credits → Upgrade → V2
      (hero "Make Sarah's song now" one-tap + "or subscribe & save" teaser; Free hidden);
      Settings paywall unchanged. Screenshot both. (UI-only — no spend/credit logic touched, so
      a focused self-review, not the full billing gate.)

## Out of scope / not doing

- Multi-song gift bundles (user chose single song + subscriptions).
- Any change to spend/entitlement logic (already shipped, flag removed in ce04fe4).

---

# (Prior) Active Plan — Porizo Recovery: Viral Loop + Funnel Refinements

**Source plan:** `docs/porizo-monetization-viral-decisions-2026-06.md` (§F–J) + `docs/porizo-pay-per-song-impl-spec-2026-06.md` (Phase 2). Demos: `docs/demos/{viral-loop,reveal-paywall,create-pay-flow}-demo.html`.
**Principle:** REFINE, not redesign — copy/order edits to existing screens, no new screens.
**Audited 2026-06-05:** monetization billing engine is DONE; viral loop + copy refinements are NOT started; paywall "face" landed on the create-flow wall, not the live `SubscriptionViewV2`.

## ✅ Already shipped (do not redo)

- Two-ledger billing (spend `songs_remaining` → `gift_wallet`), `available_song_credits`, flag `paywall_pay_per_song_enabled` (OFF). Commits 80e7ea7, 4675e17.
- Pay-per-song hero on the **create-flow wall** (`SubscriptionView`), flag-gated. f33cb47.
- Pricing ASC↔DB synced ($1.99/$4.99/$7.99; Plus $6.99; Pro $14.99). Live promo-text "in his voice" removed.
- Sim test infra (`--bypass-auth`/`--demo-login`/`--mock-*`), `docs/dev/simulator-testing.md`.

---

## P1 — Viral loop §F (HIGHEST leverage: fixes the dead 39-recipients→0 loop)

- [x] **V-A Reply "Make one back for {Sender}" — iOS DONE + sim-verified 2026-06-05.** web mirror remaining.
  - **Decided:** CTA in BOTH preview view (peak emotion) AND the :209 PIN spot. CTA+routing only; sender reciprocal-free deferred to V-D (recipient 1st-free already holds via free tier = 2 songs). No money logic.
  - iOS shipped: `ShareClaimView.onReplyToSender` → `RootView.handleMakeOneBack` sets `pendingRecipientName`/`pendingCreateType=song`/`pendingCreateAutostart` (cold/onboarding path) + (sheet `onDismiss`→) posts `.makeOneBackRequested` (in-session, observed by `MainTabView`→`presentCreateFlow`). New `Notification.Name.makeOneBackRequested`.
  - **Bug found+fixed:** dismissing the sheet AND presenting the create-flow cover in the same runloop = dropped by SwiftUI. Fixed by deferring the launch to the sheet's `onDismiss` (`pendingReplySenderName`).
  - Verified: build SUCCEEDED; tapping "Make one back for Maya" → sheet dismiss → create flow pre-filled "For Maya" + occasion step.
  - [x] **web mirror DONE 2026-06-05** — `web-player/index.html` + `player.js` `setupPostPlayCta()`: reply CTA `#cta-make-one-back` (sender-aware via `sender_name`, textContent only; href → `receiverSaveUrl`/`/download`; tracked `post_play_reply`) + reciprocity headline. Verified: JS syntax OK, DOM asserts reply text "Make one back for Maya →" renders. Pixel-shot blocked by no-live-share (player.js error state) — structural verify only.
- [x] **V-C Claim-to-keep urgency — iOS DONE + sim-verified 2026-06-05.** web teaser remaining.
  - **CORRECTION:** plan said "live for 7 days" — FALSE. `share-service.js` stamps every token `expires_at=9999-12-31` (`share_type=lifetime`) + auto-upgrades old tokens. No 7-day window. Fake deadline = dark pattern + day-8 trust break.
  - Shipped honest chip (real urgency = first-to-claim binding + permanent library): "Claim in the app to make it yours — keep it forever." No deadline. Renders in `ShareClaimView` preview (verified on sim).
  - [x] **web teaser DONE 2026-06-05** — honest chip `#cta-claim-chip` in `web-player` post-play overlay. DOM-verified.
- [ ] **V-B App-only keepsakes** — reframe web "Save" → app-only HD audio + reveal video + lyric card + library; never block the web listen. `ShareClaimView ~:543–562`, `web-player/index.html`. (S)
- [ ] **V-D Deferred deep linking** — AppsFlyer OneLink (already integrated) so installs land in the pre-filled "make one back for {Sender}" flow; instant play, no PIN/signup to listen. Without it recipient→registration attribution stays 0. Target: recipient→register 10–15%.

## P2 — Funnel copy refinements §I (REFINE only)

- [x] **F-1 Onboarding payoff = FREE — DONE 2026-06-05.** `OnboardingPayoffView.swift`: headline → "Your first song is free\nfor {name}" (matches Home copy); CTA → "Make This Song · Free". Build-verified (pure string swap; no onboarding fixture, full-flow walk disproportionate).
- [ ] **F-2 Create-entry pricing label — DEFERRED 2026-06-05** to pay-per-song launch (P5/flag-flip).
  - **Why deferred (honesty + scope):** `InlineNamePromptView` is the GENERAL create entry (returning users hit it too) and has NO entitlement state; `WarmCanvasFlowView` checks entitlements server-side later by design (no persistent state). So "$1.99 after" is false while `paywall_pay_per_song_enabled` is OFF (users hit the subscription paywall), AND "first song free" is false for returning users with no free credit. An honest label needs threading billing state through a 1600-line flow file — not an XS edit. The $1.99 anchor already lives correctly on the flag-gated paywall hero. Revisit when flipping the flag ON.
- [x] **F-3 Reveal reaction prompt — DONE + sim-verified 2026-06-05.** `RevealBloomView.swift`: primary "Share with {name}" → "Send to {name}"; added secondary `reactionPromptButton` "Send & see their reaction →" (same `onShare` action — framing, not a new flow). Verified on `--fixture-reveal-ready`: "Send to Sarah" + reaction nudge render cleanly.

## P3 — Paywall "face" completion §Phase2/§I

- [x] **PF-1/PF-2/PF-3 DONE 2026-06-05 (billing review gate PASSED).** Extracted shared `PayPerSongHeroView.swift` (single source for pay-per-song price/flag/copy), used by both paywalls + NoCreditsView.
  - PF-1: generic hero + "or subscribe & save" divider on `SubscriptionViewV2` (Settings), flag-gated via `shouldDisplay`.
  - PF-2: `SubscriptionView` (V1, create wall) gains `recipientName` (passed from `WarmCanvasFlowView` `.upgrade` sheet) → "Make {name}'s song now" / "Pay $1.99 — make {name}'s song". **Sim-verified** ("Make Sarah's song now").
  - PF-3: `NoCreditsView` personalized CTA "Make {name}'s {noun} · {price}" when pay-per-song live; else "Upgrade to Pro". `noCreditsPayPerSongEnabled` captured at the 3 `.noCredits` sites (songs use the flag; poem = false, songs-only).
  - **Review fixes applied:** (#1 P2) removed redundant `--mock-payperson` gating override that defeated the poem songs-only `false`; (#5 P2) capped recipient name to 24 chars so it can't push the price off the CTA. Security review: CLEAN (fixtures `#if DEBUG`-isolated, server-authoritative purchase, no injection/PII).
  - **Verification gap:** V2 Settings hero not pixel-verified (Settings→V2 sheet wouldn't open via simctl tap — a scroll-row-button quirk); component proven on V1, V2 only places it + a divider. PF-3 not pixel-verified (needs no-credits trigger); logic build-verified + reuses proven gating.

## P4 — Voice false-promise cleanup §J (App Store risk)

- [ ] **VC-1 In-app voice copy** — `EmptyStateView.swift:45` ("sound just like you"), `DesignSampleView.swift:1008/1353` ("in your voice"/"your voice singing"). Remove/soften. (pre-approved copy, not a hard blocker, but on-strategy.)
  - **NEW FINDING 2026-06-05:** `web-player/player.js:508` — letterbox mode sets `"In ${senderName}'s voice"`. LIVE voice false-promise (implies cloning recipient/sender voice; not supported per [[project_no_voice_cloning_tech]]). App Store / §J risk. One-line honest fix (e.g. "A song for {name}" / drop the voice line). Bundle into VC-1.
- [ ] **VC-2 iPad screenshots** — source de-voiced (local, gitignored); re-render `current/ipad` hero+hear, upload with the next App Store version submission.

## P5 — Pre-launch (before flipping `paywall_pay_per_song_enabled` ON)

- [ ] **LB1 stranded-after-pay** — buy → ≤60s flag-cache skew can re-wall the user. Server: make credit immediately visible; client: retry-with-backoff on post-purchase resume.
  - **Adversarial review 2026-06-05 confirmed (P1, pre-existing in V1 hero since f33cb47):** the pay-per-song button (gift_bundle_1 = consumable) re-enables after `.success` and the wall doesn't auto-dismiss in-view, so a re-tap before the external entitlement re-check can trigger a SECOND $1.99 charge. Fix as part of LB1: disable/dismiss on `.success` (don't re-enable for consumable post-purchase). Flag-gated OFF so not live, but a hard blocker before flipping ON.
- [ ] **LB2 paid-but-can't-spend** — flag flips OFF between buy and spend. Server: grandfather purchased gift_bundle_1; client: distinct message when `giftWalletBalance>0 && !canMakeSong`.
- [ ] **M-1 Measurement §H** — `daily_aggregates` broken; track from `purchase_receipts` (product LIKE 'gift_bundle%'), `gift_wallet_transactions`, `events`. Metric: paywall view → song purchase conversion.

## Sequencing

P1 (viral loop) first — biggest funnel impact and what the user flagged. Then P2 copy (cheap, compounds), P3 paywall face, P4 voice cleanup, P5 before go-live. Each iOS change: build + `--demo-login` sim verify + review gate (billing-adjacent) before commit.

## Notes

- Ship behind the flag for a clean A/B (§H).
- Review-before-commit on any billing/auth-adjacent diff (user mandate).
- Demo account for testing: `npm run seed:demo` + `npm run dev` + `--demo-login`.
