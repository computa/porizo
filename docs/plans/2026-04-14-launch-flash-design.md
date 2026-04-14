# Launch Flash: TikTok-Style Auto-Play on Every App Open

**Date:** 2026-04-14
**Status:** Design — reviewed by correctness/reliability/api-contract reviewers
**Author:** Brainstorm session

---

## Problem

Users who complete onboarding and create their first song may return two weeks later having forgotten what Porizo is about. The app opens into the main tab view with no emotional reinforcement of the product's core value — a personal song gift. The onboarding flash fires once and never again.

Every launch should remind users, in 3 seconds or less, what this product does — ideally using content that is personally meaningful to them.

---

## Product Decision

Port the TikTok "video auto-plays on open" pattern to Porizo. Every cold launch (and long warm resume) shows a full-screen song flash that plays until the user taps to dismiss. The flash content rotates through the user's library to keep every open a small rediscovery.

This is separate from onboarding. Onboarding fires once for new users. Launch Flash fires for every returning user, every session.

---

## Design Principles

1. **The flash IS the landing experience.** No auto-dismiss (except VoiceOver). User decides when to leave.
2. **Use their content, not marketing copy.** Their own songs remind them why they're here.
3. **Graceful for empty states.** New users see the Porizo demo. Never a blank flash.
4. **Never block the app.** Flash failures route silently to main. Crashes auto-disable the flash.
5. **Never interrupt their audio.** `.ambient + .mixWithOthers` session, respects silent mode, honors interruptions.
6. **User control.** Single setting, opt-out via long-press or Settings.

---

## Content Priority

Checked in order on every launch:

```
1. mode == "all" AND has received songs?  → Pick from received library (with rotation)
2. Has created songs?                      → Pick from created library (with rotation)
3. Has unconsumed pendingSuggestion?       → Show suggestion + "Make This Song" CTA
4. Demo audio URL available?               → Show Porizo demo
5. None of the above?                      → Skip flash, go straight to main/auth
```

**Rotation algorithm (within a chosen library):**

```swift
let pool = library.filter { !recent.contains($0.id) }
return pool.randomElement()
    ?? library.filter { $0.id != recent.last }.randomElement()
    ?? library.randomElement()  // last resort: any track
```

Three-tier fallback guarantees a non-nil pick for any non-empty library.

**Weighted received vs created (mode == "all" only):**

```
1. Roll 70/30 (received vs created)
2. Apply rotation algorithm to chosen library
3. If chosen library yields nothing → try other library with rotation
4. If both yield nothing → fall through to suggestion → demo
```

**Filtering tracks for flash eligibility:**

```swift
let candidates = LocalCache.shared.loadTracks()?.data?.filter { track in
    track.status == "ready" &&
    track.latestVersion > 0 &&
    !track.coverImageUrl.isEmpty == false  // (cover optional, but track must be playable)
} ?? []
```

`Track.isReceived` (== `libraryOrigin == "received"`) partitions received vs created.

**Audio URL source:**

`Track` does NOT carry the streaming URL. URLs live on `TrackVersion`. The resolver fetches the latest `TrackVersion` for the chosen track. If the cache doesn't have the version, the flash falls back to visual-only (no audio).

---

## pendingSuggestion Clearing Rules

The `pendingSuggestion` AppStorage key must be cleared to prevent infinite "Make This Song" CTAs after the user has acted (or stopped caring). Cleared when ANY of:

1. User creates any song where `recipientName` matches the suggestion's recipient (case-insensitive trim)
2. The suggestion has been shown N=5 times (tracked in `pendingSuggestionShowCount` AppStorage)
3. 14 days have passed since the suggestion was set (`pendingSuggestionSetAt` timestamp)

Resolver also de-duplicates: skip the suggestion branch if any created track shares the recipient.

---

## Visual & Audio

**Visual:** Reuses `LivingSplashView` visual language — warm parchment background, centered song card with coral gradient cover art, recipient label, song title, lyric line, pulsing waveform.

**Audio:**
- Auto-plays at 60% volume on appear
- `AVAudioSession.Category.ambient` with `.mixWithOthers` option
  - `.ambient` (NOT `.playback`) respects the silent switch by default
  - `.mixWithOthers` doesn't interrupt podcasts/music
- Failure → graceful silent fail, visual continues
- VoiceOver users → audio skipped entirely; visual + announcement only

**Audio source by content type:**

