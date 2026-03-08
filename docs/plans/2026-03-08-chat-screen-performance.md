# Chat Screen Performance: State Isolation Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate chat screen freezing by isolating hot-path state into dedicated sub-views, preventing broad parent reevaluation on every keystroke and timer tick.

**Architecture:** SwiftUI `@Observable` tracks property-level reads. When a parent view's `body` reads 13+ engine properties AND local `@State` (inputText, timers), any change to any of them triggers broad parent reevaluation including LazyVStack diffing. The fix is classical state isolation: move hot-path state into small sub-views whose bodies read only what they need.

**Tech Stack:** SwiftUI, `@Observable`, `@FocusState`, `safeAreaInset`

**Root Cause (verified by line-by-line code read + 2 rounds of external critic review):**

| Bug | Location | Impact | Frequency |
|-----|----------|--------|-----------|
| `inputText` in parent body | `AdaptiveConversationView.swift:30,37-68,226,395,440` | Every keystroke re-evaluates entire body including ForEach | ~10Hz while typing |
| `loadingAnimationPhase` + `elapsedSeconds` timers | Lines 549-598 | 1Hz + 3.3Hz re-evaluations during loading | Always during AI response |
| O(n^2) `shouldShowStoryCard` | Lines 705-728 | `prefix(index+1).filter().count` per message per render | Every body evaluation |
| No `scrollDismissesKeyboard` | Line 182 (ScrollView) | Keyboard stays up, input fights scroll gestures | Every interaction |

---

### Task 1: Extract InputBarView (hottest path)

**Files:**
- Create: `PorizoApp/PorizoApp/V2Story/Views/InputBarView.swift`
- Modify: `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift:30,37-68,384-479,600-700`

**Why first:** `inputText` is the hottest state — every keystroke triggers broad parent reevaluation because the parent body reads `inputText` via `inputCharacterCount` (line 38), `inputBudgetState` (line 41), `canSendInput` (line 63), `inputBudgetHint` (line 49), `inputBudgetColor` (line 684), suggestion chip visibility (line 226), and the TextField binding (line 395). Moving `inputText` to a child view means keystrokes only re-evaluate the input bar — the chat message list is untouched.

**Step 1: Create InputBarView with all input-related state**

Create `PorizoApp/PorizoApp/V2Story/Views/InputBarView.swift`:

```swift
import SwiftUI

struct InputBarView: View {
    var engine: V2StoryEngine
    var onSubmit: (String) -> Void
    var onSpeechInput: () -> Void
    var onFinishEarly: () -> Void
    var onExitReviewEdit: () -> Void

    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool

    private var inputCharacterCount: Int { inputText.count }

    private var inputBudgetState: BudgetState {
        StoryPromptBudget.state(
            count: inputCharacterCount,
            warningThreshold: StoryPromptBudget.storyAnswerWarningThreshold,
            hardLimit: StoryPromptBudget.storyAnswerHardLimit
        )
    }

    private var canSendInput: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !engine.isLoading
            && !engine.isComplete
            && inputCharacterCount <= StoryPromptBudget.storyAnswerHardLimit
    }

    private var inputBudgetHint: String {
        if engine.isEditingFromReview {
            return "Be explicit about what changed, what was wrong, or what you want added."
        }
        switch inputBudgetState {
        case .normal:
            return "Keep responses concise for best results."
        case .warning:
            return "Long response detected. We condense for reasoning while preserving key details."
        case .over:
            return "Please shorten this response before sending."
        }
    }

    private var inputBudgetColor: Color {
        switch inputBudgetState {
        case .normal: return DesignTokens.textSecondary
        case .warning: return DesignTokens.gold
        case .over: return DesignTokens.error
        }
    }

    private var inputPlaceholder: String {
        engine.isEditingFromReview
            ? "Tell me what to change or add..."
            : "Share your thoughts..."
    }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)

            VStack(spacing: 12) {
                // Text input row
                HStack(spacing: 12) {
                    TextField(inputPlaceholder, text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.gold)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(DesignTokens.inputBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .strokeBorder(DesignTokens.borderSubtle, lineWidth: 1)
                        )
                        .focused($isInputFocused)
                        .lineLimit(1...4)

                    // Microphone button
                    if !engine.isLoading {
                        Button {
                            onSpeechInput()
                        } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 20))
                                .foregroundColor(DesignTokens.gold)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }

                    // Send button
                    Button {
                        submitAnswer()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(canSendInput ? DesignTokens.gold : DesignTokens.borderSubtle)
                    }
                    .disabled(!canSendInput)
                }

                HStack(spacing: 8) {
                    Text(inputBudgetHint)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundColor(inputBudgetColor)
                    Spacer()
                    Text("\(inputCharacterCount)/\(StoryPromptBudget.storyAnswerHardLimit)")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundColor(inputBudgetColor)
                }

                // "I'm done sharing" / "Return to review"
                if engine.currentTurn >= 2 {
                    Button {
                        if engine.isEditingFromReview {
                            onExitReviewEdit()
                        } else {
                            onFinishEarly()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: engine.isEditingFromReview
                                  ? "arrow.uturn.left.circle.fill"
                                  : "checkmark.circle.fill")
                                .font(.system(size: 18, weight: .semibold))
                            Text(engine.isEditingFromReview
                                 ? "Return to review"
                                 : "I'm done sharing")
                                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        }
                        .foregroundColor(DesignTokens.gold)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 16)
                        .background(DesignTokens.gold.opacity(0.12))
                        .cornerRadius(20)
                    }
                    .disabled(engine.isLoading)
                    .opacity(engine.isLoading ? 0.4 : 1.0)
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(DesignTokens.surface)
        }
    }

    // MARK: - Internal

    private func submitAnswer() {
        guard !inputText.isEmpty, !engine.isLoading else { return }

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        let trimmedInput = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty else { return }

        if trimmedInput.count > StoryPromptBudget.storyAnswerHardLimit {
            ToastService.shared.warning("Response is too long. Please trim it before sending.")
            return
        }

        let answer = trimmedInput
        inputText = ""
        isInputFocused = false
        onSubmit(answer)
    }

    // Called from parent when speech transcription arrives
    func applySpeechTranscription(_ text: String) {
        inputText = text
        isInputFocused = true
        if text.count > StoryPromptBudget.storyAnswerHardLimit {
            ToastService.shared.warning("Voice response is very long. Please trim before sending.")
        } else if text.count >= StoryPromptBudget.storyAnswerWarningThreshold {
            ToastService.shared.info("Voice response is long. We condense for reasoning while preserving key details.")
        }
    }

    /// Whether input is empty — used by parent to show/hide suggestion chips
    var isInputEmpty: Bool { inputText.isEmpty }
}
```

