# Launch Flash: TikTok-Style Auto-Play on Every App Open

**Date:** 2026-04-14
**Status:** Design — ready for implementation
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

1. **The flash IS the landing experience.** No auto-dismiss. User decides when to leave.
2. **Use their content, not marketing copy.** Their own songs remind them why they're here.
3. **Graceful for empty states.** New users see the Porizo demo. Never a blank flash.
4. **Never interrupt their audio.** `mixWithOthers` session, respects silent mode, honors audio interruptions.
5. **User control.** Opt-out in settings for power users who want quiet launches.

---

## Content Priority

Checked in order on every launch:

```
1. Has received songs?     → Pick random from received library
2. Has created songs?      → Pick random from created library
3. Has pending suggestion? → Show onboarding suggestion + "Make This Song" CTA
4. Has nothing?            → Show Porizo demo ("For Mom — Summer at the Lake")
```

**Rotation within a library:**
- Random pick, excluding the last-shown track ID (stored in `@AppStorage`)
- If user has both received AND created songs, weight received 70% (emotionally heavier)

---

## Visual & Audio

**Visual:** Reuses `LivingSplashView` visual language — warm parchment background, centered song card with coral gradient cover art, recipient label, song title, lyric line, pulsing waveform.

**Audio:**
- Auto-plays at 60% volume on appear
- `AVAudioSession.playback` with `.mixWithOthers`
- Silent mode → visual-only, play button appears as affordance
- Failure → graceful silent fail, visual continues

**Audio source by content type:**

| Content | Audio URL |
|---------|-----------|
| Received song | Track's `preview_url` or `full_url` |
| Created song | Same — user's own track streaming URL |
| Pending suggestion | Server demo audio |
| Porizo demo | Server demo audio (bundled fallback if offline) |

**Dismissal:** Tap anywhere → fade audio over 500ms → transition to main app.

---

## Launch Timing

| Scenario | Behavior |
|----------|----------|
| Cold launch (app was quit) | Show flash |
| Warm resume < 10 min | Skip flash, go to main |
| Warm resume >= 10 min | Show flash (feels like new session) |
| Deep link / universal link | Skip flash, honor link target |
| User in onboarding | Skip flash (onboarding IS their flash) |
| User logged out | Skip flash, go to auth |
| `launchFlashDisabled == true` | Skip flash permanently |

Implementation: track `lastBackgroundedAt` in `@AppStorage`, check delta on `scenePhase` change.

---

## State Machine Changes

```
RootState enum additions:
  case launchFlash

Flow for returning authenticated user:
  .splash (system 1s) → .launchFlash → .main

Flow for returning unauthenticated user:
  .splash → .launchFlash → .auth

Flow for new user:
  .splash → .onboardingV2 → .main  (launch flash bypassed)
```

---

## User Setting

**New Settings row:** `Settings → Launch Flash`

Toggle options:
- **On** (default) — rotate through library
- **Only My Songs** — exclude received songs (privacy-conscious users)
- **Off** — disable flash entirely, go straight to main

Escape hatch: long-press anywhere on the flash → "Hide launch flash?" confirmation → disables.

---

## Failure Modes

| Scenario | Behavior |
|----------|----------|
| Cache empty + offline | Show Porizo demo (bundled asset, no network) |
| Audio URL 404s | Visual shows, no audio, no error toast |
| Track metadata corrupted | Skip, try next from cache |
| First launch post-install (no cache) | Show Porizo demo |

---

## Interaction Edge Cases

- User taps during audio fade-in (<500ms) → immediate dismiss
- User locks phone during flash → pause, resume on unlock from same position
- Incoming call → AVAudioSession handles interruption, flash stays visible, audio stops
- VoiceOver user → auto-dismisses after 2s, VO reads "Porizo. Song for {name}."

---

## Implementation Plan

