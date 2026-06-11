# Pre-TestFlight Distribution Checklist

Run this before any TestFlight upload or release candidate.

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