**Step 2: Update AdaptiveConversationView to use InputBarView**

In `AdaptiveConversationView.swift`:

1. Remove from parent:
   - `@State private var inputText` (line 30)
   - `@FocusState private var isInputFocused` (line 35)
   - `inputCharacterCount` computed property (lines 37-39)
   - `inputBudgetState` computed property (lines 41-47)
   - `inputBudgetHint` computed property (lines 49-61)
   - `canSendInput` computed property (lines 63-68)
   - `inputBar` computed property (lines 386-479)
   - `submitAnswer()` function (lines 602-641)
   - `applySpeechTranscription()` function (lines 675-682)
   - `inputBudgetColor` computed property (lines 684-693)
   - `inputPlaceholder` computed property (lines 695-700)

2. Add `@State private var inputBarView = InputBarView(...)` — actually, since InputBarView needs engine, use inline:

3. Replace `inputBar` in body (line 92) with:
   ```swift
   InputBarView(
       engine: engine,
       onSubmit: { answer in
           if selectedTab != .chat { selectedTab = .chat }
           Task {
               do {
                   try await engine.submitAnswer(answer)
                   if let message = engine.error?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
                       ToastService.shared.error(message)
                   }
               } catch {
                   if let message = engine.error?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
                       ToastService.shared.error(message)
                   } else {
                       ToastService.shared.error(error.localizedDescription)
                   }
               }
           }
       },
       onSpeechInput: { showSpeechInput = true },
       onFinishEarly: { showFinishConfirmation = true },
       onExitReviewEdit: { engine.exitReviewEditMode() }
   )
   ```

4. For suggestion chips visibility (line 226), the parent currently reads `inputText.isEmpty`. After extraction, either:
   - (a) Remove the `inputText.isEmpty` guard from suggestion chips — they'll always show when available, which is fine UX (WhatsApp shows quick replies regardless of input state).
   - (b) OR pass a binding/callback. Option (a) is simpler and better UX.

5. Update `handleSuggestionTap` (lines 643-673): Remove `inputText = ""` and `isInputFocused = false` since those are now in InputBarView. The suggestion tap should just call `engine.submitAnswer(suggestion)` directly.

6. Update speech transcription in `.fullScreenCover` (lines 130-143): Need a way to call `applySpeechTranscription` on InputBarView. Use a `@State` variable:
   ```swift
   @State private var pendingSpeechText: String?
   ```
   And pass to InputBarView. Or simpler: just set `inputText` via a binding. Actually, the cleanest approach is to have the speech view submit directly.