**Phase A — Models & Resolver**
- `LaunchFlashContent.swift` — model (title, recipientName, lyricPreview, audioURL, source enum)
- `LaunchFlashResolver.swift` — picks content from `LocalCache.shared`, `@AppStorage("pendingSuggestion")`, server config
- Unit-testable in isolation

**Phase B — View**
- `LaunchFlashView.swift` — reuses `LivingSplashView` visual structure, accepts `LaunchFlashContent`
- Owns its own AVPlayer (terminal view, not part of a multi-screen flow)
- Tap-to-dismiss with 500ms audio fade

**Phase C — RootView Integration**
- Add `.launchFlash` case to `RootState` enum
- Modify splash transition logic
- Add `lastBackgroundedAt` scene phase tracking
- Respect `launchFlashDisabled` and `launchFlashMode` AppStorage keys

**Phase D — Settings**
- New `Settings → Launch Flash` row
- Three-way toggle: On / Only My Songs / Off

**Phase E — Analytics**
- `launch_flash_shown` — `source`, `audio_played`
- `launch_flash_dismissed` — `duration_ms`, `audio_completed`
- `launch_flash_disabled` — entry point (`long_press` or `settings`)

**Phase F — Polish**
- Haptic feedback on dismiss
- Preload audio during system splash (1s) for instant playback
- Respect Reduce Motion: skip waveform pulse animation

---

## New Files

| File | Purpose |
|------|---------|
| `Launch/LaunchFlashContent.swift` | Content model |
| `Launch/LaunchFlashResolver.swift` | Content selection logic |
| `Launch/LaunchFlashView.swift` | Full-screen flash view with AVPlayer |

---

## Modified Files

| File | Change |
|------|--------|
| `RootView.swift` | Add `.launchFlash` state, routing logic, scene phase tracking |
| `Settings` tab views | Add Launch Flash toggle row |
| `AnalyticsService.swift` | Add 3 new event cases |

---

## New @AppStorage Keys

| Key | Default | Purpose |
|-----|---------|---------|
| `lastBackgroundedAt` | 0 | Timestamp for warm resume detection |
| `lastLaunchFlashTrackId` | "" | Avoid immediate repeats in rotation |
| `launchFlashDisabled` | false | Master opt-out toggle |
| `launchFlashMode` | "all" | "all" / "my_songs" / "off" |

---

## Analytics Events

| Event | Properties |
|-------|------------|
| `launch_flash_shown` | `source: "received"|"created"|"suggestion"|"demo"`, `audio_played: bool` |
| `launch_flash_dismissed` | `duration_ms: int`, `audio_completed: bool` |
| `launch_flash_disabled` | `source: "long_press"|"settings"` |

---

## Success Metrics

Track these weekly after launch:
1. **Retention lift** — D7, D14, D30 retention for cohort with launch flash vs without
2. **Session length** — does the flash increase time-in-app per session?
3. **Creation rate** — do users with pending suggestions who see the flash convert higher?
4. **Disable rate** — what % of users opt out? If >20%, the flash is too aggressive

---

## Non-Goals For V1

- Multiple tracks per launch (carousel) — one song per launch
- Lyrics scrolling in sync with audio — static lyric line only
- Social sharing from the flash — tap goes to main app only
- Notifications that link to flash playback
- Flash for push notification opens (those honor the deep link)

---

## Open Questions

1. **Bundled demo asset:** Should we ship an MP3 in the app bundle for true offline-first demo playback, or accept that offline first-launch = visual-only?
2. **Received song privacy:** Should we default `launchFlashMode` to `"my_songs"` to avoid someone else's song auto-playing in public, or default to `"all"` for maximum emotional impact?
3. **Rotation fatigue:** After how many shows of the same song should we force-skip it? (Spec says exclude last-shown; should we track more history?)

---

## Final Product Stance

Every time a user opens Porizo, the product should remind them in 3 seconds or less what it does — ideally using something they care about. Not a logo animation. Not a tagline. A real personal song, playing.

That is the standard for the Launch Flash.
