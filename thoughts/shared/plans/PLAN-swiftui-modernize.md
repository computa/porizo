# PLAN: SwiftUI Best-Practice Modernization

**Mode:** refactor
**Session:** build-20260309-swiftui-modernize
**Source:** swiftui-pro review + parallel research agents
**Scope:** Story flow files + app-wide @Observable migration

---

## Phase 0: @Observable Migration (App-Wide)

Convert `APIClientWrapper` from `ObservableObject` to `@Observable`. All mechanical — no behavioral change (the wrapper's `objectWillChange` publisher never fires today).

**Deployment target:** iOS 17.0 (confirmed) — @Observable is supported.
**$binding usage:** None found — zero complications.

### Task 0.1: Convert APIClientWrapper class

**File:** `Services/APIClientWrapper.swift`

```swift
// BEFORE
import Combine
final class APIClientWrapper: ObservableObject {
    let objectWillChange = ObservableObjectPublisher()
    ...
}

// AFTER
@Observable
final class APIClientWrapper {
    // Remove objectWillChange, remove Combine import
    ...
}
```

Also remove the dead `EnvironmentKey` / `EnvironmentValues` extension (lines 59-74) — never consumed anywhere.

### Task 0.2: Update all consumers (16 files, ~30 sites)

**Property declarations (7 files):**

| File | Line | Before | After |
|------|------|--------|-------|
| `PhoneVerificationView.swift` | 25 | `@EnvironmentObject var apiClient: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiClient` |
| `PoemShareView.swift` | 14 | `@EnvironmentObject var apiWrapper: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiWrapper` |
| `VoiceEnrollmentView.swift` | 16 | `@EnvironmentObject var apiWrapper: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiWrapper` |
| `SpeechInputView.swift` | 39 | `@EnvironmentObject var apiWrapper: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiWrapper` |
| `PhoneAuthView.swift` | 46 | `@EnvironmentObject var apiClient: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiClient` |
| `UsernameView.swift` | 29 | `@EnvironmentObject var apiClient: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiClient` |
| `PoemActionMenu.swift` | 19 | `@EnvironmentObject var apiWrapper: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiWrapper` |
| `AuthView.swift` | 19 | `@EnvironmentObject var apiClient: APIClientWrapper` | `@Environment(APIClientWrapper.self) var apiClient` |

**Injection sites (~22 sites across 6 files):**

| File | Pattern |
|------|---------|
| `RootView.swift` | `.environmentObject(wrapper)` → `.environment(wrapper)` (2 sites) |
| `SettingsTabView.swift` | `.environmentObject(wrapper)` → `.environment(wrapper)` (1 site) |
| `Tabs/PoemsTabView.swift` | `.environmentObject(wrapper)` → `.environment(wrapper)` (2 sites) |
| `V1Screens/V1ScreenCatalogView.swift` | `.environmentObject(wrapper)` → `.environment(wrapper)` (10 sites) |
| `Flows/PoemPreviewView.swift` | `.environmentObject(wrapper)` → `.environment(wrapper)` (1 site) |
| `Flows/CreateFlowView.swift` | `@StateObject` → `@State` + `.environmentObject` → `.environment` (4 sites) |
| `Flows/CreateFlowContentViews.swift` | `.environmentObject(wrapper)` → `.environment(wrapper)` (1 site) |

**Preview providers:** Update any `#Preview` blocks that inject `.environmentObject(APIClientWrapper(...))` to use `.environment(APIClientWrapper(...))`.

### Task 0.3: CreateFlowView @StateObject → @State

**File:** `Flows/CreateFlowView.swift`

```swift
// BEFORE (lines 43, 88)
@StateObject private var apiWrapper: APIClientWrapper
_apiWrapper = StateObject(wrappedValue: APIClientWrapper(client: apiClient))

// AFTER
@State private var apiWrapper: APIClientWrapper
_apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
```

**Verify:** Full project build after Phase 0. Every `@EnvironmentObject` → `@Environment` and `.environmentObject` → `.environment` must be caught.

---

## Phase 1: Deprecated API Modernization (Story Flow Files)

All mechanical find-and-replace. No behavioral changes.

### Task 1.1: `foregroundColor()` → `foregroundStyle()`

**Files (10):**
- `Flows/CreateFlowSetupViews.swift`
- `Flows/CreateFlowContentViews.swift`
- `Flows/CreateFlowView.swift`
- `V2Story/Views/StoryConfirmationView.swift` (59 instances)
- `V2Story/Views/AdaptiveConversationView.swift` (19)
- `V2Story/Views/InputBarView.swift` (6)
- `V2Story/Views/ChatMessageBubble.swift` (7)
- `V2Story/Views/ConversationHeader.swift` (5)
- `V2Story/Views/SuggestionChipsView.swift` (2)
- `V2Story/Views/InlineStoryCard.swift` (14)

**Rule:** `.foregroundColor(X)` → `.foregroundStyle(X)`. Preserve color value exactly.

### Task 1.2: `.cornerRadius()` → `.clipShape(.rect(cornerRadius:))`

**Files (3), 8 instances:**
- `Flows/CreateFlowSetupViews.swift` — 6 instances
- `V2Story/Views/StoryConfirmationView.swift` — 1 instance
- `V2Story/Views/InputBarView.swift` — 1 instance

**Rule:** `.cornerRadius(N)` → `.clipShape(.rect(cornerRadius: N))`

### Task 1.3: `.autocapitalization()` → `.textInputAutocapitalization()`

**File:** `Flows/CreateFlowSetupViews.swift` line 154

```swift
// Before
.autocapitalization(.words)
// After
.textInputAutocapitalization(.words)
```

### Task 1.4: `Date()` → `.now`

| File | Line | Context |
|------|------|---------|
| `Flows/SongFlowCoordinator.swift` | 117 | `updatedAt: Date()` → `updatedAt: .now` |
| `Flows/PoemFlowCoordinator.swift` | 71 | `updatedAt: Date()` → `updatedAt: .now` |

### Task 1.5: `replacingOccurrences(of:with:)` → `.replacing(_:with:)`

**File:** `V2Story/Views/StoryConfirmationView.swift`

| Line | Before | After |
|------|--------|-------|
| 970 | `source.replacingOccurrences(of: "_", with: " ")` | `source.replacing("_", with: " ")` |
| 1024 | `engine.draftLifecycle.replacingOccurrences(of: "_", with: " ")` | `engine.draftLifecycle.replacing("_", with: " ")` |

### Task 1.6: `ScrollView(showsIndicators: false)` → `.scrollIndicators(.hidden)`

**File:** `Flows/CreateFlowSetupViews.swift`

| Line | Before | After |
|------|--------|-------|
| 130 | `ScrollView(showsIndicators: false) {` | `ScrollView {` + `.scrollIndicators(.hidden)` after closing brace |
| 182 | `ScrollView(.horizontal, showsIndicators: false) {` | `ScrollView(.horizontal) {` + `.scrollIndicators(.hidden)` after closing brace |

**Verify:** Project builds after Phase 1.

---

## Phase 2: Accessibility — Icon-Only Button Labels

6 buttons across 4 files need VoiceOver labels. Using `.accessibilityLabel()` (Option B) since all buttons have complex styled content.

| # | File | Lines | SF Symbol | Label |
|---|------|-------|-----------|-------|
| 1 | `Flows/CreateFlowSetupViews.swift` | 31-38 | `xmark` | `"Close"` |
| 2 | `Flows/CreateFlowSetupViews.swift` | 117-124 | `xmark` | `"Back"` |
| 3 | `V2Story/Views/AdaptiveConversationView.swift` | 79-91 | `xmark` | `"Close"` |
| 4 | `V2Story/Views/StoryConfirmationView.swift` | 58-70 | `xmark` | `"Close"` |
| 5 | `V2Story/Views/InputBarView.swift` | 93-102 | `mic.fill` | `"Voice input"` |
| 6 | `V2Story/Views/InputBarView.swift` | 105-112 | `arrow.up.circle.fill` | `"Send"` |

**Verify:** Project builds after Phase 2.

---

## Phase 3: Error Handling — Surface Swallowed Errors

### Task 3.1: SongFlowCoordinator.applyVoiceSelection() (lines 137-147)

Currently catches and prints but returns success state regardless. The caller (`CreateFlowView`) has `presentError(_:)` available.

**Fix:** Make `applyVoiceSelection` return an optional error message. Caller calls `presentError` if non-nil.

```swift
// BEFORE
func applyVoiceSelection(using asyncService: CreateFlowAsyncService) async -> CreateFlowState {
    if let trackId = currentTrackId {
        do {
            try await asyncService.updateVoiceMode(trackId: trackId, mode: voiceMode)
            print("[CreateFlowView] Updated track voice_mode to \(voiceMode.rawValue)")
        } catch {
            print("[CreateFlowView] Failed to update voice_mode: \(error.localizedDescription)")
        }
    }
    return voiceSelectionCompleteState()
}

// AFTER
func applyVoiceSelection(using asyncService: CreateFlowAsyncService) async -> (state: CreateFlowState, error: String?) {
    if let trackId = currentTrackId {
        do {
            try await asyncService.updateVoiceMode(trackId: trackId, mode: voiceMode)
        } catch {
            return (voiceSelectionCompleteState(), "Voice selection failed: \(error.localizedDescription)")
        }
    }
    return (voiceSelectionCompleteState(), nil)
}
```

Update call site in `CreateFlowView` (~line 218):
```swift
let result = await songFlow.applyVoiceSelection(using: asyncService)
await MainActor.run {
    flowState = result.state
    if let errorMsg = result.error { presentError(errorMsg) }
}
```

### Task 3.2: CreateFlowResumeCoordinator.refreshRestoredStorySession() (lines 68-81)

Currently returns `nil` on failure — caller silently keeps stale data.

**Fix:** Return failure with toast notification for stale data.

```swift
// In the caller (CreateFlowView, ~line 627):
// BEFORE
if let refreshed = await resumeCoordinator.refreshRestoredStorySession(...) {
    setup = refreshed.setup
    songFlow.restoreSessionPrompt(refreshed.restoredPrompt)
}

// AFTER
if let refreshed = await resumeCoordinator.refreshRestoredStorySession(...) {
    setup = refreshed.setup
    songFlow.restoreSessionPrompt(refreshed.restoredPrompt)
} else {
    ToastService.shared.show("Using cached session — refresh failed", style: .warning)
}
```

**Verify:** Project builds. Test both error paths manually.

---

## Phase 4: Debug Print Cleanup

Wrap all bare `print()` in `#if DEBUG`. Exception: prints inside catch blocks fixed in Phase 3 are removed entirely (replaced by error surfacing).

| # | File | Line | Content |
|---|------|------|---------|
| 1 | `Flows/CreateFlowView.swift` | 133 | Flow state change log |
| 2 | `Flows/CreateFlowView.swift` | 282 | Lyrics approved transition log |
| 3 | `Flows/CreateFlowContentViews.swift` | 113 | TrackPlayer render log (fires per render!) |
| 4 | `Flows/SongFlowCoordinator.swift` | 141 | Voice mode success (removed in Phase 3) |
| 5 | `Flows/SongFlowCoordinator.swift` | 143 | Voice mode failure (removed in Phase 3) |
| 6 | `Flows/CreateFlowResumeCoordinator.swift` | 78 | Session refresh failure (removed in Phase 3) |

**Net:** Items 4-6 are handled by Phase 3. Items 1-3 get `#if DEBUG` wrappers.

**Verify:** Project builds after Phase 4.

---

## DROPPED: Haptics Migration

Research confirmed all 3 `UIImpactFeedbackGenerator` usages are in imperative tap-action closures, not state-driven. `.sensoryFeedback()` requires a state change trigger — forcing one would introduce fragile toggle patterns. **No change needed.**

## SKIPPED: ForEach(Array(enumerated))

`Array()` wrapper is required — `EnumeratedSequence` doesn't conform to `RandomAccessCollection`.

---

## Execution Order

```
Phase 0 (@Observable migration)  → build check
Phase 1 (Deprecated API fixes)   → build check
Phase 2 (Accessibility labels)   → build check
Phase 3 (Error surfacing)        → build check
Phase 4 (Debug print cleanup)    → build check
```

## Acceptance Criteria

- [ ] `APIClientWrapper` uses `@Observable` macro, not `ObservableObject`
- [ ] Zero `@EnvironmentObject` referencing `APIClientWrapper` in codebase
- [ ] Zero `foregroundColor()` in story flow files
- [ ] Zero `.cornerRadius()` in story flow files
- [ ] Zero `.autocapitalization()` in story flow files
- [ ] All 6 icon-only buttons have `.accessibilityLabel()`
- [ ] `applyVoiceSelection` error surfaces via `presentError`
- [ ] `refreshRestoredStorySession` failure shows toast
- [ ] No bare `print()` outside `#if DEBUG` in story flow files
- [ ] Project builds with zero errors

## Files Touched (Total: ~25)

**Phase 0 (16 files):** APIClientWrapper.swift, PhoneVerificationView.swift, PoemShareView.swift, VoiceEnrollmentView.swift, SpeechInputView.swift, PhoneAuthView.swift, UsernameView.swift, PoemActionMenu.swift, AuthView.swift, RootView.swift, SettingsTabView.swift, PoemsTabView.swift, V1ScreenCatalogView.swift, PoemPreviewView.swift, CreateFlowView.swift, CreateFlowContentViews.swift

**Phase 1 (12 files):** CreateFlowSetupViews.swift, CreateFlowContentViews.swift, CreateFlowView.swift, StoryConfirmationView.swift, AdaptiveConversationView.swift, InputBarView.swift, ChatMessageBubble.swift, ConversationHeader.swift, SuggestionChipsView.swift, InlineStoryCard.swift, SongFlowCoordinator.swift, PoemFlowCoordinator.swift

**Phase 2 (4 files):** CreateFlowSetupViews.swift, AdaptiveConversationView.swift, StoryConfirmationView.swift, InputBarView.swift

**Phase 3 (3 files):** SongFlowCoordinator.swift, CreateFlowResumeCoordinator.swift, CreateFlowView.swift

**Phase 4 (3 files):** CreateFlowView.swift, CreateFlowContentViews.swift, SongFlowCoordinator.swift
