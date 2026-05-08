# Pre-TestFlight Distribution Checklist

Run this before any TestFlight upload or release candidate.

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