| Content | Audio URL |
|---------|-----------|
| Received song | `TrackVersion.previewUrl` (from latest version) |
| Created song | Same — user's own track latest version preview URL |
| Pending suggestion | `AppConfig.onboarding.sampleAudioUrl` (server demo) |
| Porizo demo | `AppConfig.onboarding.sampleAudioUrl` (or visual-only if nil) |

**Dismissal flow:**
1. User taps anywhere
2. Synchronously: `player.volume = 0` and `player.pause()`
3. Cancel the fade Task
4. `player.replaceCurrentItem(with: nil)`
5. Deactivate AVAudioSession with `.notifyOthersOnDeactivation`
6. Transition to main app

The synchronous pause + nil-out prevents the "audio blasts after dismiss" race.

---

## Launch Timing

| Scenario | Behavior |
|----------|----------|
| Cold launch (process started fresh) | Show flash |
| Warm resume < 10 min | Skip flash, go to main |
| Warm resume ≥ 10 min | Show flash (feels like new session) |
| Deep link / universal link / push notification arrived during launch | Skip flash, honor link target |
| Deep link arrives MID-FLASH | Immediate dismiss (skip 500ms fade), route to target |
| User in onboarding (`!hasCompletedOnboarding`) | Skip flash entirely |
| User logged out | Skip flash, go to auth |
| `launchFlashMode == "off"` | Skip flash permanently |
| Backgrounded WHILE flash visible | On return, resume at flash (don't restart, don't re-evaluate timing) |
| Auth token expires mid-flash | Immediate fade-dismiss, route to auth |

**Scene phase tracking:**

- Write `lastBackgroundedAt` ONLY on `.active → .background` transition (NOT `.inactive`)
- `.inactive` fires on Control Center pulldown, banners, app switcher — these don't count as "backgrounded"
- Read-and-evaluate ONLY on `.background → .active`
- Track previous scenePhase explicitly in `@State` so we can distinguish

**Type and unit:**

```swift
@AppStorage("lastBackgroundedAtEpoch") var lastBackgroundedAtEpoch: Double = 0
// stored as Date().timeIntervalSince1970 (seconds, fractional)
// 0 sentinel = never set
```

**Wall-clock safety:**

```swift
let delta = Date().timeIntervalSince1970 - lastBackgroundedAtEpoch
let isFreshSession = (
    lastBackgroundedAtEpoch == 0 ||  // never backgrounded
    delta < 0 ||                      // clock went backward (NTP, manual change)
    delta > 86400 ||                  // >24h — treat as cold
    delta >= 600                      // >10 min normal threshold
)
```

---

## State Machine Changes

```
RootState enum additions:
  case launchFlash

Routing function:
  func nextStateAfterSplash() -> RootState {
      // Bootstrap intent always wins — pending deep link / push / share
      if hasPendingNavigationIntent { return decideMainOrAuth() }
      
      // No flash for users still in onboarding
      if !hasCompletedOnboarding { return .onboardingV2 }
      
      // Settings opt-out
      if launchFlashMode == .off { return decideMainOrAuth() }
      
      // Warm resume < 10 min
      if !isFreshSession { return decideMainOrAuth() }
      
      // Failure circuit breaker
      if launchFlashFailureCount >= 3 { return decideMainOrAuth() }
      
      // Resolver returns nil if no content available at all
      guard resolver.hasContent() else { return decideMainOrAuth() }
      
      return .launchFlash
  }
```

State machine guard: scenePhase listeners only re-evaluate flash when `appState ∈ {.splash, .main, .auth}`. If `appState == .onboardingV2`, do nothing on `.background → .active`.

---

## Hard Budgets & Circuit Breaker

The flash is on the critical path. It must NEVER block the app.

**Budgets:**
- Content resolver: 400ms max (runs on background queue)
- First audio frame: 1.5s max (after view appears)
- Visible-without-input failsafe: 15s — if user hasn't tapped after 15s, auto-dismiss

**Circuit breaker:**

```swift
@AppStorage("launchFlashFailureCount") var launchFlashFailureCount: Int = 0
```

- Increment on any uncaught error during flash bootstrap (resolver, view init, AVPlayer construction)
- After 3 consecutive failures → skip flash for the rest of the install (until manually reset)
- Reset to 0 on successful flash completion
- Emit `launch_flash_failed` analytic on each increment with `error_type` property

**Top-level safety wrapper:**

