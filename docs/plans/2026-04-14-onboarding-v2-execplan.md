# Onboarding V2 — Implementation Exec Plan

**Date:** 2026-04-14  
**Design Spec:** `docs/plans/2026-04-14-onboarding-v2-design.md`  
**Status:** Ready for implementation  
**Incorporates:** Architect decisions from spec review (5 critical blockers resolved)

---

## Architect Decisions (Resolved Blockers)

These decisions are authoritative and override any earlier draft reasoning.

| # | Decision |
|---|---------|
| 1 | `completeOnboardingV2(name:relationship:occasion:seed:)` writes to existing + new AppStorage keys. Goes directly to `.main`, bypasses `.nameEntry`. Keep `.nameEntry` in enum as dead code. |
| 2 | Deferred-auth: if `pendingRecipientName` non-empty, skip auth gate → `.main`. Auth captures inside creation flow. |
| 3 | "Maybe later": persist as `@AppStorage("pendingSuggestion")` JSON. Show "Continue where you left off" card in main app. |
| 4 | Screen 1 offline fallback: hardcoded local artifact — "For Mom", "Remember when you held my hand...", coral gradient, animated waveform. No server dependency for visual. |
| 5 | Migration: no re-show for existing users. `hasCompletedOnboarding = true` → skip. Remove `onboardingViewCount` re-show logic entirely. |

**Non-blocking decisions:**
- Back nav: allowed on screens 3–8. Graph engine maintains a nav stack with `pop()`.
- Transitions: horizontal slide (push/pop) for screens 3+; crossfade for screens 1→2→3.
- Keyboard: `ScrollView` wrap + `.scrollDismissesKeyboard(.interactively)` on screens 6, 7.
- "Write your own": chip tap collapses other chips, expands `TextField` below.
- Emoji names: allowed. No letter-only restriction.
- Audio session: `.playback` with `.mixWithOthers`.

---

## Build Sequence

Dependencies flow strictly top-to-bottom. No phase may begin until its predecessor is complete.

```
Phase A  QuestionGraphEngine          ← foundation, no iOS dependencies
   ↓
Phase B  Individual screen views      ← parallel, all depend on Phase A types
   ↓
Phase C  OnboardingV2View container   ← depends on all Phase B screens
   ↓
Phase D  Server endpoint + config     ← can run in parallel with A–C (separate team)
   ↓
Phase E  RootView integration         ← depends on Phase C
   ↓
Phase F  Analytics wiring             ← depends on Phase C + E
```

---

## Phase A — QuestionGraphEngine

**Dependencies:** None

### File: `PorizoApp/PorizoApp/Onboarding/QuestionGraphEngine.swift`

**Purpose:** Interprets the bundled JSON graph, resolves templates, manages a navigable stack (push/pop), accumulates answers, and provides the payload that Screen 9 (Payoff) and RootView consume.

#### Data Model

```swift
struct OnboardingGraph: Codable {
    let version: Int
    let entryNode: String
    let nodes: [String: GraphNode]

    enum CodingKeys: String, CodingKey {
        case version
        case entryNode = "entry_node"
        case nodes
    }
}

enum GraphNodeType: String, Codable {
    case multiSelect = "multi_select"
    case singleSelect = "single_select"
    case textInput = "text_input"
    case singleSelectOrText = "single_select_or_text"
    case terminal
}

struct GraphNodeOption: Codable {
    let label: String
    let value: String?      // nil for "Just Because"
    let emoji: String?
    let isDefault: Bool?

    enum CodingKeys: String, CodingKey {
        case label, value, emoji
        case isDefault = "is_default"
    }
}

struct GraphNode: Codable {
    let type: GraphNodeType
    let question: String?
    let subtitle: String?
    let options: [GraphNodeOption]?
    let minSelections: Int?
    let questionTemplate: String?
    let fallbackQuestion: String?
    let allowFreeText: Bool?
    let next: String?       // static edge or template e.g. "emotional_seed_{relationship_type}"
    let action: String?

    enum CodingKeys: String, CodingKey {
        case type, question, subtitle, options, next, action
        case minSelections = "min_selections"
        case questionTemplate = "question_template"
        case fallbackQuestion = "fallback_question"
        case allowFreeText = "allow_free_text"
    }
}

struct OnboardingAnswers {
    var painPoints: [String] = []
    var goalIntent: String?
    var relationshipType: String?
    var relationshipLabel: String?  // human label e.g. "Mom" for display, "mom" for machine
    var recipientName: String?
    var emotionalSeed: String?
    var occasion: String?           // nil = "Just Because"
}
```

#### QuestionGraphEngine Class

