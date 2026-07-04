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

- U1/U2 onboarding parity: Android has a native onboarding flow, but it is not yet the full iOS V2 sequence with splash, adaptive questionnaire, server graph, suggestion, processing, payoff, and post-onboarding create/auth routing.
- U3 auth refresh parity: Android networking still lacks the iOS-equivalent 401 refresh/retry and proactive expiry handling.
- U5 receiver handoff: claim/share handoff does not yet persist the pending claim/create payload through sign-in and resume it after auth.
- U6/U8 lyric review: Android can approve lyrics, but editable lyric review and explicit approve failure recovery are still behind iOS.
- U7 claim completion: successful claim does not yet auto-open the claimed item, start playback where appropriate, and refresh library state with the same iOS behavior.
- U8 library/player parity: songs and poems libraries still need the iOS action set, authenticated playback headers, media/session controls, share/delete/variation actions, and richer error states.
- U9 billing lifecycle: subscriptions are wired, but purchase acknowledgement, retry persistence, and receipt-sync recovery still need a StoreKit-equivalent production lifecycle audit.
- U9 production push: Android client registration exists, but server-side transactional routing for Android/OneSignal still needs backend verification.
- U9 device trust: Android device identity is still a generated local token; App Set ID and Play Integrity are not yet integrated.
- U10 external provisioning: Google Web Client ID, release keystore, `assetlinks.json` publication, Play Console listing/config, and production backend URLs are configuration gates outside the codebase.
- U11 verification gate: side-by-side iOS/Android screenshots and flow recordings for every tab in light and dark mode remain required before marking U1-U10 done.
