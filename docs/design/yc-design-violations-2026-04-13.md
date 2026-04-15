# YC-Inspired Design: Violation Audit

**Date:** 2026-04-13
**Auditors:** Claude (independent code audit) + Codex (independent code review)
**Scope:** YC design research docs vs implemented iOS app (version3 branch)
**Method:** Both auditors independently read specs + code, then consolidated findings

---

## Framing

Two distinct questions:
1. **Is the current app compliant with the YC redesign spec?** → violation status
2. **Was the gap consciously deferred?** → changes priority, not compliance

A deferral is still a miss. It just tells us where to assign blame and what to fix first.

---

## Current Violations

### V1 · P0 — Pre-auth personalization carry-through

**Original finding:** Name/occasion entered before auth was stored to `@AppStorage` but never carried into the create flow.

**Current state (FIXED):** The full chain is now wired:

| Evidence | What happens now |
|----------|-----------------|
| `RootView.swift:154-155` | Writes `pendingRecipientName` / `pendingOccasion` to AppStorage |
| `RootView.swift:166-169` | Passes pending values to `MainTabView` init |
| `MainTabView.swift:23-25` | Receives `pendingRecipientName`, `pendingOccasion`, `pendingType` |
| `MainTabView.swift:311-322` | `consumePendingCreateContextIfNeeded()` auto-launches create flow with pending values |
| `CreateFlowContracts.swift:91` | `CreateFlowLaunch` has `initialRecipientName: String?` |
| `CreateFlowContracts.swift:143` | `resolve()` calls `setup.applyPreselectedRecipientName()` for fresh starts |

**Spec:** `design-review-synthesis.md:38-44` — "Value must come before commitment."

**Validation:** S1 scenario with `--reset-onboarding --bypass-auth` can now test the full carry-through.

---

### V2 · P1 — Share is not one-tap after reveal

**Links are generated lazily on button tap, then polled for up to 10 seconds.**

| Evidence | What happens |
|----------|-------------|
| `WarmCanvasFlowView.swift:1115-1121` | `transitionToReveal()` plays audio, transitions moment — no share link |
| `WarmCanvasFlowView.swift:703-736` | `onSend` lazily calls `generateShareLink()`, polls 40 times |
| `WarmCanvasFlowView.swift:739-761` | `onCopyLink` same lazy pattern, polls 20 times |

**Spec:** `comprehensive.md:735-750` — "Share link generated automatically immediately upon successful completion. The user should never feel like they are waiting for sharing."
**Handoff:** `handoff-20260401:80` — Phase 1 deferred eager share-link generation, but the current product decision skips preview on the happy path.

**Fix:** Call `shareController.generateShareLink()` at reveal entry on full-render completion so the link is ready when user reaches share phase. Do not wait for share-button tap.

---

### V3 · P1 — Reveal handoff is nav-oriented instead of moment-oriented

**Both "Listen Fully" and "Save to Library" immediately eject to Songs tab instead of settling into player/share.**

| Evidence | What happens |
|----------|-------------|
| `WarmCanvasFlowView.swift:673-682` | Both buttons call `onComplete(trackId, versionNum)` |
| `MainTabView.swift:289-302` | `onComplete` → dismiss flow + switch to Songs tab |

**Spec:** `comprehensive.md:698-704` — "After the initial reveal: transition into a stable player/share state; expose share as the primary next action."

**Fix:** Remove immediate `onComplete` from reveal actions. Keep the user in the reveal/player/share route, make share the primary next action, and add an explicit close/save exit instead of bouncing straight to Songs.

**Status (2026-04-13):** Implemented in code. Reveal now keeps the user in-flow: "Listen with lyrics" opens the full player in a modal route, "Save to library" is acknowledged in place, share returns to reveal instead of ejecting, and explicit exit is handled via a reveal close control. Dedicated behavioral validation is still pending.

---

### V4 · P1 — Wait-state copy violates the product promise

**Original finding:** "Usually under 2 minutes" weakens the "90 seconds" positioning.

**Current state (FIXED):**

| Evidence | What happens now |
|----------|-----------------|
| `WaitPulseView.swift:79` | Static copy: `"Ready in about 90 seconds"` |

**Spec:** `design-review-synthesis.md:34-36` — "'90 seconds' should be everywhere."

**Validated:** Screenshot `09-fixture-creating.jpg` confirms fix.

