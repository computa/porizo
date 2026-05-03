# iOS Funnel: Implement Solt's Packaging Rules

Goal: apply Paul Solt's packaging rules to Porizo to improve 3 ratios — impression→install, install→registration, registration→first-song-started. Review first; ship fixes only where the current state clearly fails. 3-second first-impression bar.

Pricing is **excluded** from this pass. Current baseline worst leaks are impression→page-view (2%) and download→registration (66% per `docs/research/growth-initiatives-2026-04-07.md:19`); paywall timing changes would broaden scope and muddy attribution. Revisit after this pass.

## 1. Icon — review only

**Review.** Capture current icon at App Store size beside top 5 Music/Entertainment competitors.
**Pass if:** reads as music + gift + emotion in under 1 second.
**Fix only if clear fail.** Brief a new icon, replace in `PorizoApp/Assets.xcassets/AppIcon.appiconset/` and App Store Connect.

## 2. Screenshots — likely fail, ship replacement

**Review.** Current listing in `docs/appstore/subscription-screenshots/listing/` shows 8 broad feature screens (splash, explore-home, create-choice, create-song, create-poem, personalize, story-chat, voice-profile) — broad product tour, not one story.
**Fix (expected):** replace first 5 screenshots with this sequence, sourced from `PorizoApp/screenshots/appstore-6.5/`:
1. "Create a personalized song gift"
2. "For birthdays, anniversaries, and meaningful moments"
3. "Tell us who it's for and what to say"
4. "Preview your custom song in about 90 seconds"
5. "Share something personal and memorable"

Do not use poems, profile, explore, or voice-profile in the first 5.

## 3. Onboarding — review first

**Review.** Walk `PorizoApp/PorizoApp/Onboarding/OnboardingV2View.swift:70` pre-auth flow: splash → mirror → questionnaire → processing → payoff. Score each screen on two axes: (a) does it increase emotional commitment to the gift moment, (b) does it teach product mechanics.
**Pass if:** every pre-auth screen increases commitment and teaches zero mechanics.
**Fix only on proven drag.** Do not cut screens by default. Candidates to watch: the mirror screen, and individual questions inside the questionnaire graph (e.g. pain-points block in `OnboardingV2View.swift:208`) — cut only if review shows they slow progress without increasing commitment.

## 4. App Flow — review continuation, fix weak spots

**Context already implemented.** `RootView.swift:441` sets `pendingCreateAutostart = true` and preserves `recipientName/occasion/emotionalSeed/relationshipType` on onboarding complete; `RootView.swift:234` passes them into `MainTabView`.

**Review.** Walk fresh path: onboarding payoff → auth → post-auth destination. Confirm that after auth the user is *visibly and reliably* continued into "your song for {recipient}," not dropped into a generic home.
**Pass if:** continuation is obvious to a first-time user.
**Fix only if continuation is weak or lost.** Likely small fixes:
- Strengthen auth copy in `PorizoApp/PorizoApp/AuthView.swift:49` (keep promise, tie to recipient if context exists)
- Reduce competing above-the-fold actions in `PorizoApp/PorizoApp/Tabs/ExploreTabView.swift:47` for users with no completed first song

## 5. Measurement — prerequisite

Verify these events emit and are queryable in `PorizoApp/PorizoApp/Services/AnalyticsService.swift` (current enum incomplete at `:15`):
- `onboarding_v2_completed`
- `onboarding_v2_create_tapped`
- `auth_completed`
- `create_started`
- `first_preview_ready`

## Done when

Each of #1–4 has a one-line review verdict with cited evidence; any failure has a shipped fix; events in #5 are emitting. Baseline to beat: 2% impression→page-view, 17% page-view→install, 66% install→registration.