```swift
@Observable
final class QuestionGraphEngine {
    // Nav stack — head is current node. Enables back navigation (screens 3–8).
    private(set) var nodeStack: [String]
    private(set) var answers: OnboardingAnswers
    private let graph: OnboardingGraph

    var currentNodeId: String { nodeStack.last ?? graph.entryNode }
    var currentNode: GraphNode? { graph.nodes[currentNodeId] }
    var isTerminal: Bool { currentNode?.type == .terminal }
    var canGoBack: Bool { nodeStack.count > 1 }

    init(graph: OnboardingGraph) {
        self.graph = graph
        self.nodeStack = [graph.entryNode]
        self.answers = OnboardingAnswers()
    }

    // Push to next node. Returns false if already terminal.
    @discardableResult
    func advance() -> Bool { ... }

    // Pop to previous node, clearing the answer for the popped node.
    func back() { ... }

    // Answer setters
    func selectSingle(_ value: String?, label: String? = nil) { ... }  // single_select auto-advances after 300ms
    func selectMultiple(_ values: [String]) { ... }                      // caller calls advance()
    func enterText(_ value: String) { ... }                              // caller calls advance()

    // Template resolution: {name}, {relationship_label}, {relationship_type}
    func resolve(_ template: String) -> String { ... }

    // Resolve dynamic next edge (e.g. "emotional_seed_{relationship_type}")
    private func resolvedNextNodeId() -> String? { ... }

    // Payload for payoff generation
    var suggestionPayload: OnboardingSuggestionRequest { ... }

    // Graph loading
    static func loadBundled() -> OnboardingGraph { ... }
    static func loadWithServerOverride(version: Int?, url: String?) async -> OnboardingGraph { ... }
}
```

**Back navigation behavior:**
- `back()` pops `nodeStack` and clears the answer that was set at that node.
- The view checks `engine.canGoBack` to show/hide the toolbar back button.
- Back is suppressed on screens 1 and 2 (splash, mirror). The container prevents calling `back()` when `nodeStack.count == 1`.

**`selectSingle` with label:**
The `label` parameter captures the human-readable option label (e.g. "Mom") for the `relationshipLabel` answer field, which feeds the `{relationship_label}` template token and also the display copy on Screen 6.

#### Template Resolution Logic

| Token | Source |
|-------|--------|
| `{name}` | `answers.recipientName` |
| `{relationship_label}` | `answers.relationshipLabel` (e.g. "mom" lowercase of selected label) |
| `{relationship_type}` | `answers.relationshipType` (machine key e.g. "best_friend") |

Resolution is pure string substitution. Unknown tokens are left as-is.

#### Navigation: static vs computed edges

```
advance():
  1. currentNode.next → resolve templates → resolvedNextNodeId
  2. If resolved ID in graph.nodes → push to nodeStack
  3. If not found (graph gap) → treat as terminal
  4. Return true if pushed, false if terminal
```

#### Bundled JSON Loading

```swift
static func loadBundled() -> OnboardingGraph {
    guard let url = Bundle.main.url(forResource: "onboarding-graph", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let graph = try? JSONDecoder().decode(OnboardingGraph.self, from: data) else {
        fatalError("onboarding-graph.json missing from bundle")
    }
    return graph
}
```

#### Server Override Caching

```swift
static func loadWithServerOverride(version: Int?, url: String?) async -> OnboardingGraph {
    let bundled = loadBundled()
    guard let serverVersion = version, serverVersion > bundled.version,
          let urlString = url, let fetchURL = URL(string: urlString) else { return bundled }
    let cacheKey = "onboarding_graph_v\(serverVersion)"
    if let cached = UserDefaults.standard.data(forKey: cacheKey),
       let graph = try? JSONDecoder().decode(OnboardingGraph.self, from: cached) { return graph }
    guard let data = try? await URLSession.shared.data(from: fetchURL).0,
          let graph = try? JSONDecoder().decode(OnboardingGraph.self, from: data) else { return bundled }
    UserDefaults.standard.set(data, forKey: cacheKey)
    return graph
}
```

### File: `PorizoApp/PorizoApp/Resources/onboarding-graph.json`

Copy verbatim from the design spec's "V1 graph JSON" section.

- Must be added to the Xcode target's "Copy Bundle Resources" build phase.
- `version` field is `1`; bump when server ships a new graph.

---

## Phase B — Individual Screen Views

All views may be built in parallel. Each is a stateless `View` struct that receives data and emits actions via callbacks.

### Common Patterns

- `DesignTokens.background` full-screen background
- `displayFont(size: 28)` for primary questions
- `bodyFont(size: 15)` for subtitles
- 20px horizontal padding
- `DesignTokens.gold` (coral) for selected state and CTAs
- `radiusCTA` (14px) for Continue buttons
- `radiusChip` (22px) for chip borders
- `BoldChipModifier` from `DesignTokens.swift` for all chips