---

### V5 · P1 — Dead chrome and mechanical progress UI

**Original finding:** Placeholder search/notification buttons and progress percentage exposed system wiring.

**Current state (FIXED):**

| Evidence | What happens now |
|----------|-----------------|
| `ExploreTabView.swift:85-95` | Header contains only "Explore" title — placeholder buttons removed |
| `InlineCreatingCard.swift` | Progress percentage text removed; only status message + ring animation remain |

**Spec:** `spec.md:159` — "One dominant purpose per screen."
**Spec:** `spec.md:165` — "Internal workflow states stay internal."

**Validated:** Explore tab screenshot confirms no placeholder buttons.

---

### V6 · P1 — Onboarding skip label mismatch

**Original finding:** "Sign in" button on last onboarding slide routes to Name Entry, not auth.

**Current state (FIXED):**

| Evidence | What happens now |
|----------|-----------------|
| `OnboardingView.swift:94` | Secondary CTA labeled "Get started" |
| `RootView.swift:338-344` | Routes to `.nameEntry` (correct per spec flow) |

**Validated:** Screenshot `10-fixture-onboarding-reset.jpg` confirms fix.

---

### V7 · P1 — OG preview framing is underpowered

**The social preview card is the real first impression, and it still underuses sender/context framing.**

| Evidence | What happens |
|----------|-------------|
| `src/routes/sharing.js:495-502` | OG title leads with recipient only; description is generic occasion/product copy |

**Current:** `A song for Sarah` / `A personalized birthday song — tap to listen`

**Opportunity:** Lead with sender + recipient + occasion where available, e.g. `Marcus made a birthday song for Sarah`.

**Why it matters:** The preview in iMessage / WhatsApp determines click-through before the recipient ever sees the web player.

**Fix:** Audit `ogTitle` / `ogDescription` generation to prioritize sender, recipient, and occasion over generic product framing.

---

### V8 · P1 — Share-sheet copy is too generic for distribution

**The outbound share message exists, but it is still product-generic instead of emotionally specific.**

| Evidence | What happens |
|----------|-------------|
| `ShareController.swift:366-367` | Share sheet message is `I made you a personalized song! Listen here: ... Use PIN: ...` |

**Why it matters:** Context in the outbound message changes open rate. A human sentence about who the song is for is stronger than generic "personalized song" copy.

**Fix:** Prefill share copy with sender/recipient/occasion context when available.

---

### V9 · P1 — Claiming should not kill the browser listening surface

**Ownership and public listening are currently coupled too tightly.**

| Evidence | What happens |
|----------|-------------|
| `src/routes/sharing.js:878-880` | Claim update sets `web_stream_allowed = 0` |

**Current behavior:** once a gift is claimed, the browser listening path can collapse.

**Desired behavior:** claiming a gift should bind ownership without removing a read-only browser listening surface.

**Design principle:** distribution surface and ownership surface are separate.

**Why it matters:** recipients may want to reopen or re-share a browser listening link after claiming. Killing web playback hurts secondary virality.

**Fix direction:** preserve a public listen surface after claim. This may mean introducing a dedicated public listen token/link rather than relying on the same claim token forever.

**Status (2026-04-13):** Implemented in code for the current share-token model. Claim no longer zeroes browser listening by default, claimed share metadata can still advertise a public web stream when `web_stream_allowed` remains enabled, and both the web player and iOS share-claim surface now honor that read-only preview path while wrong-device app access stays blocked. A cleaner dedicated public-listen token model may still be a later refinement.

---

## Pending / Deferred (not compliant, consciously scheduled)

### D1 · P2 — Onboarding is still a 3-page wizard

| Evidence | Status |
|----------|--------|
| `OnboardingView.swift:57` | 3-page `TabView` with `.page` style |
| `handoff-20260401:84-86` | Deferred to Phase 2: "Onboarding redesign (sample song, single screen)" |

Slides do include sample audio and "90 seconds" promise — partial progress, not neglect.

---

## Intentional Product Deviations (tracked, not planned)

### X1 · Preview-first reveal is intentionally not on the happy path

| Evidence | Status |
|----------|--------|
| `WarmCanvasFlowView.swift:1074` | Comment: "Warm Canvas goes straight to full render (no preview)" |
| `comprehensive.md:673` | YC research recommended "use preview-ready as the initial reveal trigger" |

