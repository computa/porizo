# Android U11 Native Parity QA Matrix

Date: 2026-07-04
Source plan: `docs/plans/2026-07-04-002-feat-android-native-parity-closeout-plan.md`
Status: ready for execution after Android debug build passes.

## Evidence Rules

- Capture Android and iOS side by side for each row unless the row is a backend/provisioning gate.
- Capture light and dark mode for every screen row.
- Save screenshots under `docs/parity-2026-07/evidence/android-u11/screenshots/`.
- Save recordings under `docs/parity-2026-07/evidence/android-u11/recordings/`.
- A row is `PASS` only when behavior and visual hierarchy match the iOS reference within native Android conventions.
- A row with missing external credentials is `BLOCKED`, not `PASS`.

## Matrix

| ID | Flow | Android path | iOS reference | Required setup | Evidence | Assertions | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U11-01 | Onboarding splash/mirror | `feature:onboarding` `OnboardingScreen` | `PorizoApp/PorizoApp/Onboarding/OnboardingV2View.swift` | Fresh install or cleared onboarding prefs | Screenshot pair, light/dark | Splash and mirror stages are present, copy hierarchy is comparable, skip/continue are reachable | Pending |
| U11-02 | Onboarding questionnaire/back/skip | `OnboardingViewModel`, `OnboardingGraphEngine` | `OnboardingV2View.swift` | Fresh install | Recording | Adaptive questions, back behavior, skip payoff, and partial payload are preserved | Pending |
| U11-03 | Onboarding payoff to create | `AppRoot`, `CreateViewModel.beginFromOnboarding` | iOS onboarding create handoff | Fresh install, complete onboarding | Recording | Recipient, tone, message, and occasion seed Create without draft loss on relaunch | Pending |
| U11-04 | Auth 401 refresh/retry | `AuthSessionCoordinator`, protected repositories | `Services/Auth/RefreshCoordinator.swift` | Expired access token with valid refresh token | Unit test log or debug recording | One refresh coordinates concurrent calls, retries once, clears only on refresh failure | Pending |
| U11-05 | Signed-out share resume | `PendingDeepLinkStore`, `AppRoot`, `ClaimViewModel` | `ReceiverClaimView.swift` and iOS link coordinator | Signed-out app, valid share link | Recording | Auth opens, successful sign-in resumes exact share once, pending action clears after consumption | Pending |
| U11-06 | Receiver handoff resume | `DeepLinkRoute.ReceiverHandoff`, `ClaimViewModel` | `ReceiverClaimView.swift` | Valid receiver handoff link | Recording | Handoff survives sign-in and retains claim token/PIN state | Pending |
| U11-07 | Claim success song | `ClaimCompletion`, `SongsViewModel` | iOS receiver claim success | Claimed song share | Recording | Success closes/updates sheet, Songs refreshes, claimed song is discoverable | Pending |
| U11-08 | Claim success poem | `ClaimCompletion`, `PoemsViewModel` | iOS poem claim flow | Claimed poem share | Recording | Poems refreshes and poem detail/open path is available | Pending |
| U11-09 | Song create lyrics review | `CreateScreen`, `CreateViewModel`, lyrics GET/PUT | `Controllers/LyricsReviewController.swift` | Auth user, story-to-track backend available | Recording | Lyrics are editable, unsaved edits save before approval, approval failures recover in review | Pending |
| U11-10 | Render failure recovery | `RenderController`, `CreateViewModel` | iOS render/reveal controller | Simulated failed render or backend fixture | Recording | Retry/edit/paywall states match iOS-supported recovery paths | Pending |
| U11-11 | Songs library actions | `SongsScreen`, `SongsViewModel` | iOS library/player screens | Auth user with ready and not-ready songs | Screenshot pair, recording | Play, share, delete, refresh, errors, empty states match supported iOS action set | Pending |
| U11-12 | Poems library actions | `PoemsScreen`, `PoemsViewModel` | iOS poems library | Auth user with poems | Screenshot pair, recording | Open detail, share, delete, audio generation state, empty/error states are clear | Pending |
| U11-13 | Mini player and now playing | `MiniPlayerBar`, `NowPlayingSheet`, `PorizoPlayer` | `Services/NowPlayingManager.swift` | Ready owned song | Recording | Play/pause/seek remain synced with ExoPlayer state and owned streams carry auth headers | Pending |
| U11-14 | Android system media controls | `Media3AudioPlaybackEngine` | iOS now-playing controls | Emulator or physical Android device | Recording | Lock-screen/notification controls show title/artist/artwork and can play/pause/seek | Pending |
| U11-15 | Billing purchase lifecycle | `SettingsViewModel`, `PlayBillingProvider` | `StoreKitManager.swift` | Play internal test track, configured products | Recording plus backend receipt log | Purchase token persists, receipt sync happens before acknowledgement, pending/rejected states are visible | Blocked: Play Console |
| U11-16 | Push render complete | `PushProvider`, `PushRouting`, server `push-notification.js` | iOS APNs render route | OneSignal app id, REST key, Android subscription id registered | Server log plus recording | Server sends OneSignal notification, tap opens Songs, app re-fetches track state | Blocked: OneSignal credentials |
| U11-17 | Push unsupported payload | `PushRouting`, `AppNavigationShell` | iOS push fallback behavior | Local injected payload | Recording | Unknown types become informational notices and do not mutate privileged state | Pending |
| U11-18 | Device trust | `DeviceTrustProvider`, Settings trust status | iOS device-token constraints | App Set ID + Play Integrity provider and backend nonce endpoint | Screenshot plus backend verification log | Debug degrades visibly; release verification uses nonce, package/signature binding, freshness, and backend verification | Blocked: provider/backend |
| U11-19 | App Links | `AndroidManifest.xml`, `PendingDeepLinkStore` | iOS universal links | Published `assetlinks.json` for Play signing certificate | ADB/browser recording | `https://porizo.co` and `https://www.porizo.co` links open native routes | Blocked: assetlinks |
| U11-20 | Release provisioning | `PLAY_STORE_CHECKLIST.md`, Gradle release tasks | iOS release checklist | Real keystore, production URL, Play products, backend env | Build artifacts plus checklist | Release build is store-signed, uses production API, and all external gates are marked done or blocked | Pending |

## Reconciliation Rule

`docs/parity-2026-07/android-ios-parity-gaps.md` can only mark U1-U10 `DONE`
after every non-blocked row above has evidence and every blocked row has an
owner, external ticket, or concrete provisioning artifact path.
