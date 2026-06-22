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
- [ ] Prod (after `git push origin main` → Railway auto-deploy): real WhatsApp link →
      "Open in Porizo" → installed app opens → login → claim (no App Store bounce).
- [ ] Not-installed device: CTA → App Store → install → open → claim auto-presents.

## Out of scope (note, don't do unless asked)

- Privacy-policy disclosure of `recipient_phone` (pre-App-Store-submission, already tracked).
- Making the `porizo.co/play/<id>` Universal Link auto-open from WhatsApp's in-app browser
  (in-app browsers don't honor UL; the custom-scheme CTA is the reliable cross-context path).