**Decision:** Product direction is to skip preview on the happy path and keep the first reveal on full render.

**Reason:** We are optimizing for full-quality first playback over speed-to-first-reveal.

**Implication:** This remains a documented divergence from the YC design research, but it is a deliberate override, not pending implementation work.

## Not Violations (Remove from list)

| Item | Reason |
|------|--------|
| First-time voice skip | **Implemented.** `WarmCanvasFlowView.swift:1514` auto-selects AI female voice. |
| onSkip → nameEntry routing | **Correct per spec.** Bug is label only (see V6). |

---

## What Landed

The redesign is not missing everywhere. Verified working:
- Warm Canvas visual system fully adopted (DesignTokens.swift, 32-screen gallery)
- Reveal is in-route, not a separate modal
- Recipient name is prominent inside reveal/wait
- First-time voice skip auto-selects AI female voice
- Dynamic wait copy progresses through 6 time-aware buckets
- Conversation Garden tell moment with sage AI / coral user bubbles
- Fraunces typography across all screens

---

## Implementation Checklist

**Implementation status (2026-04-13):** `V1`, `V2`, `V3`, `V4`, `V5`, `V6`, `V7`, `V8`, and `V9` are implemented in code. End-to-end behavioral validation via the dedicated harness is still pending.

### Current Violations

- [x] **V1** Pre-auth carry-through: add `recipientName`/`pendingOccasion` to `CreateFlowLaunch`, wire from AppStorage, clear after use
- [x] **V2** Share-link pre-generation: trigger `generateShareLink()` on reveal entry / full-render completion
- [x] **V3** Reveal settle: remove immediate `onComplete`, add player/share settle state
- [x] **V4** Wait copy: "Usually under 2 minutes" → "Ready in about 90 seconds"
- [x] **V5a** Remove placeholder search/notification buttons from ExploreTabView
- [x] **V5b** Hide progress percentage in InlineCreatingCard (keep ring animation, remove `%` text)
- [x] **V6** Fix onboarding skip label: "Sign in" → "Get started"
- [x] **V7** Improve OG preview framing: lead with sender/recipient/occasion
- [x] **V8** Improve iOS share-sheet prefill copy with human context
- [x] **V9** Preserve browser listening after claim in the current token model while keeping ownership binding intact

### Deferred Items (track separately)

- [ ] **D1** Single-screen onboarding with product demonstration (Phase 2)

---

## Adjacent Technical Risks

These are not YC design violations, but they affect the flows being changed and should be tracked alongside implementation.

### T1 · Backend share path can 500

**`getVersionDir()` throws on undefined path components in playlist/share route.**

| Evidence |
|----------|
| `src/server.js:895` |

**Status (2026-04-13):** Fixed in code. The playlist/share route now falls back cleanly when local storage context is unavailable instead of throwing, and the HLS playlist contract test now rejects `500` as an acceptable outcome.

**Fix:** Guard local HLS path construction behind a complete storage context and use configured storage-dir fallback instead of assuming `appConfig.STORAGE_DIR` is always present.

### T2 · Gift distribution policy may still fight web-first value

**Gift delivery can still be configured to require app claim before access.**

| Evidence |
|----------|
| `src/services/feature-flags.js:29` |
| `src/services/feature-flags.js:427-430` |

**Risk:** if `gift_require_app_claim` stays enabled in normal cold-distribution paths, the product will keep fighting the intended `web for delight, app for ownership` strategy.

**Recommendation:** revisit the default and intended rollout policy for `gift_require_app_claim`.

## Verification

- [ ] Build + run on simulator
- [ ] Test: enter name pre-auth → auth → verify name appears in create flow
- [ ] Test: complete a song → verify share link ready immediately on reveal
- [ ] Test: reveal → verify it settles into player/share (no immediate dismiss)
- [ ] Test: wait state shows "90 seconds" copy
- [ ] Test: explore tab has no placeholder buttons
- [x] `npm test` passes
- [x] Share playlist/share route no longer 500s on missing path components
- [ ] Test: shared link preview copy is emotionally specific in iMessage / WhatsApp
- [ ] Test: iOS share sheet sends contextual message, not generic product copy
- [ ] Test: recipient can still open a read-only browser listening surface after claim
- [x] iOS simulator build passes
- [x] iOS simulator tests pass
- [ ] TestFlight upload + smoke test
