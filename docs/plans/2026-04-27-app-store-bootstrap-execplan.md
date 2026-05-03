# Bootstrap Porizo App Store Downloads

This ExecPlan is a living document. Maintain Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective as work proceeds.

No repository-level PLANS.MD exists. This plan follows ~/.codex/PLANS.MD.

## Purpose / Big Picture

Porizo needs its first reliable App Store download loop. After this work, paid Apple Search Ads traffic should land on product pages that match the user's search intent, open the app into the correct creation flow, and produce measurable downstream actions: install, onboarding completion, first song started, first song completed, and review prompt eligibility.

The goal is not scale yet. The goal is to prove that high-intent gift searches can produce qualified installs and first song creation at an acceptable cost.

## Progress

- [x] (2026-04-27) Reviewed current Apple Ads relaunch plan and live App Store metadata.
- [x] (2026-04-27) Confirmed live custom product pages exist for Birthday Songs, Anniversary & Wedding, and Gift a Song.
- [x] (2026-04-27) Found that create deep links such as porizo://create?type=song&occasion=birthday are not currently handled by RootView.
- [x] (2026-04-27) Saved this ExecPlan in the repository.
- [x] (2026-04-27) Implemented create deep-link parsing and routing in RootView.
- [x] (2026-04-27) Added Mother's Day as a first-class Occasion.
- [x] (2026-04-27) Ran xcodebuild test successfully: 205 tests, 2 skipped, 0 failures.
- [x] (2026-04-27) Created a new Anniversary & Wedding CPP version with corrected song deep link.
- [ ] Capture baseline Apple Ads and App Store Connect metrics manually.
- [x] Fix create deep link handling in the iOS app.
- [ ] Fix Anniversary CPP deep link or copy mismatch.
- [ ] Create Mother's Day CPP and Apple Ads ad variation.
- [ ] Relaunch tightly scoped Apple Ads test.
- [ ] Review results after 48 hours, 7 days, and 10 days.

## Surprises & Discoveries

- Observation: App Store Connect API access is healthy for app metadata but forbidden for analytics report requests with the current API key.
  Evidence: asc analytics requests returned a forbidden error.

- Observation: Anniversary & Wedding CPP currently deep-links to a poem flow while its copy promises a song.
  Evidence: ASC shows deepLink as porizo://create?type=poem&occasion=anniversary.

- Observation: RootView handles share/email links but returns early for non-share create URLs.
  Evidence: handleIncomingURL calls parseShareUrl and ignores URLs that do not parse as share links.

- Observation: Mother's Day is not currently an Occasion case.
  Evidence: Occasion in PorizoApp/PorizoApp/Models/TrackModels.swift has birthday, anniversary, thank_you, and other generic occasions, but not mothers_day.

- Observation: Approved CPP versions cannot be edited in place.
  Evidence: asc product-pages custom-pages versions update failed with "not in an editable state"; creating version 2 succeeded with state PREPARE_FOR_SUBMISSION.

## Decision Log

- Decision: Use Search Results ads only for the first bootstrap test.
  Rationale: Search Results has the strongest download intent. Broader placements should wait until the product page converts.
  Date/Author: 2026-04-27 / Codex

- Decision: Keep competitor terms paused.
  Rationale: Porizo is a gift product, not a generic AI music tool. Competitor traffic is likely lower intent and more expensive to activate.
  Date/Author: 2026-04-27 / Codex

- Decision: Add create deep link support before relying on CPP deep links.
  Rationale: A CPP can promise a birthday or Mother's Day flow, but the app must route installed users into that flow.
  Date/Author: 2026-04-27 / Codex

- Decision: Add Mother's Day as a first-class Occasion.
  Rationale: The ads should deep-link into a seasonal flow that matches the user's search intent instead of falling back to a generic occasion.
  Date/Author: 2026-04-27 / Codex

## Outcomes & Retrospective

Pending implementation.

2026-04-27: App-side create deep links are implemented and tested. Anniversary & Wedding has a new corrected CPP version in PREPARE_FOR_SUBMISSION, but the currently approved live version still points to poem until the new version is submitted and approved.

## Context and Orientation

Key files:

- /Users/ao/Documents/projects/porizo/marketing/appstore/aso/apple-ads-v1-relaunch-plan.md contains the current Apple Ads strategy.
- /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/RootView.swift handles incoming deep links.
- /Users/ao/Documents/projects/porizo/PorizoApp/PorizoApp/Services/AppleAdsAttributionService.swift stores and submits Apple Ads attribution tokens.
- App Store app ID is 6758205028.
- Bundle ID is porizo.ios.app.PorizoApp.

Terms:

- CPP means Custom Product Page: an alternate App Store product page with different screenshots, promo text, and optional deep link.
- CPT means cost per tap.
- CPA here means cost per install unless otherwise stated.
- Search Results ads are ads shown after a user searches in the App Store.