**Step 3: Build and verify**

Run:
```bash
cd PorizoApp && xcodebuild -project PorizoApp.xcodeproj -scheme PorizoApp \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add PorizoApp/PorizoApp/V2Story/Views/InputBarView.swift \
       PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift
git commit -m "perf: isolate inputText into InputBarView to prevent full-body re-evaluation on keystroke

Co-authored by Ambrose Obimma"
```

---

### Task 2: Isolate Loading Animation into LoadingBubble

**Files:**
- Modify: `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift:503-598`

**Why:** `loadingAnimationPhase` updates every 300ms and `elapsedSeconds` updates every 1000ms. Both are `@State` in the parent, so each tick re-evaluates the entire body. Moving them into a dedicated sub-view limits re-evaluation to just the 3-dot animation and elapsed text.

**Step 1: Extract LoadingBubble as a standalone struct**

In `AdaptiveConversationView.swift`, replace the `loadingIndicator` computed property and all timer state (lines 503-598) with a new struct defined in the same file (or a new file):

```swift
private struct LoadingBubble: View {
    let isLoading: Bool

    @State private var animationPhase: Int = 0
    @State private var elapsedSeconds: Int = 0
    @State private var animationTask: Task<Void, Never>?
    @State private var elapsedTask: Task<Void, Never>?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.gold)
                    Text("Thinking...")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                }

                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 8, height: 8)
                            .scaleEffect(dotScale(for: index))
                    }
                }

                Text(elapsedTimeText)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(DesignTokens.gold.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Spacer()
        }
        .padding(.horizontal, 16)
        .onAppear { startTimers() }
        .onDisappear { cancelTimers() }
    }

    private var elapsedTimeText: String {
        if elapsedSeconds < 5 { return "Starting..." }
        else if elapsedSeconds < 20 { return "Crafting your story... \(elapsedSeconds)s" }
        else if elapsedSeconds < 45 { return "Weaving details... \(elapsedSeconds)s" }
        else { return "Almost there... \(elapsedSeconds)s" }
    }

    private func dotScale(for index: Int) -> CGFloat {
        let phase = (animationPhase + index) % 3
        switch phase {
        case 0: return 1.0
        case 1: return 0.7
        default: return 0.5
        }
    }

    private func startTimers() {
        animationTask?.cancel()
        animationTask = Task { @MainActor in
            while isLoading {
                try? await Task.sleep(for: .milliseconds(300))
                guard isLoading else { break }
                withAnimation(.easeInOut(duration: 0.2)) {
                    animationPhase += 1
                }
            }
        }

        elapsedSeconds = 0
        elapsedTask?.cancel()
        elapsedTask = Task { @MainActor in
            while isLoading {
                try? await Task.sleep(for: .seconds(1))
                guard isLoading else { break }
                elapsedSeconds += 1
            }
        }
    }

    private func cancelTimers() {
        animationTask?.cancel()
        elapsedTask?.cancel()
    }
}
```

**Step 2: Replace usage in chatScrollView**

Replace `loadingIndicator` reference (line 243) with:
```swift
LoadingBubble(isLoading: engine.isLoading)
```

**Step 3: Remove old state and functions from parent**

Remove from AdaptiveConversationView:
- `@State private var loadingAnimationPhase` (line 549)
- `@State private var loadingTask` (line 550)
- `@State private var elapsedSeconds` (line 551)
- `@State private var elapsedTask` (line 552)
- `elapsedTimeText` computed property (lines 554-564)
- `loadingDotScale` function (lines 566-573)
- `startLoadingAnimation` function (lines 575-586)
- `startElapsedTimer` function (lines 588-598)
- `loadingIndicator` computed property (lines 503-547)

**Step 4: Build and verify**

```bash
cd PorizoApp && xcodebuild -project PorizoApp.xcodeproj -scheme PorizoApp \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift
git commit -m "perf: isolate loading animation timers into LoadingBubble sub-view

Co-authored by Ambrose Obimma"
```

---

### Task 3: Precompute Story Card Positions

**Files:**
- Modify: `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift:194,705-728`

**Why:** `shouldShowStoryCard(at:)` runs `prefix(index+1).filter().count` for every message on every body evaluation. With 20 messages, that's O(n^2) filter operations. Precomputing a `Set<Int>` once when `messages.count` changes makes each check O(1).

**Step 1: Add precomputed set**