```swift
do {
    let content = try resolver.resolve(mode: launchFlashMode)
    appState = .launchFlash(content)
} catch {
    launchFlashFailureCount += 1
    AnalyticsService.shared.log(.launchFlashFailed, properties: ["error_type": "\(error)"])
    appState = decideMainOrAuth()
}
```

**Remote kill switch:**

`AppConfig.flags.launch_flash_enabled` (server-side flag). Default `true`. If `false`, skip flash regardless of local state. Allows hot-disable without app update if a bug ships.

---

## User Setting (Single Source of Truth)

**One AppStorage key:**

```swift
enum LaunchFlashMode: String, CaseIterable {
    case all          // rotate through all songs (received + created)
    case mySongs      // exclude received songs (privacy mode)
    case off          // never show
}

@AppStorage("launchFlashMode") var launchFlashModeRaw: String = LaunchFlashMode.all.rawValue
var launchFlashMode: LaunchFlashMode {
    LaunchFlashMode(rawValue: launchFlashModeRaw) ?? .all
}
```

**Settings UI:** `Settings → Launch Flash` segmented control: `All Songs / Only Mine / Off`

**Long-press escape:** Long-press anywhere on the flash for ≥1.2s → confirmation alert "Hide launch flash?" → on confirm, sets `launchFlashMode = .off`. Toast: "Launch flash turned off — turn back on in Settings."

Use `.simultaneousGesture(LongPressGesture(minimumDuration: 1.2))` so it doesn't conflict with tap-to-dismiss.

---

## Failure Modes (Comprehensive)

| Scenario | Behavior |
|----------|----------|
| `LaunchFlashResolver` throws | Catch at top level, increment failure count, route to main |
| `LaunchFlashView` init crashes | Same as above (AppDelegate crash handler logs, skips flash next launch) |
| AVPlayer construction throws | Visual-only mode, no audio, no error toast |
| Audio URL 404 / 403 / network failure | Visual-only, log `launch_flash_audio_failed` |
| LocalCache returns nil/empty | Fall through priority chain → suggestion → demo |
| `pendingSuggestion` JSON malformed | Treat as nil, fall through to demo |
| `recentLaunchFlashTrackIds` JSON malformed | Reset to `[]`, log analytic, continue |
| `AppConfig.onboarding.sampleAudioUrl` nil (offline first install) | Visual-only demo |
| Resolver returns nil (no content at all available) | Skip flash entirely, route to main |
| AVAudioSession activation fails | Visual-only, no audio attempted |
| Audio interruption (call, Siri) | Pause; on `.ended` with `.shouldResume`, resume from position; if interruption >5s, dismiss flash |
| Route change (headphones unplugged) | Pause, show "play" affordance |
| User locks phone mid-flash | Pause; on unlock, resume from same position |
| Backgrounded mid-flash | Pause audio; on foreground, resume at same flash, same content |
| Deep link arrives mid-flash | Immediate dismiss (skip fade), tear down player, route to target |
| Auth token expires mid-flash | Immediate fade-dismiss, route to `.auth` |
| User taps before audio loads | Tear down immediately; don't start fade |

---

## AVPlayer Lifecycle Contract

LaunchFlashView owns its own AVPlayer in a `@StateObject` view model.

**Setup (on view appear):**
```swift
- Configure AVAudioSession (.ambient + .mixWithOthers)
- Activate session
- Create AVURLAsset(url: contentURL) with timeout
- Create AVPlayerItem from asset
- Add KVO observer for status (track in array of NSKeyValueObservation)
- Register interruption observer
- Register route change observer  
- Add periodic time observer (track for removal)
- player.replaceCurrentItem(with: item)
- player.play()
```

**Teardown (on dismiss):**
```swift
- Cancel any pending fade Task
- player.volume = 0
- player.pause()
- Invalidate all KVO observers
- Remove all NotificationCenter observers
- Remove periodic time observer
- player.replaceCurrentItem(with: nil)
- AFTER fade completes: AVAudioSession.setActive(false, options: .notifyOthersOnDeactivation)
- View model released by SwiftUI
```

**Coordination with `PlayerState` (existing global player):**
- `PlayerState` does NOT touch the audio session while `appState == .launchFlash`
- LaunchFlashView fully releases the session before transitioning to `.main`
- Document this in PlayerState.swift comments

---

## Type Definitions

