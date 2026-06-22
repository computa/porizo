# Fix: app-wall "Open in Porizo" must open the INSTALLED app (and persist the claim through download → login → claim)

## Root cause (verified end-to-end, 2026-06-22)

The recipient's journey breaks because the app-wall **"Open in Porizo"** CTA never tries to
open the _already-installed_ app. It does an analytics-gated **JS redirect**
(`handleReceiverSaveClick` → `event.preventDefault()` → `window.location.href = <OneLink>`,
`web-player/player.js:1111-1146`). iOS **does not fire Universal Links on programmatic
navigation** — only on genuine user taps to a different domain — so the OneLink
(`https://porizo.onelink.me/hPJL/...`, prod-configured) resolves **server-side → App Store**
(matches user's Image #6), bypassing the installed app. Re-opening from the App Store "Open"
button is a cold launch with **no URL and no install event**, so AppsFlyer's **deferred**
deep link (`didResolveDeepLink`, `PorizoAppApp.swift:317`) never fires → `consumePendingPayload()`
is nil → user lands on Settings with no claim (Image #7).

The carried token is `receiverHandoffId`; iOS already fully handles it:

- `parseReceiverHandoffPayload` (`RootView.swift:84-95`) accepts `porizo:///receiver-handoff/<id>`
  (path form) **and** `?deep_link_value=<id>`.
- `handleReceiverDeepLink` resolves it → `ReceiverClaimDraftStore.save` (UserDefaults, **survives login**)
  → claim sheet (sign-in happens _inside_ the sheet).
- `porizo://` custom scheme **is registered** (`Info.plist:108`).

So the entire iOS side already works — the only defect is the **web CTA never invokes it**.

## Fix (web-only; no iOS rebuild needed)

Make the app-wall (and the other receiver-save CTAs) attempt the installed app FIRST via the
custom scheme, then fall back to the OneLink (which itself handles App Store + AppsFlyer deferred).

- [x] `tryOpenInstalledApp(handoffId, fallbackUrl)` — navigates to `porizo:///receiver-handoff/<id>`, arms `visibilitychange`/`pagehide`/`blur`/`pageshow` + a 2200ms timer; cancels the store fallback on background/blur/bfcache-restore, with a final visibility+focus guard so the iOS "Open in Porizo?" confirm dialog can't bounce an installed user to the store (frontend-races review MAJOR finding).
- [x] Wired into `handleReceiverSaveClick`: `handoffId = receiverHandoffId || extractHandoffId(receiverSaveUrl) || extractHandoffId(link.href)`; tries the app first, else falls straight to the OneLink/`/download`.
- [x] `extractHandoffId` handles BOTH the OneLink `deep_link_value` and the `/download` `deep_link=porizo:///receiver-handoff/<id>` shapes (7/7 node assertions pass).
- [x] Analytics fired keepalive (survives the navigation), non-blocking.
- [x] Bumped player.js cache-bust marker → `?v=20260622-deeplink`.
- [x] Verified: `node --check` clean; extraction + iOS triple-slash contract asserted.

## Not-installed path (already wired — verify only)

OneLink fallback → App Store → install → first launch → AppsFlyer `didResolveDeepLink`
→ `ReceiverDeepLinkService.post` → `consumePendingPayload` on `.task` → claim. No code change;
verify once after deploy.

## Verify

- [ ] Local: serve player.js, tap CTA on a device with app installed → app opens to claim.
- [x] Deployed: `736cdd1` → `origin/main` → Railway. Live `player.js` confirmed serving new code.
- [x] On-device (installed): WhatsApp link → "Open in Porizo" → app opens → `ReceiverClaimView`
      (confirmed by user, Image #8). Deep link works end-to-end.
- [x] Not-installed regression fixed + deployed (`d6cd045`): the `blur`/`hasFocus` guards were
      suppressing the App Store fallback when the "address is invalid" error dialog stole focus.
      Now cancel only on genuine background (visibility/pagehide/bfcache); 1400ms window.
      Live-verified. **Known minor:** ~1.4s "address is invalid" flash before App Store redirect
      (iOS in-app-browser constraint of probing a custom scheme; can hide via iframe if desired).
- [ ] Not-installed (user re-test): delete app → link → brief error flash → App Store → install
      → first launch → AppsFlyer deferred → claim.

## ③ Inconsistent open (RESOLVED in code — two-action wall, awaiting user test)

Root cause: no client signal distinguishes iOS's "Open in Porizo?" confirm (installed) from
its "address is invalid" error (not installed) — both keep the page visible — so any fallback
timer races one of them. Fix (user chose "two clear actions, no race"): removed `tryOpenInstalledApp`;
app-wall now has **"Open in Porizo"** (custom scheme only, no fallback) + **"Don't have the app?
Get it free"** (OneLink → App Store + AppsFlyer deferred). Player/teaser CTAs revert to OneLink.
`receiver_link_opened` (fired during init) populates `receiverHandoffId`/`receiverSaveUrl` before
the wall renders, so the primary CTA always has the handoff at tap time. Files: player.js,
index.html, styles.css. Cache markers → `20260622-twoaction`.

## ② signed-out claim sheet — RESOLVED (not a bug)

Image #9 = app shows welcome screen after sign-out (sign-out sticks app-wide). Image #13 = the
signed-out claim sheet correctly shows the "Sign in with Apple" variant. Earlier "Claim & Save
while signed out" was the logged-in test. No code change.

## (archived hypothesis) ② signed-out shows authenticated claim sheet (Image #8)

User reports `ReceiverClaimView` shows "Claim & Save" (authenticated variant) after a full
Settings sign-out; expected the Sign-in-with-Apple variant / login. Code review can't explain it:
single shared `@Observable AuthManager` (env-injected), `logout()` clears all tokens +
`isAuthenticated=false`, `completeAuthStateLoad` only re-auths with all 3 tokens, device token
never flips `isAuthenticated`. Awaiting user screenshots to get a clean runtime observation
before any fix (no symptom-patching). Candidates to check once reproduced: whether sign-out
sticks app-wide (Settings still shows account?) vs claim-path-only; warm-foreground re-auth race.

## Out of scope (note, don't do unless asked)

- Privacy-policy disclosure of `recipient_phone` (pre-App-Store-submission, already tracked).
- Making the `porizo.co/play/<id>` Universal Link auto-open from WhatsApp's in-app browser
  (in-app browsers don't honor UL; the custom-scheme CTA is the reliable cross-context path).