## Plan of Work

First, capture the current baseline before making changes. In Apple Ads, export or screenshot spend, impressions, taps, installs, CPT, CPA, campaign names, ad groups, keywords, search terms, match types, and placements. In App Store Connect, capture product page views, conversion rate, downloads, and rating count.

Second, fix app routing. Update RootView so URLs like porizo://create?type=song&occasion=birthday and porizo://create?type=song&occasion=mothers_day route to the main app and set pendingCreateType, pendingOccasion, and pendingCreateAutostart. Add focused tests.

Third, fix CPP alignment. Change Anniversary & Wedding to deep-link to song, not poem, or change the copy to mention poems. Recommended: song. Create a new Mother's Day CPP with promo text and screenshots focused on mom gifting.

Fourth, relaunch Apple Ads with a constrained structure:

Brand: exact match only, small daily cap, keywords porizo, porizo app, porizo song.

Mother's Day: exact match only, main near-term test, keywords mother's day song, personalized mother's day song, mother's day gift song, song gift for mom, custom song for mom, unique mother's day gift.

Gift Category: exact match only, keywords personalized song gift, custom song gift, birthday song gift, song gift for mom, song gift for dad, anniversary song gift, custom love song gift, gift song.

Discovery: Search Match on, broad match allowed, daily cap $2-3, used only to mine terms.

Negative keywords: free, karaoke, ringtone, lyrics, streaming, download music, spotify, apple music, playlist, DJ, beat maker, GarageBand, recording studio, loop, sampler, synthesizer, drum machine, audio editor, music production, remix, soundboard, auto tune, pitch correction.

Fifth, add review capture. Trigger SKStoreReviewController only after a successful emotional moment, such as song preview ready, song shared, or recipient opened a share. Gate it so it does not fire during failed generation, auth friction, or first-launch confusion.

## Concrete Steps

From the repo root:

    cd /Users/ao/Documents/projects/porizo
    git status --short
    rg -n "handleIncomingURL|parseShareUrl|pendingCreateType|pendingOccasion" PorizoApp/PorizoApp/RootView.swift
    rg -n "SKStoreReviewController|requestReview" PorizoApp/PorizoApp

Use asc to verify metadata and CPP state:

    asc apps public view --app 6758205028 --country us --output json --pretty
    asc product-pages custom-pages list --app 6758205028 --output json --pretty
    asc product-pages custom-pages versions list --custom-page-id <CPP_ID> --output json --pretty

After iOS changes, run relevant checks:

    xcodebuild -project PorizoApp/PorizoApp.xcodeproj -scheme PorizoApp -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test

If simulator selection differs, use xcodebuild -list and xcrun simctl list devices to choose an available simulator.

## Validation and Acceptance

Deep link acceptance:

Opening porizo://create?type=song&occasion=birthday on an installed build should open Porizo, route to the main app, and start or prefill the song creation flow with Birthday selected.

CPP acceptance:

ASC should show:

- Birthday Songs deepLink = porizo://create?type=song&occasion=birthday
- Mother's Day deepLink = porizo://create?type=song&occasion=mothers_day
- Anniversary & Wedding deepLink = porizo://create?type=song&occasion=anniversary

Apple Ads acceptance:

After 48 hours:

- Campaigns are serving.
- Search Terms report has no obvious free/tool/music-production drift.
- Any spend with taps and no installs is isolated to specific keywords, not the whole account.

After 7 days:

- No impressions means bid or keyword volume issue.
- Impressions but no taps means relevance or product page preview issue.
- Taps but no downloads means App Store page or rating trust issue.
- Downloads but no first song means onboarding or activation issue.

## Idempotence and Recovery

Do not delete campaigns. Pause underperforming campaigns, ad groups, or keywords so history is preserved.

Before editing Apple Ads, export current campaign settings. Before editing CPPs, record current CPP IDs, URLs, deep links, and promo text.

If the iOS deep link change causes routing issues, revert only the create-link handler and leave share/email link behavior untouched.

## Artifacts and Notes

Current known CPPs:

Birthday Songs: d82c5f7c-49be-4857-968d-e559e93cae21

Anniversary & Wedding: b24b31c4-d42d-4c07-8290-52621a2c3c4d

Gift a Song: c27abef4-0e68-4beb-b9ba-eaf718ca8271

Current risk: The app does not yet handle create deep links, so CPP deep links should not be treated as working until validated on device or simulator.

## Interfaces and Dependencies

Use Apple Ads UI for campaign creation and search-term reports.

Use asc for App Store Connect metadata verification where possible.

Use SwiftUI URL handling in RootView for create deep links.

Use existing AppStorage keys pendingCreateType, pendingOccasion, and pendingCreateAutostart to hand off create intent into MainTabView and ExploreTabView.

Use SKStoreReviewController for review prompts, gated behind successful song-related events.
