# Pre-TestFlight Distribution Checklist

Run this before any TestFlight upload or release candidate.

## Magic Login Association Gate

- [ ] `https://auth.porizo.co/.well-known/apple-app-site-association` returns
  HTTP 200, `application/json`, the production app identifier, and
  `/auth/magic/ios*`.
- [ ] Release entitlements contain `applinks:auth.porizo.co`.
- [ ] A release-installed build accepts only the exact HTTPS link, rejects
  custom schemes, spoofed hosts, and query secrets, and exchanges only on the
  initiating device.
- [ ] Logs contain transaction IDs but no link secret, requester secret, full
  callback URL, access token, or refresh token.
- [ ] `MAGIC_LOGIN_ENABLED` remains false until DNS/TLS, association caching,
  email delivery, and installed-release routing pass.
- [ ] Android `assetlinks.json` contains the Play App Signing SHA-256 fingerprint
  and is deployed; a debug fingerprint or placeholder does not pass this gate.

## Xcode And SwiftUI Release Gate

- [ ] Release build uses the current stable Xcode lane, not an Xcode beta, unless explicitly approved.
- [ ] Xcode 27 beta compatibility issues are tracked separately from the shipping release.
- [ ] iOS 15/16 debugging remains on Xcode 26.x if older-device behavior is in scope.
- [ ] SwiftUI changes followed `docs/ios-swiftui-release-workflow.md`.
- [ ] Important changed screens have preview or fixture coverage for empty, loading, error, populated, long text, dark mode, and Dynamic Type states.
- [ ] Accessibility pass covers VoiceOver labels/order, Dynamic Type clipping, and Reduce Motion.
- [ ] Performance review checked for work in `body`, unstable `ForEach` identity, broad state invalidation, large images, and over-broad animations.
- [ ] Release-sensitive UI changes were verified with `porizo-simulator-testing` or an equivalent simulator/device pass.
- [ ] Organizer, crash, or analytics signals were checked for launch, hangs, hitches, battery, disk writes, storage, and crashes when available.
- [ ] App Store screenshot, icon, metadata, or localization impact is either updated or explicitly marked as not affected.

## App Store Presence

- [ ] First three screenshots explain the product without scrolling.
- [ ] Screenshots include occasion language: birthday, Mother's Day, anniversary, custom song.
- [ ] App preview video exists or is explicitly deferred with a release owner.
- [ ] Subtitle and keyword field match current acquisition focus.
- [ ] No unverified ratings, review counts, usage counts, or testimonials appear in public copy.
- [ ] Custom Product Pages are mapped to active Apple Ads ad groups.

## Acquisition Links

- [ ] `/download` redirects to the correct App Store URL on iOS.
- [ ] `/download` preserves UTM logging in `download_events`.
- [ ] Occasion landing pages return 200:
  - [ ] `/mothers-day-song`
  - [ ] `/birthday-song-maker`
  - [ ] `/anniversary-song-gift`
  - [ ] `/custom-song-gift`
- [ ] `/sitemap.xml` includes every public acquisition page.
- [ ] Google Search Console sitemap has no invalid date or URL errors.

## Product Funnel

- [ ] First app open/onboarding path still reaches create flow.
- [ ] Onboarding sample song still plays.
- [ ] Launch flash still plays from the song library when eligible.
- [ ] OneSignal tags and push registration still work.
- [ ] Old-version update prompt still appears when server config requires it.
- [ ] `create_started`, `create_completed`, `first_song_completed`, `share_completed` events are visible after a full happy-path run.

## Share Loop

- [ ] A generated song can create a share link immediately.
- [ ] Shared web link plays in a browser without requiring the recipient to install first.
- [ ] Shared web link has a visible recipient CTA to create/download.
- [ ] Share text is human and occasion-specific, not generic product copy.
- [ ] `/download` links from share pages include share/recipient UTM parameters.

## Review Prompt

- [ ] App review prompt is triggered only after positive intent: successful play or share.
- [ ] Prompt does not appear during onboarding, errors, failed renders, payment, or support flows.
- [ ] `ReviewManager` yearly and spacing limits remain intact.

## Apple Ads

- [ ] Brand, Category, Competitor, and Discovery campaigns remain separated.
- [ ] Exact intent keywords with installs are funded first.
- [ ] Broad terms with spend and no registrations are paused.
- [ ] New keyword tests are tied to a Custom Product Page or a clear search-intent hypothesis.
- [ ] Backend registration/source report is compared against Apple Ads installs before increasing budget.
