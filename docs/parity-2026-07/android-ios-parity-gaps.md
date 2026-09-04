# Android/iOS Parity Gaps - July 2026

This register reconciles the native Android parity plan with the current U1-U10 implementation. Status here is intentionally stricter than "built": a slice is only done when the behavior, visual treatment, and production constraints are verified against iOS.

## Closed in this pass

- U1/U4 Explore shell: Home now opens an iOS-style Explore surface and launches the create flow from the primary CTA or occasion rail.
- U2/U4 design tokens: Android theme now has light/dark Porizo palettes, Warm Canvas spacing, tighter cards, and a bottom nav closer to the iOS tab bar.
- U3 networking: bearer auth is scoped to the API host so presigned upload/storage URLs do not receive the session token.
- U5 auth: phone entry now normalizes to E.164 before enabling SMS send; blank Google Web Client ID disables Google sign-in instead of exposing a broken path.
- U7 deep links: app links now cover `porizo.co`, `www.porizo.co`, legacy `porizo.app`, `/s`, `/play`, `/p`, `/poem`, `/poem-share`, `/receiver-handoff`, and OneLink nested deep-link values.
- U7 poem claims: poem share claim calls now attach the device token header.
- U8 render path: lyric approval and retry now request full-quality renders, persist pending renders as `full`, and prefer `fullUrl` on completion.
- U9 billing: Play Billing product queries are subscription-only until the backend gift-consumable endpoint exists.
- U9 push: OneSignal initialization/login/logout errors are surfaced as UI warnings instead of being swallowed.
- U9 voice enrollment: Android gates live voice enrollment off for KTD7 and presents a coming-soon state instead of asserting consent.
- U10 release: release bundles now require a real keystore unless an explicit local smoke-test override is passed; Play/App Link config docs now target `porizo.co`.

## Still open after this pass

- U1/U2 onboarding parity: Android now has native splash, mirror, questionnaire, processing, payoff, typed completion, and create-flow seeding. It remains open until the iOS V2 side-by-side state matrix is captured and the optional server suggestion upgrade contract is verified or explicitly deferred.
- U3 auth refresh parity: Android now has a shared refresh coordinator, proactive expiry handling, one 401 retry, token rotation persistence, and protected repository wrappers. It remains open until focused refresh race tests and full protected-call coverage are verified.
- U5 receiver handoff: claim/share handoff now persists pending deep links through sign-in and resumes after auth. It remains open until receiver handoff replay is manually recorded and any PIN/token edge cases are verified.
- U6/U8 lyric review: Android now has editable lyrics, lyrics GET/PUT, save-before-approve, and approve failure recovery. It remains open until provider policy term surfacing and create-flow recovery evidence are captured.
- U7 claim completion: successful claim now emits typed completion events, refreshes the relevant library, and routes to Songs/Poems. It remains open because receiver song auto-play/open still needs a returned track payload or Android receiver-claim stream contract.
- U8 library/player parity: songs and poems now support share/delete actions, owned playback headers, and Media3 session metadata. It remains open until delete confirmation, richer protected/not-ready error copy, and system media-control QA evidence are complete.
- U9 billing lifecycle: subscriptions now persist purchase tokens, restore unsynced tokens, submit backend receipts, and acknowledge only after backend acceptance. It remains open for startup auto-retry, RTDN/server webhook reconciliation, and Play Console/internal-test proof.
- U9 production push: Android now registers the OneSignal subscription ID and the server push service can route OneSignal notifications alongside APNs. It remains open until real OneSignal credentials and end-to-end render/recipient-played push proof are captured.
- U9 device trust: Android now exposes a debug-safe device-trust seam and Settings status. App Set ID, Play Integrity token generation, backend nonce/verification, and release fail-closed enforcement remain external/backend work.
- U10 external provisioning: Google Web Client ID, release keystore, `assetlinks.json` publication, Play Console listing/config, and production backend URLs are configuration gates outside the codebase.
- U11 verification gate: `docs/parity-2026-07/android-u11-parity-qa-matrix.md` now defines the required side-by-side screenshots and flow recordings. Evidence remains required before marking U1-U10 done.