Add to AdaptiveConversationView:
```swift
@State private var storyCardIndices: Set<Int> = []
```

Add an `.onChange` handler or compute it from a helper:
```swift
.onChange(of: engine.messages.count) { _, _ in
    storyCardIndices = computeStoryCardIndices()
}
.onAppear {
    storyCardIndices = computeStoryCardIndices()
}
```

**Step 2: Implement precompute function**

```swift
private func computeStoryCardIndices() -> Set<Int> {
    var indices = Set<Int>()
    var aiCount = 0
    for (index, message) in engine.messages.enumerated() {
        guard message.role == .ai else { continue }
        aiCount += 1
        if message.action == .confirm {
            indices.insert(index)
        } else if aiCount > 0 && aiCount % 3 == 0 {
            indices.insert(index)
        }
    }
    return indices
}
```

**Step 3: Replace shouldShowStoryCard call**

Replace `if shouldShowStoryCard(at: index)` (line 194) with:
```swift
if storyCardIndices.contains(index)
```

Remove `shouldShowStoryCard(at:)` function (lines 705-728).

**Step 4: Build and verify**

```bash
cd PorizoApp && xcodebuild -project PorizoApp.xcodeproj -scheme PorizoApp \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

**Step 5: Commit**

```bash
git add PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift
git commit -m "perf: precompute story card positions O(n) instead of O(n^2) per render

Co-authored by Ambrose Obimma"
```

---

### Task 4: Add scrollDismissesKeyboard

**Files:**
- Modify: `PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift:182`

**Why:** Without `.scrollDismissesKeyboard(.interactively)`, the keyboard stays up when scrolling, fighting scroll gestures and making the UI feel unresponsive. WhatsApp dismisses keyboard on scroll.

**Step 1: Add modifier to ScrollView**

After `ScrollView {` (line 182), add the modifier:
```swift
ScrollView {
    // ... existing content
}
.scrollDismissesKeyboard(.interactively)
```

**Step 2: Build and verify**

```bash
cd PorizoApp && xcodebuild -project PorizoApp.xcodeproj -scheme PorizoApp \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add PorizoApp/PorizoApp/V2Story/Views/AdaptiveConversationView.swift
git commit -m "ux: dismiss keyboard interactively on scroll for WhatsApp-like chat feel

Co-authored by Ambrose Obimma"
```

---

## Verification

After all 4 tasks:

```bash
# Full iOS build
cd PorizoApp && xcodebuild -project PorizoApp.xcodeproj -scheme PorizoApp \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build

# Install on device for manual testing
# Use XcodeBuildMCP tools

# Manual test checklist:
# [ ] Type rapidly in input — chat messages should NOT flicker or re-render
# [ ] During AI "Thinking..." — dots animate but message list stays still
# [ ] Scroll up during loading — no freeze, no stutter
# [ ] Tap suggestion chip — submits immediately, no freeze
# [ ] With 15+ messages — scroll performance stays smooth
# [ ] Keyboard dismisses when scrolling chat up
# [ ] Speech input still works (transcription appears in input)
# [ ] "I'm done sharing" button still works
# [ ] Story card appears at correct intervals (every 3rd AI message)
# [ ] Tab switching (Chat/Story) remains smooth
```

## Design Decisions

1. **InputBarView as struct, not ObservableObject** — Keeps it simple. SwiftUI already tracks `@State` per-instance. No need for a separate observable.

2. **Suggestion chips always visible** — Removing the `inputText.isEmpty` guard is simpler and arguably better UX. WhatsApp shows quick replies regardless of input field state. If user types something, they'll send that instead.

3. **LoadingBubble takes `isLoading: Bool`** — Single property read. SwiftUI evaluates LoadingBubble's body only when `isLoading` changes, not on every parent re-evaluation. The timers inside are `@State` scoped to LoadingBubble.

4. **Precompute via `.onChange` not computed property** — A computed property would still run on every body evaluation. `.onChange(of: messages.count)` runs only when messages actually change.

5. **No `safeAreaInset` yet** — The current `VStack` layout works. `safeAreaInset` is a deeper layout change that risks breaking the existing design. Save for a future iteration if keyboard UX still feels wrong after `.scrollDismissesKeyboard`.

## Files Modified (Summary)

| File | Change | LOC |
|------|--------|-----|
| `InputBarView.swift` (NEW) | All input-related state + UI | ~160 |
| `AdaptiveConversationView.swift` | Remove input/timer state, add LoadingBubble, precompute indices, scrollDismissesKeyboard | ~-180, +40 |
| **Net** | | **~20 lines added** (code moves, not grows) |