### Transition Contracts

- Screens 1→2: `.opacity` crossfade (0.4s).
- Screen 2→3: `.opacity` crossfade (0.3s).
- Screens 3→4→5→6→7→8→9: `.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading))` (horizontal slide).
- Back navigation: `.asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .trailing))`.

The container applies transitions; individual screen views are transition-unaware.

---

### B1 — `LivingSplashView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/LivingSplashView.swift`

**Public interface:**
```swift
struct LivingSplashView: View {
    let demoURL: String?            // nil → show offline artifact only
    let recipientLabel: String?     // nil → use hardcoded "For Mom"
    let lyricsPreview: String?      // nil → use hardcoded fallback line
    let onAdvance: () -> Void
    let onAudioStarted: () -> Void  // fires analytics event
}
```

**Offline fallback artifact (Decision #4 — hardcoded, no server dependency):**
- Recipient label: "For Mom"
- Lyric line: "Remember when you held my hand..."
- Visual: coral gradient card (`DesignTokens.gold` → `DesignTokens.roseGold`), `StaticWaveformBars` animating via phase offset
- Artwork: 280×280 coral gradient `RoundedRectangle(cornerRadius: DesignTokens.radiusOverlay)` with music note SF Symbol overlay

**Server audio layers on top when `demoURL` is non-nil:**
- `AVPlayer` streams from URL. Audio session: `.playback` + `.mixWithOthers` (does not interrupt user's music).
- Show play/pause affordance if audio hasn't autostarted.
- On stream failure: no error shown. Offline artifact already visible.
- Reuse `AVPlayer` KVO pattern from existing `OnboardingView.swift`.

**Auto-advance:** 4 seconds via `Task.sleep`. Tap also advances. No back button on this screen.

**Dependencies:** `DesignTokens`, `StaticWaveformBars`.

---

### B2 — `MirrorView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/MirrorView.swift`

**Public interface:**
```swift
struct MirrorView: View {
    let onContinue: () -> Void
}
```

- Static copy. Three lines fade in with staggered `.opacity` animation (0.3s apart), then landing line.
- Single coral Continue button at bottom.
- No back button (screen 2 — back suppressed).

---

### B3 — `PainPointsView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/PainPointsView.swift`

**Public interface:**
```swift
struct PainPointsView: View {
    let options: [GraphNodeOption]
    @Binding var selections: Set<String>
    let minRequired: Int
    let onContinue: ([String]) -> Void
    let onBack: () -> Void
}
```

- Multi-select chip grid. Coral fill + white text when selected, surface bg otherwise.
- Continue disabled until `selections.count >= minRequired`.
- Back button in toolbar (this is screen 3 — back allowed).

---

### B4 — `GoalQuestionView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/GoalQuestionView.swift`

**Public interface:**
```swift
struct GoalQuestionView: View {
    let options: [GraphNodeOption]
    let onSelect: (String) -> Void
    let onBack: () -> Void
}
```

- Single-select. Vertical list (options are long labels).
- Auto-advances on tap after 300ms delay.
- Toolbar back button.

---

### B5 — `RecipientPickerView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/RecipientPickerView.swift`

**Public interface:**
```swift
struct RecipientPickerView: View {
    let options: [GraphNodeOption]
    let onSelect: (String, String) -> Void  // (value, label) — both needed for template resolution
    let onBack: () -> Void
}
```

- 2-column `LazyVGrid`. Each cell: person-silhouette SF Symbol or emoji + label.
- Auto-advances on tap after 300ms.
- Toolbar back button.

---

### B6 — `RecipientNameView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/RecipientNameView.swift`

**Public interface:**
```swift
struct RecipientNameView: View {
    let resolvedQuestion: String     // pre-resolved by engine e.g. "What's your mom's name?"
    @Binding var nameInput: String
    let onContinue: (String) -> Void
    let onBack: () -> Void
}
```

- `TextField` with `.textInputAutocapitalization(.words)`. Emoji names allowed.
- Continue enabled at >= 2 characters (trimmed). No other restriction.
- `@FocusState` auto-focus on appear.
- Wrapped in `ScrollView` + `.scrollDismissesKeyboard(.interactively)`.
- Field style: surface bg, 12px radius, 1.5pt border (coral when focused via `.focused`).
- Toolbar back button.

---

### B7 — `AdaptiveQuestionView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/AdaptiveQuestionView.swift`

**Purpose:** Renders both emotional seed nodes (`single_select_or_text`) and occasion picker (`single_select`).

**Public interface:**
```swift
struct AdaptiveQuestionView: View {
    let resolvedQuestion: String
    let options: [GraphNodeOption]
    let allowFreeText: Bool
    @Binding var freeTextInput: String
    let onSelect: (String) -> Void       // chip tap
    let onFreeText: (String) -> Void     // free-text submit
    let onBack: () -> Void
}
```

**"Write your own" behavior (Decision — non-blocking):**
- Tapping "Write your own" chip: collapses other chips (hide them), expands a `TextField` below.
- Tapping any option chip while free-text is expanded: collapses TextField, selects chip normally.
- Continue enabled when free text >= 2 chars.

- Wrapped in `ScrollView` + `.scrollDismissesKeyboard(.interactively)` (keyboard guard for emotional seed screen).
- Toolbar back button.

---

### B8 — `OnboardingPayoffView.swift`

**Path:** `PorizoApp/PorizoApp/Onboarding/OnboardingPayoffView.swift`

**Public interface:**
```swift
struct OnboardingPayoffView: View {
    let recipientName: String
    let suggestion: OnboardingSuggestion?  // nil while loading
    let isLoading: Bool
    let onCreateTapped: () -> Void
    let onSkip: () -> Void
}

struct OnboardingSuggestion: Codable {
    let title: String
    let emotionalAngle: String
    let previewLine: String
    let source: String     // "template" | "llm"
}
```

- Headline: "Your first forever gift for {recipientName}" — `displayFont(size: 24)`.
- Song card: surface card, title (semibold), emotional angle (textSecondary), preview line (italic displayFont).
- While `suggestion == nil`: shimmer skeleton (two gray rounded rects, opacity animation).
- When `isLoading == true` but suggestion is non-nil (server call in flight): small `ProgressView` in top-right of card. Suggestion already visible — no blocking.
- Primary CTA: "Make This Song" — full-width coral. Disabled while `suggestion == nil`.
- Secondary: "Maybe later" — `bodyFont(size: 14)`, `textSecondary` color, text-only button.
- No back button on payoff screen.

---

## Phase C — OnboardingV2View Container

**Path:** `PorizoApp/PorizoApp/Onboarding/OnboardingV2View.swift`

**Dependencies:** All Phase B views + `QuestionGraphEngine`.

### Public Interface

```swift
struct OnboardingV2View: View {
    let splashDemoURL: String?
    let splashRecipientLabel: String?
    let splashLyricsPreview: String?
    let apiClient: APIClient
    let onComplete: (OnboardingResult) -> Void
    let onSkip: (PartialOnboardingResult?) -> Void  // carries suggestion if user skips at payoff
}

struct OnboardingResult {
    let recipientName: String
    let relationshipType: String
    let emotionalSeed: String
    let occasion: String?
    let goalIntent: String?
    let painPoints: [String]
    let suggestion: OnboardingSuggestion?  // may be nil if payoff not reached
}

// Used by "Maybe later" to persist the suggestion card
struct PartialOnboardingResult {
    let suggestion: OnboardingSuggestion
    let recipientName: String
    let occasion: String?
}
```

### Internal State

```swift
@State private var engine: QuestionGraphEngine?      // nil until graph loaded
@State private var macroScreen: MacroScreen = .splash
@State private var painPointSelections: Set<String> = []
@State private var recipientNameInput: String = ""
@State private var freeTextSeedInput: String = ""
@State private var suggestion: OnboardingSuggestion?
@State private var suggestionLoading: Bool = false
@State private var suggestionStartTime: Date?

enum MacroScreen { case splash, mirror, questionnaire, payoff }
```

### Screen Orchestration

```
MacroScreen.splash
  → LivingSplashView (auto-advance 4s or tap)
  → onAdvance() → .mirror (crossfade)

MacroScreen.mirror
  → MirrorView
  → onContinue() → .questionnaire, engine starts at "pain_points" (crossfade)

MacroScreen.questionnaire — driven by engine.currentNode.type:
  .multiSelect        → PainPointsView
  .singleSelect       → GoalQuestionView | RecipientPickerView | AdaptiveQuestionView
  .textInput          → RecipientNameView
  .singleSelectOrText → AdaptiveQuestionView
  engine.isTerminal   → fire payoff generation → .payoff (slide)

  back button (screens 3–8): engine.back() → re-render, slide back transition
  back on screen 3 (pain_points, first questionnaire screen): engine.back() → .mirror

MacroScreen.payoff
  → OnboardingPayoffView
  → onCreateTapped() → call onComplete(result)
  → onSkip() → call onSkip(partialResult)
```

### Payoff Generation (Decision #4 compliance — never blocks)

When `engine.isTerminal` is reached:
1. Compute local fallback synchronously via `OnboardingFallbackSuggestionService.generate(answers:)`.
2. Set `suggestion = fallback`, `suggestionLoading = true`, `suggestionStartTime = Date()`.
3. Transition to `.payoff` immediately — user sees a suggestion before any network call.
4. Fire `Task { await fetchServerSuggestion() }`.
5. `fetchServerSuggestion()`: 5s timeout. On success → replace `suggestion`. On failure → keep fallback.
6. Set `suggestionLoading = false` when done.

```swift
private func fetchServerSuggestion() async {
    let payload = engine?.suggestionPayload
    guard let payload else { return }
    do {
        let result = try await withTimeout(seconds: 5) {
            try await apiClient.requestOnboardingSuggestion(payload)
        }
        suggestion = OnboardingSuggestion(
            title: result.title,
            emotionalAngle: result.emotionalAngle,
            previewLine: result.previewLine,
            source: result.source
        )
    } catch { /* keep fallback */ }
    suggestionLoading = false
}
```

### Graph Loading

In `.onAppear`:
```swift
Task {
    // Graph load happens during splash screen — buys ~4s before questionnaire starts
    let graph = await QuestionGraphEngine.loadWithServerOverride(
        version: appConfig?.onboarding?.questionGraphVersion,
        url: appConfig?.onboarding?.questionGraphUrl
    )
    engine = QuestionGraphEngine(graph: graph)
}
```

If `engine` is still nil when user taps through splash (edge case — very slow network), hold on mirror screen with a subtle `ProgressView` until engine is ready.

### OnboardingFallbackSuggestionService

**Path:** `PorizoApp/PorizoApp/Onboarding/OnboardingFallbackSuggestionService.swift`

Pure, synchronous, no network. Generates a deterministic suggestion from `OnboardingAnswers`.

```swift
enum OnboardingFallbackSuggestionService {
    static func generate(from answers: OnboardingAnswers) -> OnboardingSuggestion { ... }
}
```

Template logic (mirrors server-side fallback):
- `title`: `"\(occasionLabel) Song for \(name)"` or `"A Song for \(name)"` if no occasion.
- `emotionalAngle`: `"A \(occasionLabel.lowercased()) song about \(seedLabel) for \(name)"`.
- `previewLine`: static map `(relationshipType, emotionalSeed) → String`. All 9×3 = 27 combinations hardcoded.
- `source`: `"template"`.

---

## Phase D — Server Changes

### D1 — New Endpoint: `POST /api/onboarding/suggest`

**Request:**
```json
{
  "recipient_name": "Linda",
  "relationship_type": "mom",
  "emotional_seed": "childhood_memory",
  "occasion": "birthday"
}
```

**Response:**
```json
{
  "title": "Summer at the Lake",
  "emotional_angle": "A birthday song for Linda about the summers that shaped everything",
  "preview_line": "Remember when the water was too cold but we jumped in anyway...",
  "source": "template_or_llm"
}
```

**Rules:**
- Auth: device token or user JWT. No auth → 401.
- Must respond in < 3s. If LLM path will exceed 3s, return template immediately.
- `source`: `"template"` for deterministic, `"llm"` for enhanced.

**Deterministic fallback template (server-side):**
```
title = "{occasion_label} for {name}"
emotional_angle = "A {occasion_label} about {seed_label} for {name}"
preview_line = seed_preview_map[relationship_type][emotional_seed]
```

The `seed_preview_map` is a static JSON file keyed by `(relationship_type, emotional_seed)`. Must be authored alongside this endpoint (27 entries minimum).

### D2 — Extend `/api/config` Onboarding Payload

Extend `OnboardingConfig` in `AppConfigResponse.swift`:

```swift
struct OnboardingConfig: Codable, Sendable {
    let sampleAudioUrl: String?
    let sampleLabel: String?
    // New:
    let splashDemoRecipient: String?
    let splashLyricsPreview: String?
    let questionGraphVersion: Int?
    let questionGraphUrl: String?

    enum CodingKeys: String, CodingKey {
        case sampleAudioUrl = "sample_audio_url"
        case sampleLabel = "sample_label"
        case splashDemoRecipient = "splash_demo_recipient"
        case splashLyricsPreview = "splash_lyrics_preview"
        case questionGraphVersion = "question_graph_version"
        case questionGraphUrl = "question_graph_url"
    }
}
```

### D3 — APIClient Extension

```swift
struct OnboardingSuggestionRequest: Codable, Sendable {
    let recipientName: String
    let relationshipType: String
    let emotionalSeed: String
    let occasion: String?

    enum CodingKeys: String, CodingKey {
        case recipientName = "recipient_name"
        case relationshipType = "relationship_type"
        case emotionalSeed = "emotional_seed"
        case occasion
    }
}

struct OnboardingSuggestionResponse: Codable, Sendable {
    let title: String
    let emotionalAngle: String
    let previewLine: String
    let source: String

    enum CodingKeys: String, CodingKey {
        case title
        case emotionalAngle = "emotional_angle"
        case previewLine = "preview_line"
        case source
    }
}

// Add to APIClient:
func requestOnboardingSuggestion(_ request: OnboardingSuggestionRequest) async throws -> OnboardingSuggestionResponse
```

---

## Phase E — RootView Integration

This is the riskiest change. **Read this section carefully before touching `RootView.swift`.**

### Decision #1 — New Completion Handler

**New `@AppStorage` keys (add alongside existing keys):**
```swift
@AppStorage("pendingEmotionalSeed") private var pendingEmotionalSeed = ""
@AppStorage("pendingRelationshipType") private var pendingRelationshipType = ""
@AppStorage("pendingSuggestion") private var pendingSuggestion = ""    // JSON string
```

**Existing keys (unchanged):**
```swift
@AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
@AppStorage("pendingRecipientName") private var pendingRecipientName = ""
@AppStorage("pendingOccasion") private var pendingOccasion = ""
@AppStorage("pendingCreateType") private var pendingCreateType = ""
```

**Remove:** `@AppStorage("onboardingViewCount")` and `@AppStorage("hasCompletedFirstSong")` — no longer needed (Decision #5).

**`completeOnboardingV2` (Decision #1):**
```swift
private func completeOnboardingV2(_ result: OnboardingResult) {
    pendingRecipientName = result.recipientName
    pendingOccasion = result.occasion ?? ""
    pendingEmotionalSeed = result.emotionalSeed
    pendingRelationshipType = result.relationshipType
    pendingCreateType = CreateFlowKind.song.rawValue

    // Encode and persist suggestion if present
    if let suggestion = result.suggestion,
       let encoded = try? JSONEncoder().encode(suggestion),
       let json = String(data: encoded, encoding: .utf8) {
        pendingSuggestion = json
    }

    hasCompletedOnboarding = true

    withAnimation(.easeInOut(duration: 0.5)) {
        appState = .main   // Direct to main — bypasses .nameEntry entirely (Decision #1)
    }
    syncProfileCompletionContext()
}
```

**`skipOnboardingV2` (Decision #3 — "Maybe later"):**
```swift
private func skipOnboardingV2(_ partial: PartialOnboardingResult?) {
    hasCompletedOnboarding = true

    // Persist partial suggestion for "Continue where you left off" card (Decision #3)
    if let partial = partial,
       let encoded = try? JSONEncoder().encode(partial.suggestion),
       let json = String(data: encoded, encoding: .utf8) {
        pendingSuggestion = json
        pendingRecipientName = partial.recipientName
        pendingOccasion = partial.occasion ?? ""
    }

    withAnimation(.easeInOut(duration: 0.5)) {
        appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
    }
}
```

### Decision #2 — Deferred-Auth Path

In `onChange(of: authManager.isAuthenticated)` — replace the existing else-branch:

```swift
} else if hasCompletedOnboarding && !skipAuth && appState != .auth {
    // Decision #2: if user has pending creation context, don't force auth gate
    // Auth captures inside creation flow when user tries to render/save
    if pendingRecipientName.isEmpty {
        profileCompletionContext = nil
        withAnimation(.easeInOut(duration: 0.3)) {
            appState = .auth
        }
    }
    // If pendingRecipientName non-empty: stay in .main, auth handled by creation flow
}
```

### Decision #5 — Migration: Remove Re-Show Logic

**Replace** the current routing decision block in `SplashView.onAppear` (lines ~149-154):

```swift
// Before (remove):
let shouldShowOnboarding = onboardingViewCount < 2 && !hasCompletedFirstSong
if hasCompletedOnboarding && !shouldShowOnboarding {
    appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
} else {
    appState = .onboarding
}

// After (Decision #5 — no re-show):
if hasCompletedOnboarding {
    appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
} else {
    appState = .onboardingV2
}
```

Existing users with `hasCompletedOnboarding = true` go straight to main/auth. No re-show.

### RootState Enum Change

```swift
enum RootState {
    case splash
    case onboardingV2          // replaces .onboarding
    case nameEntry             // keep as dead code (Decision #1) — do not remove yet
    case auth
    case main
    #if DEBUG
    case designSamples
    #endif
}
```

### `.onboardingV2` Case in `body`

```swift
case .onboardingV2:
    if let client = apiClient {
        OnboardingV2View(
            splashDemoURL: onboardingSampleURL,
            splashRecipientLabel: onboardingSplashRecipient,
            splashLyricsPreview: onboardingSplashLyricsPreview,
            apiClient: client,
            onComplete: { result in completeOnboardingV2(result) },
            onSkip: { partial in skipOnboardingV2(partial) }
        )
    } else {
        SplashView()  // client not ready yet — extremely rare edge case
    }
```

### New State vars for Splash Metadata

```swift
@State private var onboardingSplashRecipient: String?
@State private var onboardingSplashLyricsPreview: String?
```

Extract in `refreshAppConfig`:
```swift
onboardingSplashRecipient = response.onboarding?.splashDemoRecipient
onboardingSplashLyricsPreview = response.onboarding?.splashLyricsPreview
```

### `resetOnboarding` DEBUG Block Update

```swift
let keys = ["hasCompletedOnboarding", "pendingRecipientName", "pendingOccasion",
             "pendingCreateType", "pendingEmotionalSeed", "pendingRelationshipType",
             "pendingSuggestion"]
keys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
```

Remove `"onboardingViewCount"` and `"hasCompletedFirstSong"` from this list (Decision #5).

### "Continue Where You Left Off" Card (Decision #3)

**Where it lives:** The main tab's home/explore screen checks `pendingSuggestion` (non-empty string) and renders a dismissable card at the top.

**Card behavior:**
- Tapping card: read `pendingSuggestion` JSON → enter creation flow with pre-populated name/occasion/seed.
- After first successful song creation: clear `pendingSuggestion`.
- X button: clear `pendingSuggestion` immediately.

**Implementation note:** The card is a `MainTabView`-level concern. Pass `pendingSuggestion` binding down or read from `@AppStorage` directly in the relevant tab view. Implementation details deferred to the implementer — the contract is the `@AppStorage("pendingSuggestion")` JSON key.

`OnboardingSuggestion` must be `Codable` to support encode/decode round-trip through AppStorage.

---

## Phase F — Analytics Wiring

Add new events to `AnalyticsEvent` enum and wire in `OnboardingV2View`.

### New Events

```swift
case onboardingV2Started           = "onboarding_v2_started"
case onboardingV2SplashAudioPlayed = "onboarding_v2_splash_audio_played"
case onboardingV2MirrorViewed      = "onboarding_v2_mirror_viewed"
case onboardingV2PainPointsSelected = "onboarding_v2_pain_points_selected"
case onboardingV2GoalSelected      = "onboarding_v2_goal_selected"
case onboardingV2PersonSelected    = "onboarding_v2_person_selected"
case onboardingV2NameEntered       = "onboarding_v2_name_entered"
case onboardingV2SeedSelected      = "onboarding_v2_seed_selected"
case onboardingV2SuggestionShown   = "onboarding_v2_suggestion_shown"
case onboardingV2CreateTapped      = "onboarding_v2_create_tapped"
case onboardingV2Skipped           = "onboarding_v2_skipped"
case onboardingV2Completed         = "onboarding_v2_completed"
```

### Event Properties

| Event | Properties |
|-------|------------|
| `onboardingV2Started` | `audio_available: "true"/"false"` |
| `onboardingV2SplashAudioPlayed` | `trigger: "auto"/"tap"` |
| `onboardingV2MirrorViewed` | — |
| `onboardingV2PainPointsSelected` | `pain_points: "not_creative,default_to_text"`, `count: "2"` |
| `onboardingV2GoalSelected` | `goal_intent: "birthday_surprise"` |
| `onboardingV2PersonSelected` | `relationship_type: "mom"` |
| `onboardingV2NameEntered` | — |
| `onboardingV2SeedSelected` | `seed_type: "childhood_memory"`, `relationship_type: "mom"`, `is_free_text: "false"` |
| `onboardingV2SuggestionShown` | `generation_time_ms: "1230"`, `source: "template"` |
| `onboardingV2CreateTapped` | `relationship_type: "mom"`, `occasion: "birthday"` |
| `onboardingV2Skipped` | `skipped_at_screen: "payoff"` |
| `onboardingV2Completed` | `total_time_seconds: "52"` |

Track `startTime = Date()` in container `.onAppear`. Compute `total_time_seconds` in both `onComplete` and `onSkip`.

---

## Testing Strategy

### Unit Tests — QuestionGraphEngine

**File:** `PorizoAppTests/OnboardingV2/QuestionGraphEngineTests.swift`

| Test | What it proves |
|------|----------------|
| `testBundledGraphLoads` | `loadBundled()` returns graph with `version == 1`, `entryNode == "pain_points"` |
| `testFullHappyPathMom` | Full traversal for `mom`: all answers set, `isTerminal == true` at payoff |
| `testFullHappyPathPartner` | Same for `partner`: routes to `emotional_seed_partner`, not `emotional_seed_mom` |
| `testBackNavigation` | `back()` on screen 4 → screen 3 node restored, answer cleared |
| `testCannotBackBelowEntry` | `back()` when `nodeStack.count == 1` → no-op, `canGoBack == false` |
| `testTemplateNameResolution` | `resolve("What's your {relationship_label}'s name?")` with label "mom" → correct |
| `testTemplateDynamicEdge` | `name_entry` with `relationshipType = "best_friend"` → routes to `emotional_seed_best_friend` |
| `testMultiSelectMinRequired` | Verify `canAdvance` with 0 vs 1 selections |
| `testTerminalDetection` | Arriving at `payoff` node sets `isTerminal = true` |
| `testJustBecauseOccasion` | Selecting option with `value: null` sets `answers.occasion = nil` |
| `testSuggestionPayload` | `suggestionPayload` returns all four required non-nil fields after full traversal |
| `testServerOverrideSameVersion` | `loadWithServerOverride(version: 1, url: nil)` → bundled graph returned |
| `testFallbackSuggestionAllCombinations` | `OnboardingFallbackSuggestionService.generate` returns non-empty for all 27 combinations |

### Preview Tests

Each screen file includes a `#Preview` block:
- `LivingSplashView` with `demoURL: nil` (offline artifact visible) and with mock URL.
- `PainPointsView` with all 5 options, 2 pre-selected.
- `AdaptiveQuestionView` with `allowFreeText: true` and free-text field expanded.
- `OnboardingPayoffView` in 3 states: loading skeleton, fallback suggestion, server suggestion.

### Integration Test — Full Flow

**File:** `PorizoAppTests/OnboardingV2/OnboardingV2FlowTests.swift`

Drive `QuestionGraphEngine` from entry to terminal with a mock `APIClient`. Assert:
- `OnboardingResult` payload fields match inputs.
- All analytics events fired in correct order.
- Fallback suggestion available before mock API responds.

### Simulator Launch Args

```
--reset-onboarding --bypass-auth
```

Clears all new onboarding AppStorage keys and bypasses auth to show V2 immediately.

---

## Migration Path

### Decision #5: No Re-Show

`hasCompletedOnboarding = true` → skip onboarding entirely, go to main/auth. The `onboardingViewCount` re-show logic is removed. Users who have completed old onboarding are unaffected.

### Users Who Have Not Completed Onboarding

They see V2. There is no persisted mid-old-onboarding state, so no reset needed.

### Existing `onboardingViewCount` and `hasCompletedFirstSong` Keys

Leave in UserDefaults (don't actively delete them from existing installs). Simply stop reading them. The keys become inert. Remove from `resetOnboarding` block so test resets don't depend on them.

---

## File Map Summary

| File | Action | Phase |
|------|--------|-------|
| `PorizoApp/Onboarding/QuestionGraphEngine.swift` | New | A |
| `PorizoApp/Onboarding/OnboardingFallbackSuggestionService.swift` | New | A |
| `PorizoApp/Resources/onboarding-graph.json` | New | A |
| `PorizoApp/Onboarding/LivingSplashView.swift` | New | B |
| `PorizoApp/Onboarding/MirrorView.swift` | New | B |
| `PorizoApp/Onboarding/PainPointsView.swift` | New | B |
| `PorizoApp/Onboarding/GoalQuestionView.swift` | New | B |
| `PorizoApp/Onboarding/RecipientPickerView.swift` | New | B |
| `PorizoApp/Onboarding/RecipientNameView.swift` | New | B |
| `PorizoApp/Onboarding/AdaptiveQuestionView.swift` | New | B |
| `PorizoApp/Onboarding/OnboardingPayoffView.swift` | New | B |
| `PorizoApp/Onboarding/OnboardingV2View.swift` | New | C |
| `PorizoApp/Services/AppConfigResponse.swift` | Modify | D |
| `src/routes/onboarding.js` (server) | New | D |
| `PorizoApp/RootView.swift` | Modify | E |
| `PorizoApp/Services/AnalyticsService.swift` | Modify | F |
| `PorizoAppTests/OnboardingV2/QuestionGraphEngineTests.swift` | New | A tests |
| `PorizoAppTests/OnboardingV2/OnboardingV2FlowTests.swift` | New | C tests |

All new Swift files live under `PorizoApp/PorizoApp/Onboarding/` (new directory).

---

## Open Questions (Non-Blocking)

1. **Demo song artifact:** Real audio URL for `LivingSplashView` must be configured in `/api/config` before splash audio can be validated. Use offline artifact during development.

2. **`pendingSuggestion` card surface in main app:** The contract (AppStorage key + JSON schema) is defined. The exact placement (home tab vs explore tab, card vs banner) needs product sign-off before Phase E wrap-up.

3. **`seed_preview_map` authoring:** 27 static preview lines needed for server fallback + `OnboardingFallbackSuggestionService`. Can be written by any team member; unblocks server and iOS independently.
