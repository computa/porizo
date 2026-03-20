# SwiftUI Quality & Delight Improvement Plan

**Goal:** Maximum quality and user delight without any new features.
**Scope:** ~90 Swift source files in PorizoApp/PorizoApp/
**Methodology:** SwiftUI Pro 9-point checklist (api, views, data, navigation, design, accessibility, performance, swift, hygiene)

---

## OKR 1: Modern SwiftUI API Compliance

**Objective:** Eliminate every deprecated/legacy API call so the codebase compiles clean against iOS 26 standards.

### KR 1.1 — Replace all `foregroundColor()` with `foregroundStyle()` (est. ~200+ call sites)
- [ ] DesignTokens.swift (free function return types stay — callers update)
- [ ] MainTabView.swift
- [ ] LandingView.swift
- [ ] SplashView.swift
- [ ] ExploreTabView.swift
- [ ] SongsTabView.swift
- [ ] PoemsTabView.swift
- [ ] SettingsTabView.swift
- [ ] MySongsView.swift + SongCard
- [ ] PlayerComponents.swift (MiniPlayerBar, NowPlayingView)
- [ ] OnboardingView.swift
- [ ] AuthView.swift
- [ ] VoiceEnrollmentView.swift
- [ ] PoemFullView.swift
- [ ] All Components/*.swift
- [ ] All Flows/*.swift
- [ ] All V2Story/Views/*.swift
- [ ] All remaining views

### KR 1.2 — Replace all `cornerRadius()` with `clipShape(.rect(cornerRadius:))` (est. ~80+ call sites)
- [ ] ExploreTabView.swift (featureBanner, featuredCard, quickCreate, giftSend, occasionChip)
- [ ] MySongsView.swift SongCard (statusBadge, card corners)
- [ ] LandingView.swift (CTA button)
- [ ] All Components/*.swift
- [ ] All Flows/*.swift
- [ ] All remaining views
- [ ] Note: `overlay(RoundedRectangle)` strokes stay — only the deprecated modifier changes

### KR 1.3 — Replace all `UIImpactFeedbackGenerator` with `.sensoryFeedback()` modifier (est. ~15+ call sites)
- [ ] ExploreTabView.swift (quickCreateSection, giftSendSection, occasionChip)
- [ ] PlayerComponents.swift (MiniPlayerBar play/close, NowPlayingView play)
- [ ] MySongsView.swift (error retry)
- [ ] All other haptic sites across Flows/ and Components/

### KR 1.4 — Replace `showsIndicators: false` with `.scrollIndicators(.hidden)` (est. ~5+ sites)
- [ ] ExploreTabView.swift occasionsSection
- [ ] All other horizontal ScrollViews

### KR 1.5 — Fix deprecated Text concatenation with `+`
- [ ] LandingView.swift lines 65-68 (sign-in link) — use Text interpolation pattern

### KR 1.6 — Replace `.navigationBarLeading`/`.navigationBarTrailing` with `.topBarLeading`/`.topBarTrailing`
- [ ] Audit all toolbar placements

---

## OKR 2: Accessibility Excellence

**Objective:** Every user can operate the app comfortably regardless of vision, motor, or hearing ability.

### KR 2.1 — Dynamic Type support across the entire app (CRITICAL — currently zero support)
- [ ] Audit all `.system(size:)` and `.custom(size:)` calls — wrap with `@ScaledMetric` or use semantic text styles (`.body`, `.headline`, etc.)
- [ ] DesignTokens.swift: Add `@ScaledMetric`-backed versions of `bodyFont()` and `displayFont()`, OR migrate callers to semantic styles
- [ ] Ensure no fixed-size frames clip text at larger accessibility sizes
- [ ] Test at AX5 (largest accessibility size) — all text must remain readable

### KR 2.2 — VoiceOver audit
- [ ] MiniPlayerBar: `onTapGesture` without `.accessibilityAddTraits(.isButton)` — add trait
- [ ] PlayerComponents: Image-only buttons (xmark, gobackward.15, goforward.15) — verify all have accessibilityLabel
- [ ] ExploreTabView: dismiss banner button (xmark) — add accessibilityLabel("Dismiss banner")
- [ ] All Menu/Button with only Image label — verify text label exists
- [ ] SongCard: Menu with ellipsis image — verify accessible (already has label, confirm)
- [ ] Decorative images — verify `accessibilityHidden(true)` or `Image(decorative:)`

### KR 2.3 — Reduce Motion support
- [ ] SplashView: logo animation should use opacity-only when Reduce Motion enabled
- [ ] MainTabView: tab switch animation should respect Reduce Motion
- [ ] NowPlayingView: drag gesture animation
- [ ] All `withAnimation` calls — check `@Environment(\.accessibilityReduceMotion)`
- [ ] WaveformVisualizer — disable animation when Reduce Motion enabled

### KR 2.4 — Minimum tap target enforcement (44x44pt per Apple HIG)
- [ ] Audit all buttons, especially: MiniPlayerBar close (14pt icon), dismiss banner (16pt icon)
- [ ] Ensure `.frame(minWidth: 44, minHeight: 44)` or equivalent padding on small targets

---

## OKR 3: View Architecture & Performance

**Objective:** Every view is small, focused, and efficient — no computed-property view code, no body bloat, no unnecessary redraws.

### KR 3.1 — Extract computed view properties into dedicated View structs (MAJOR — est. ~60+ extractions)

Priority 1 (largest files):
- [ ] PlayerComponents.swift: Extract `trackInfoSection`, `progressSection`, `controlsSection`, `bottomActionsSection`, `selectedLyricsView`, `editorialLyrics` into separate View files
- [ ] MySongsView.swift: Extract `loadingView`, `errorStateView`, `emptyStateView`, `trackListView`, `libraryFilterPicker`, `receivedEmptyStateView` into separate View files
- [ ] ExploreTabView.swift: Extract `exploreHeader`, `featureBanner`, `featuredCard`, `quickCreateSection`, `giftSendSection`, `occasionsSection`, `recentSongsSection` into separate View files
- [ ] NowPlayingView: Extract `editorialLyrics` computed property (massive)

Priority 2 (medium files):
- [ ] MainTabView.swift: Extract `customTabBar` and `tabButton(for:)` into TabBarView
- [ ] SongsTabView.swift: Extract `songsHeader`
- [ ] RootView.swift: Simplify body by extracting state-specific views

Priority 3 (remaining):
- [ ] All other files with computed view properties

### KR 3.2 — Replace `onAppear` with `task()` for async work
- [ ] ExploreTabView.swift `onAppear { loadRecentTracks() }` → `.task { await loadRecentTracks() }`
- [ ] MySongsView.swift `onAppear { loadTracks() }` → `.task { await loadTracks() }`
- [ ] SplashView.swift `onAppear` — OK (not async), skip
- [ ] RootView.swift splash `onAppear` → `.task { ... }`

### KR 3.3 — Eliminate `GeometryReader` where modern alternatives work
- [ ] PlayerComponents progressSection GeometryReader → evaluate `containerRelativeFrame` or keep if no alternative
- [ ] PlayerComponents editorialLyrics GeometryReader → evaluate alternatives
- [ ] Audit all other GeometryReader usage

### KR 3.4 — Move business logic out of view bodies
- [ ] ExploreTabView: `togglePlayback(for:)` and `loadRecentTracks()` — extract to ViewModel or shared PlaybackService (TODO already exists)
- [ ] MySongsView: `togglePlayback(for:)`, `loadAndPlay`, `loadTracks`, `deleteTrack` — extract to ViewModel
- [ ] Eliminate duplicate playback code between ExploreTabView and MySongsView (noted in existing TODO)

---

## OKR 4: Data Flow Modernization

**Objective:** Migrate from ObservableObject to @Observable, eliminate legacy property wrappers.

### KR 4.1 — Migrate `PlayerState` from `ObservableObject` to `@Observable`
- [ ] Change `class PlayerState: ObservableObject` → `@Observable @MainActor class PlayerState`
- [ ] Remove all `@Published` annotations (auto-tracked)
- [ ] Update all consumers: `@ObservedObject var playerState` → passed as parameter or `@Bindable`
- [ ] MainTabView: `@StateObject private var playerState` → `@State private var playerState`
- [ ] Update all child views receiving PlayerState

### KR 4.2 — Migrate `AuthManager` from `ObservableObject` to `@Observable`
- [ ] Change class declaration → `@Observable @MainActor class AuthManager`
- [ ] Remove `@Published` annotations
- [ ] Remove `import Combine` (only needed for ObservableObject)
- [ ] PorizoAppApp: `@StateObject` → `@State`
- [ ] All `.environmentObject(authManager)` → `.environment(authManager)`
- [ ] All `@EnvironmentObject var authManager` → `@Environment(AuthManager.self)`

### KR 4.3 — Migrate `StoreKitManager` from `ObservableObject` to `@Observable`
- [ ] Change class declaration
- [ ] MainTabView: `@StateObject` → `@State`

### KR 4.4 — Migrate `RenderPollingService` from `ObservableObject` to `@Observable`
- [ ] Change class declaration
- [ ] MySongsView: `@StateObject` → `@State`

### KR 4.5 — Eliminate `Binding(get:set:)` in view bodies
- [ ] MainTabView line 178: Gift flow binding → use `@State` bool + `.onChange`
- [ ] RootView lines 249-270: App update prompt bindings → refactor to use `@State` + `onChange` or dedicated binding property

### KR 4.6 — Migrate `CreateFlowStore` from DispatchQueue to Actor
- [ ] Convert `final class CreateFlowStore` → `actor CreateFlowStore`
- [ ] Replace `DispatchQueue` sync/async with async methods
- [ ] Replace `FileManager.default.urls(for:in:).first!` with `URL.applicationSupportDirectory`
- [ ] Remove force unwrap

---

## OKR 5: Swift Modernization

**Objective:** Use modern Swift idioms everywhere — no GCD, no legacy formatters, no force unwraps.

### KR 5.1 — Replace `Task.sleep(nanoseconds:)` with `Task.sleep(for:)`
- [ ] APIClient.swift line 416
- [ ] AuthManager.swift line 216

### KR 5.2 — Replace `DispatchQueue.main.async` with proper MainActor/async patterns
- [ ] PlayerComponents.swift `startPlaybackTimer` — DispatchQueue.main.async in timer callback
- [ ] CreateFlowStore.swift — all DispatchQueue usage

### KR 5.3 — Replace `Date()` with `Date.now`
- [ ] AuthManager.swift (multiple saveTokens calls)
- [ ] MySongsView.swift (lastFetchTime assignments)
- [ ] All other `Date()` occurrences

### KR 5.4 — Replace `replacingOccurrences(of:)` with `replacing(_:with:)`
- [ ] DesignTokens.swift `formatSectionName()` line 365

### KR 5.5 — Replace `String(format:)` with FormatStyle for user display
- [ ] DesignTokens.swift `formatTime()` — evaluate Text format approach

### KR 5.6 — Eliminate force unwraps
- [ ] CreateFlowStore.swift line 39 (`.first!`)
- [ ] AuthManager.swift URL constructions (`URL(string:)!`) — use guard
- [ ] AppConfig.swift lines 116-117 (termsURL, privacyURL) — use guard or static let with fallback

### KR 5.7 — Remove unnecessary `import UIKit` where `import SwiftUI` is present
- [ ] RootView.swift
- [ ] PlayerComponents.swift (needs UIKit for AVFoundation delegate — evaluate)
- [ ] AuthManager.swift (needs UIKit for isProtectedDataAvailable — keep)

---

## OKR 6: Code Hygiene — One Type Per File

**Objective:** Every struct/class/enum lives in its own file for discoverability and maintainability.

### KR 6.1 — Split multi-type files
- [ ] AuthManager.swift → AuthUser.swift, AuthError.swift, PhoneAuthState.swift, AuthManager.swift
- [ ] PlayerComponents.swift → PlayerState.swift, MiniPlayerBar.swift, NowPlayingView.swift
- [ ] DesignTokens.swift → DesignTokens.swift, Elevation.swift, ElevationModifier.swift (ViewModifiers can stay grouped)
- [ ] MySongsView.swift → MySongsView.swift, SongCard.swift (SongCard is already substantial)
- [ ] AppConfig.swift → AppConfig.swift, OAuthProviderConfig.swift
- [ ] RootView.swift → extract nested structs (ShareContext, ProfileCompletionContext) or keep if small

---

## Implementation Priority (Recommended Order)

### Phase 1: Foundation (no visual changes, zero regression risk)
1. **KR 1.1** foregroundColor → foregroundStyle (mechanical find-replace, zero behavior change)
2. **KR 1.2** cornerRadius → clipShape (mechanical, zero behavior change)
3. **KR 5.1-5.5** Swift modernization (non-visual)
4. **KR 5.6** Force unwrap elimination
5. **KR 1.5** Text concatenation fix

### Phase 2: Architecture (internal restructuring, no visual changes)
6. **KR 6.1** Split multi-type files
7. **KR 3.1** Extract computed view properties (Priority 1 files first)
8. **KR 3.2** onAppear → task()
9. **KR 4.5** Eliminate Binding(get:set:)

### Phase 3: Data Flow (behavioral changes, needs testing)
10. **KR 4.1** PlayerState migration to @Observable
11. **KR 4.2** AuthManager migration to @Observable
12. **KR 4.3-4.4** StoreKitManager + RenderPollingService migration
13. **KR 4.6** CreateFlowStore actor migration
14. **KR 5.2** DispatchQueue elimination

### Phase 4: Accessibility (user-facing improvements)
15. **KR 2.1** Dynamic Type support (HIGHEST user impact)
16. **KR 2.2** VoiceOver audit
17. **KR 2.3** Reduce Motion support
18. **KR 2.4** Tap target enforcement

### Phase 5: Performance & Polish
19. **KR 1.3** sensoryFeedback migration
20. **KR 1.4** scrollIndicators migration
21. **KR 3.3** GeometryReader elimination
22. **KR 3.4** Business logic extraction

---

## Metrics

| Metric | Current | Target |
|--------|---------|--------|
| `foregroundColor()` calls | ~200+ | 0 |
| `cornerRadius()` calls | ~80+ | 0 |
| `UIImpactFeedbackGenerator` calls | ~15+ | 0 |
| `@StateObject/@ObservedObject` usage | ~15+ | 0 |
| `ObservableObject` conformances | 4 | 0 |
| Computed view properties (some View) | ~60+ | 0 |
| Force unwraps in app code | ~10+ | 0 |
| `DispatchQueue` usage | ~8+ | 0 |
| Dynamic Type support | 0% | 100% |
| VoiceOver-invisible buttons | ~5+ | 0 |
| Files with multiple type defs | ~6 | 0 |
