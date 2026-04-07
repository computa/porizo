---
title: "feat: Pinless web playback for social sharing viral loop"
type: feat
status: active
date: 2026-04-07
origin: docs/brainstorms/2026-04-07-social-sharing-viral-loop-requirements.md
deepened: 2026-04-07
---

# Pinless Web Playback for Social Sharing Viral Loop

## Overview

Remove the PIN gate from web playback so social share recipients hear the full song immediately. PIN stays for in-app claiming only. This requires coordinated changes across three layers: (1) the share info response, (2) the audio/stream endpoint enforcement, and (3) keeping `dl_token` gated for security.

## Problem Frame

Every Porizo share on Facebook/X/Instagram opens in the platform's in-app browser and lands on a PIN entry page. The recipient doesn't have the PIN, gets confused, and bounces. The web player already supports full playback with lyrics and a "Create your own" CTA — but both the share info response AND the audio endpoint enforce PIN verification. (see origin: `docs/brainstorms/2026-04-07-social-sharing-viral-loop-requirements.md`)

## Requirements Trace

- R1. Web player auto-plays full song without PIN
- R2. PIN preserved for in-app claiming only
- R3. One link, two behaviors (web vs app)
- R4. Post-play CTA at emotional peak
- R5. CTA works in social in-app browsers
- R6. Load + playback within 3s on 4G
- R7. Player shows title, recipient, artwork, controls, share buttons

## Scope Boundaries

- No inline feed playback (platform whitelist gated)
- No changes to iOS in-app share claiming flow (PIN stays for `/claim`)
- No changes to share.mp4 or OG metadata
- No new share link types
- No changes to `src/services/share-service.js` — PINs continue to be generated
- `dl_token` stays gated behind PIN — no free audiogram downloads

## Context & Research

### Three-Layer PIN Enforcement (Critical Finding from Review)

The PIN system has three enforcement layers. ALL must be addressed:

1. **Layer 1: Share info response** (`src/routes/sharing.js:680-717`)
   - `hasPinProtection` gates `web_stream_url`, `dl_token`, and sets `requires_pin: true`
   - This is what the web player reads to decide PIN screen vs player screen

2. **Layer 2: Audio/stream endpoints** (`src/routes/sharing.js:1002, 1054`)
   - `requirePinToken()` at line 159 checks `share.claim_pin` and rejects without a web stream token
   - Even if Layer 1 provides `web_stream_url`, Layer 2 rejects the actual audio request with 401
   - **This is why simply removing `hasPinProtection` from the response would break the web player**

3. **Layer 3: Claim endpoint** (`src/routes/sharing.js:768`)
   - `POST /share/:shareId/claim` validates PIN directly against `share.claim_pin`
   - This is independent and must NOT change

### `requirePinToken()` Function (`src/routes/sharing.js:159-163`)

```
function requirePinToken(request, share) {
  if (!share.claim_pin) return true;        // No PIN = always allowed
  const webToken = request.headers["x-web-stream-token"] || request.query?.wst;
  return webToken && validateWebVerifyToken(share.id, webToken);
}
```

Called at:
- Line 1002: `/share/:shareId/stream` — returns stream URL metadata
- Line 1054: `/share/:shareId/audio` — serves actual audio file

### iOS ShareClaimView Behavior (`PorizoApp/PorizoApp/ShareClaimView.swift:350-358`)

The iOS app checks `webStreamUrl` presence to decide between preview mode and PIN-required mode. If the server now provides `webStreamUrl`, the app enters preview mode and tries to stream — which currently would fail at Layer 2. After our fix, it will succeed, creating a "listen first, PIN to save" experience — which is the desired behavior.

### Post-Play CTA (Already Wired)

- `setupPostPlayCta()` at `web-player/player.js:815-826`
- Triggered on `audio.ended` at line 612
- CTA: "Make a song for someone you love" + App Store link
- UTM params: `utm_source=webplayer&utm_medium=share&utm_campaign=post-play`

## Key Technical Decisions

- **Bypass `requirePinToken` for web playback, keep for claims**: The audio/stream endpoints skip PIN enforcement for unbound shares. The claim endpoint still enforces PIN. This is the cleanest separation: listen free, PIN to save.
- **Keep `dl_token` gated behind PIN**: The download endpoint doesn't call `requirePinToken()` — it only validates the HMAC token. If we expose `dl_token` without PIN, the full audiogram MP4 becomes freely downloadable. Keep it gated.
- **Retroactive**: All existing shares become web-playable. This is intentional — it improves every share link ever created.
- **PIN generation unchanged**: `share-service.js` still generates PINs. The PIN is needed for in-app claiming. We're just not enforcing it for web playback.