```swift
struct LaunchFlashContent {
    let trackId: String?           // nil for suggestion and demo sources
    let title: String              // required, never empty
    let recipientName: String?     // optional (nil for some demos)
    let lyricPreview: String?      // optional
    let audioURL: URL?             // nil = visual-only mode
    let coverImageURL: URL?        // nil = use coral gradient fallback
    let source: LaunchFlashSource
}

enum LaunchFlashSource: String, CaseIterable {
    case received
    case created
    case suggestion
    case demo
}

protocol LaunchFlashContentSource {
    func loadTracks() -> [Track]
}

struct LaunchFlashResolver {
    init(
        source: LaunchFlashContentSource,
        config: OnboardingConfig?,
        defaults: UserDefaults,
        randomSource: RandomNumberGenerator = SystemRandomNumberGenerator()
    )
    
    func hasContent() -> Bool
    func resolve(mode: LaunchFlashMode) -> LaunchFlashContent?  // nil = skip flash
}
```

The `randomSource` injection enables deterministic testing of the 70/30 weighting and rotation algorithms.

---

## AppStorage Keys (Final)

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `lastBackgroundedAtEpoch` | Double | 0 | `Date().timeIntervalSince1970` of last `.active → .background` |
| `recentLaunchFlashTrackIds` | String (JSON) | `"[]"` | JSON array of last 3 track IDs, newest-first |
| `launchFlashMode` | String | `"all"` | `"all"` / `"mySongs"` / `"off"` |
| `launchFlashFailureCount` | Int | 0 | Consecutive failures; >=3 disables flash |
| `pendingSuggestionShowCount` | Int | 0 | How many times the pending suggestion has been shown in the flash |
| `pendingSuggestionSetAt` | Double | 0 | When the pending suggestion was created (for 14-day expiry) |

`recentLaunchFlashTrackIds` semantics:
- Encoding: JSON `[String]` in a String column
- Ordering: newest-first; prepend on write, truncate to max 3
- Write: optimistically at resolver-decision-time (not onAppear) — guarantees rotation even on fast-kill
- Read: decode with `try?`, fallback to `[]` on any failure

---

## Analytics Events

```
launch_flash_shown
  - source: "received" | "created" | "suggestion" | "demo"
  - audio_attempted: bool   (did we try to play audio at all)
  - track_id: String?       (nil for demo/suggestion)

launch_flash_audio_started
  - source: String
  - first_frame_delay_ms: Int   (from view appear to first audio frame)

launch_flash_dismissed
  - duration_ms: Int             (from view appear to tap)
  - audio_finished_naturally: bool   (true iff player reached duration - 0.5s)
  - dismissal_type: "tap" | "deep_link" | "auth_change" | "auto_15s_failsafe" | "voiceover_2s"

launch_flash_disabled
  - source: "long_press" | "settings"

launch_flash_failed
  - error_type: String
  - failure_count: Int   (cumulative)
```

All values use Swift `enum: String` raw values for stability.

---

## DEBUG Bypass

Test fixtures and validation harnesses must bypass the flash:

- `--bypass-auth` and `--reset-onboarding` debug flags also bypass the launch flash
- `--launch-flash-disabled` flag forces skip
- `--reset-onboarding` clears: `recentLaunchFlashTrackIds`, `lastBackgroundedAtEpoch`, `launchFlashMode`, `launchFlashFailureCount`, `pendingSuggestionShowCount`, `pendingSuggestionSetAt`
- UI tests for non-flash flows must include `--launch-flash-disabled`

---

## VoiceOver Behavior

For users with VoiceOver enabled:

- Skip audio playback entirely (visual-only)
- Post `UIAccessibility.Notification.announcement` with: `"Porizo. {Title} for {recipientName}."`
- Observe `UIAccessibility.announcementDidFinishNotification` — auto-dismiss when announcement completes (or 4s timeout, whichever first)
- This is a documented exception to Principle 1 ("no auto-dismiss")

---

## Implementation Plan

**Phase A — Models & Resolver**
- `Launch/LaunchFlashContent.swift`
- `Launch/LaunchFlashSource.swift` (enum)
- `Launch/LaunchFlashMode.swift` (enum)
- `Launch/LaunchFlashContentSource.swift` (protocol)
- `Launch/LaunchFlashResolver.swift` — deterministic, dependency-injected, unit-tested
- Unit tests with fixture libraries: 0, 1, 2, 3, 4, 10 tracks × 0/1/2/3 recent IDs

**Phase B — View**
- `Launch/LaunchFlashViewModel.swift` — owns AVPlayer, observers, lifecycle
- `Launch/LaunchFlashView.swift` — visual layer, reuses LivingSplashView styling
- Audio preload starts when content resolves (during system splash window)
- Tap + long-press gestures via `.simultaneousGesture`

