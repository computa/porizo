# iOS production hardening to Spotify‑level quality

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows the global ExecPlan standard at `~/.codex/PLANS.MD`.

## Purpose / Big Picture

Users should experience a professional, reliable app that behaves like a polished consumer product: consistent login gating, resilient playback, clear recovery from errors, and observable performance. After this work, a user can launch Porizo, authenticate, create or resume a story, generate a song/poem, and play it with background controls and dependable state recovery.

## Progress

- [x] (2026-01-24 19:10Z) Add production‑grade iOS requirements to the main spec.
- [x] (2026-01-24 19:34Z) Implement auth/session hardening and login gating for all protected screens (API client auth failure handler wired in RootView).
- [x] (2026-01-24 20:02Z) Add playback professionalism (background audio + Now Playing + remote controls) (NowPlayingManager + TrackPlayerView/AudioPlayerService wired; build clean of concurrency warnings).
- [x] (2026-01-24 21:05Z) Add network resilience and offline‑first caching for songs/poems lists (LocalCache + withRetry + stale‑while‑revalidate).
- [x] (2026-01-24 21:05Z) Add persistence for in‑flight creation and resume flows (CreateFlowStore + resume wiring).
- [ ] (2026-01-24 19:10Z) Add analytics + crash reporting instrumentation.
- [ ] (2026-01-24 19:10Z) Accessibility and UX polish pass (Dynamic Type, VoiceOver, contrast).
- [ ] (2026-01-24 19:10Z) QA + release checklist and smoke tests.

## Surprises & Discoveries

- Observation: The current app does not integrate lock‑screen media controls, even though it uses AVPlayer.
  Evidence: No `MPNowPlayingInfoCenter` or `MPRemoteCommandCenter` usage found in `PorizoApp/PorizoApp`.

## Decision Log

- Decision: Build production hardening as incremental layers on top of existing flows rather than re‑architecting the UI.
  Rationale: Reduces regression risk while preserving already working flows.
  Date/Author: 2026-01-24 / Codex

## Outcomes & Retrospective

Pending implementation.

## Context and Orientation

The iOS app lives in `PorizoApp/PorizoApp`. Networking is handled by `APIClient.swift`, auth by `AuthManager.swift`, and playback by `AudioPlayerService.swift` and `TrackPlayerView.swift`. The specs document is `specs/personalized-song-platform-spec.md`.

## Plan of Work

Phase 1: Authentication and gating

Update `RootView.swift` and protected tab entry points so that unauthenticated users are always routed to the login flow. Ensure errors classified as `notAuthenticated` trigger logout + UI redirect, not just an error banner.

Phase 2: Playback professionalism

Extend `AudioPlayerService.swift` to publish Now Playing metadata via `MPNowPlayingInfoCenter` and hook `MPRemoteCommandCenter` for play/pause/seek. Configure `AVAudioSession` for background playback and handle interruptions/route changes. Update `TrackPlayerView.swift` to reflect remote playback state changes and error fallback UI.

Phase 3: Network resilience and caching

Introduce a lightweight persistence layer (e.g., `LocalCache.swift`) to store songs/poems lists and last known entitlements. Use stale‑while‑revalidate: render cached data immediately, then refresh in the background. Add exponential backoff for idempotent list fetches and surface distinct auth vs. network errors.

Phase 4: In‑flight creation persistence

Persist story/poem creation state and last server response in local storage. On app launch, call `refreshSessionFromServer()` and resume the last active flow. Add a “Resume Creation” entry if a pending session exists.

Phase 5: Observability & analytics

Add event logging hooks to key screens (auth, story flow, render start/finish, playback errors) and wire to a crash/reporting backend (Sentry or Firebase). Ensure no PII is logged.

Phase 6: Accessibility and UX polish

Audit text styles for Dynamic Type compliance, add VoiceOver labels/traits to interactive components, ensure contrast compliance in `DesignTokens.swift`, and add haptics for key actions.

Phase 7: QA and release readiness

Add smoke tests for login, create song, and playback. Define a release checklist and wire tests into CI. Add a manual QA checklist that includes background playback and resume after force‑quit.

## Concrete Steps

Run these from `/Users/ao/Documents/projects/porizo` as each phase begins. Update this section as you complete phases.

1) Auth gating and error redirect
   - Edit `PorizoApp/PorizoApp/Services/ErrorHandler.swift` to trigger logout + route to auth on `notAuthenticated`.
   - Ensure all tabs call a shared guard for authenticated access.

2) Playback professionalism
   - Add `MediaSessionManager.swift` for `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`.
   - Integrate with `AudioPlayerService.swift` to update metadata and respond to remote commands.

3) Caching and offline‑first
   - Add `PorizoApp/PorizoApp/Services/LocalCache.swift` using `FileManager` or `UserDefaults` for lists.
   - Update `MySongsView.swift` and `PoemsTabView.swift` to show cached data immediately.

4) In‑flight persistence
   - Persist active story session IDs in `@AppStorage` or local cache.
   - Update `V2StoryEngine.swift` to reload session on startup.

5) Analytics/crash reporting
   - Add `AnalyticsService.swift` abstraction and wire to chosen provider.

6) Accessibility
   - Audit views for `.accessibilityLabel`, `.accessibilityHint`, Dynamic Type, and color contrast.

7) QA
   - Add unit tests and UI tests for critical flows.

## Validation and Acceptance

- Opening the app while logged out always shows the login flow.
- After logging in, songs and poems load without stale auth errors.
- Playback continues in background and shows lock‑screen controls and metadata.
- Song/poem lists appear instantly from cache and refresh in the background.
- A user who force‑quits during story creation can resume the same flow.
- Crash reporting is active and events appear in the analytics provider.

## Idempotence and Recovery

Each phase can be rolled back by reverting the specific files listed in the phase. Persisted caches should be safe to clear without breaking the app.

## Artifacts and Notes

Build evidence:
  - `xcodebuildmcp build_sim` succeeded after Phase 2–4 changes (warnings remain in unrelated files).
Validation note:
  - Simulator launched to the login screen; full validation of cached lists and resume flow requires test credentials.

## Interfaces and Dependencies

- `AudioPlayerService` must expose current track metadata updates for the Now Playing system.
- `MediaSessionManager` must connect to `MPRemoteCommandCenter` and relay controls to `AudioPlayerService`.
- `LocalCache` must provide `loadSongs()`, `saveSongs()`, `loadPoems()`, `savePoems()`.
- `AnalyticsService` must expose a neutral API so providers can be swapped.