## Open Questions

### Resolved During Planning

- **Should web use `/teaser` or `/audio` endpoint?** Use `web_stream_url` pointing to `/share/:shareId/audio`. Teaser is rate-limited and only serves preview.
- **Is the post-play CTA wired?** Yes. `setupPostPlayCta()`, triggered on `audio.ended`.
- **Will simply removing `hasPinProtection` work?** No — Layer 2 (`requirePinToken`) also blocks. Must bypass at both layers.
- **Will iOS ShareClaimView break?** No — it will enter preview mode (listen first), which is the desired behavior. PIN is still required for "Save to Library".
- **Should `dl_token` be exposed?** No — keep it gated. Download without PIN is a security regression.

### Deferred to Implementation

- Verify the `/download` route correctly redirects to the App Store with UTM params
- Verify teaser logic (lines 695-702) becomes dead code and can be cleaned up

## Implementation Units

- [ ] **Unit 1: Bypass PIN enforcement on audio/stream endpoints for web playback**

  **Goal:** Allow the `/audio` and `/stream` endpoints to serve audio for unbound shares without a web stream token, while keeping PIN enforcement for claims.

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Modify: `src/routes/sharing.js` (lines 159-163, 1002, 1054)
  - Test: `test/sharing-security.test.js`, `test/sharing.test.js`

  **Approach:**
  - Modify `requirePinToken()` or the call sites at lines 1002 and 1054 to skip PIN check for unbound web streaming. The simplest approach: at lines 1002 and 1054, change the condition to only enforce PIN for claimed/bound shares, not unbound ones. Unbound = not yet claimed = web playback context.
  - Alternatively, remove the `requirePinToken()` calls at lines 1002 and 1054 entirely, since the `/audio` endpoint already has rate limiting and the share link URL is the access control.
  - Do NOT touch the claim endpoint at line 768.

  **Patterns to follow:**
  - The existing rate limiter on `/share/:shareId/teaser` (10/hr/IP) — consider applying similar to `/audio` if not already present

  **Test scenarios:**
  - Happy path: `GET /share/:shareId/audio` for an unbound share with `claim_pin` returns 200 with audio content (no web stream token needed)
  - Happy path: `GET /share/:shareId/stream` for an unbound share with `claim_pin` returns stream metadata
  - Integration: `POST /share/:shareId/claim` still requires valid PIN — unchanged
  - Error path: Expired share returns appropriate error on `/audio`
  - Error path: Revoked share returns appropriate error on `/audio`

  **Verification:**
  - `curl /share/:shareId/audio` for a PIN-protected unbound share returns audio bytes, not 401

- [ ] **Unit 2: Provide `web_stream_url` in share info response regardless of PIN**

  **Goal:** Remove `hasPinProtection` gate from the share info response so the web player and iOS app receive `web_stream_url` for all unbound shares.

  **Requirements:** R1, R3

  **Dependencies:** Unit 1 (audio endpoint must accept the request first)

  **Files:**
  - Modify: `src/routes/sharing.js` (lines 680-717)
  - Test: `test/sharing-security.test.js` (update existing assertions)

  **Approach:**
  - Line 681: Remove `!hasPinProtection` from `shareStreamUrl` condition → `share.web_stream_allowed && !appRequired`
  - Line 710: Always return `web_stream_url: shareStreamUrl`
  - Line 713: Remove `requires_pin` from response entirely
  - Line 691: Keep `dlToken` gated — do NOT remove `hasPinProtection` guard here. Download without PIN is a security risk.
  - Lines 695-702: Teaser logic becomes dead code (teaser was for PIN-protected shares only). Remove or leave with a comment.

  **Patterns to follow:**
  - Existing response shape preserved — only conditions change

  **Test scenarios:**
  - Happy path: Share with `claim_pin` returns `web_stream_url` and does NOT return `requires_pin`
  - Happy path: Share without `claim_pin` works identically to before
  - Security: `dl_token` is NOT returned for shares with `claim_pin` (kept gated)
  - Integration: `POST /share/:shareId/claim` still validates PIN after this change
  - Edge case: Expired share still returns expired status

  **Verification:**
  - `curl /share/:shareId` returns `web_stream_url` and no `requires_pin` field
  - `dl_token` is absent in the response (security check)