**Phase C — RootView Integration**
- Add `.launchFlash(LaunchFlashContent)` case to `RootState` enum
- `BootstrapIntent` struct captures pending deep link / push / universal link
- `nextStateAfterSplash()` routing function with all guards
- Scene phase tracking via `@Environment(\.scenePhase)` + previous-phase `@State`
- Deep link interceptor (cancels in-flight flash if needed)

**Phase D — Settings**
- `Settings → Launch Flash` segmented control row
- Wired to `launchFlashMode` AppStorage

**Phase E — Analytics**
- Add 5 new event cases to AnalyticsService
- Wire all events with correct timing

**Phase F — Polish**
- Haptic feedback on dismiss (UIImpactFeedbackGenerator.light)
- Reduce Motion: skip waveform pulse animation
- Performance benchmark: cold launch → first audio frame on a reference device

---

## New Files

| File | Purpose |
|------|---------|
| `Launch/LaunchFlashContent.swift` | Content model |
| `Launch/LaunchFlashSource.swift` | Source enum |
| `Launch/LaunchFlashMode.swift` | User setting enum |
| `Launch/LaunchFlashContentSource.swift` | Protocol for resolver dependency injection |
| `Launch/LaunchFlashResolver.swift` | Content selection logic |
| `Launch/LaunchFlashViewModel.swift` | AVPlayer + lifecycle owner |
| `Launch/LaunchFlashView.swift` | Visual layer |
| `Launch/BootstrapIntent.swift` | Pending navigation intent (deep link/push/share) |

---

## Modified Files

| File | Change |
|------|--------|
| `RootView.swift` | Add `.launchFlash` state, `nextStateAfterSplash()`, scene phase tracking, BootstrapIntent capture |
| `Settings/SettingsTabView.swift` | Add Launch Flash toggle row |
| `Services/AnalyticsService.swift` | Add 5 new event cases |
| `Services/PlayerState.swift` | Document audio session handoff (no behavioral change) |
| `Services/LocalCache.swift` | Add `LaunchFlashContentSource` conformance |

---

## Resolved Decisions

1. **No bundled demo asset.** Offline first-launch = visual-only. Users need internet to download the app, so offline-after-install is rare.

2. **Default `launchFlashMode = .all`.** Received songs are the emotional anchor. Privacy-conscious users opt out via long-press or Settings.

3. **Exclude last 3 shown track IDs** with three-tier fallback (exclude 3 → exclude 1 → any).

4. **Use `AVAudioSession.Category.ambient`** (NOT `.playback`) so silent switch is respected automatically.

5. **Single AppStorage key for setting** (`launchFlashMode`), no separate `launchFlashDisabled` boolean.

6. **`Date().timeIntervalSince1970` in seconds** (Double) for `lastBackgroundedAtEpoch`. Wall-clock with sanity clamp.

7. **Write `lastBackgroundedAtEpoch` only on `.active → .background`** (not `.inactive`).

8. **Crash circuit breaker** at 3 consecutive failures.

9. **Remote kill switch** via `AppConfig.flags.launch_flash_enabled`.

10. **`pendingSuggestion` clearing rules:** matching recipient created OR shown 5 times OR 14 days old.

---

## Success Metrics

Track these weekly after launch:
1. **Retention lift** — D7, D14, D30 retention with launch flash vs without (cohort or A/B)
2. **Session length** — does the flash increase time-in-app per session?
3. **Creation rate** — do users with pending suggestions who see the flash convert higher?
4. **Disable rate** — what % opt out? If >20%, flash is too aggressive
5. **Failure rate** — what % of launches hit the failure path? Should be <0.1%
6. **Audio-attempt success rate** — what % of `launch_flash_audio_started` events fire successfully?

---

## Non-Goals For V1

- Multiple tracks per launch (carousel) — one song per launch
- Lyrics scrolling in sync with audio — static lyric line only
- Social sharing from the flash — tap goes to main app only
- Notifications that link to flash playback
- Flash for push notification opens (those honor the deep link)
- Bundled demo asset (deferred — see Resolved Decision #1)

---

## Final Product Stance

Every time a user opens Porizo, the product should remind them in 3 seconds or less what it does — ideally using something they care about. Not a logo animation. Not a tagline. A real personal song, playing.

The flash must NEVER break the app. Failures are silent. Users always reach main.

That is the standard for the Launch Flash.