- [ ] **Unit 3: Update existing security tests**

  **Goal:** Update `sharing-security.test.js` assertions that currently expect `requires_pin: true` and `web_stream_url: null` for PIN-protected shares.

  **Requirements:** R1

  **Dependencies:** Units 1-2

  **Files:**
  - Modify: `test/sharing-security.test.js`

  **Approach:**
  - Find assertions at lines ~218-231 that check PIN-protected shares return `requires_pin: true`
  - Update to assert the opposite: `web_stream_url` is present, `requires_pin` is absent
  - Add new assertion: `dl_token` is still absent for PIN-protected shares (security preserved)
  - Add regression test: `POST /share/:shareId/claim` without PIN returns 401 (PIN still enforced for claims)

  **Test scenarios:**
  - Happy path: PIN-protected share info returns `web_stream_url` (new behavior)
  - Security: PIN-protected share info does NOT return `dl_token`
  - Security: Claim without PIN returns 401
  - Regression: Audio endpoint serves unbound PIN-protected share without web stream token

  **Verification:**
  - `npm test` passes with 0 failures

- [ ] **Unit 4: Verify post-play CTA and UTM tracking**

  **Goal:** Confirm the existing post-play CTA works in Facebook's in-app browser with proper UTM tracking.

  **Requirements:** R4, R5

  **Dependencies:** Units 1-2

  **Files:**
  - Possibly modify: `web-player/player.js` (if UTM or link needs fixing)

  **Approach:**
  - Verify `setupPostPlayCta()` sets correct App Store URL
  - Verify CTA uses `<a>` tags (not `window.open`) for in-app browser compatibility
  - Verify `/download` route redirects to App Store

  **Test scenarios:**
  - Happy path: Song ends → CTA overlay appears
  - Happy path: CTA link includes UTM params
  - Happy path: "Listen again" replays

  **Verification:**
  - Manual: play song to end in browser, CTA appears and link works

- [ ] **Unit 5: End-to-end Facebook share test**

  **Goal:** Validate complete flow in production after deploy.

  **Requirements:** R1, R3, R4, R5, R6, R7

  **Dependencies:** Units 1-4, deployed to Railway

  **Files:**
  - No code changes

  **Approach:**
  - Share a song on Facebook
  - Open in Facebook's in-app browser
  - Verify: no PIN page → player loads → tap play → full song plays → lyrics display → CTA appears → App Store link works

  **Test expectation: none** — manual E2E

  **Verification:**
  - Full flow works without PIN in Facebook's in-app browser
  - Player loads within 3 seconds
  - Post-play CTA visible and tappable

## System-Wide Impact

- **PIN claim flow**: `POST /share/:shareId/claim` — UNCHANGED. PIN still validated at line 768
- **`/web-verify` endpoint**: Still functional but less frequently called (web player bypasses PIN screen). Not removed — could serve edge cases
- **iOS ShareClaimView**: Will enter "preview" mode (listen first) instead of "requiresPin" mode. This is the desired behavior — listen free, PIN only for "Save to Library"
- **Download/audiogram**: `dl_token` remains gated behind PIN. No security regression on downloads
- **Rate limiting**: `/audio` has existing rate limiting. No change needed
- **Security model**: The share link URL becomes the sole access control for web playback. Acceptable because social shares are publicly posted. PIN remains for device-binding (app claiming)
- **Teaser system**: Becomes dead code. Can be cleaned up later
- **Existing shares**: All retroactively become web-playable. Intentional improvement

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Full song streamable to anyone with URL | Acceptable — the link IS the access control. Social shares are public by nature |
| `dl_token` leak if accidentally ungated | Unit 2 explicitly keeps `dl_token` gated. Unit 3 adds security test assertion |
| iOS app gets `webStreamUrl` and changes behavior | Desired — iOS enters "listen first" mode. PIN still required for Save |
| Existing security tests fail | Unit 3 updates them before merge |
| Audio endpoint abuse (scraping) | Existing rate limiting on audio endpoint. Link URL is not guessable (cryptographic ID) |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-07-social-sharing-viral-loop-requirements.md](docs/brainstorms/2026-04-07-social-sharing-viral-loop-requirements.md)
- `requirePinToken()`: `src/routes/sharing.js:159-163`
- Share info endpoint: `src/routes/sharing.js:680-717`
- Stream endpoint PIN check: `src/routes/sharing.js:1002`
- Audio endpoint PIN check: `src/routes/sharing.js:1054`
- Claim endpoint PIN check: `src/routes/sharing.js:768`
- Web player decision tree: `web-player/player.js:360-434`
- Post-play CTA: `web-player/player.js:815-826`
- iOS ShareClaimView: `PorizoApp/PorizoApp/ShareClaimView.swift:350-358`
- Security tests: `test/sharing-security.test.js:218-231`
