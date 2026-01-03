# StoryCollectionKit Architecture Plan

> **Status**: Planned
> **Created**: 2026-01-03
> **Purpose**: Standalone module for AI-powered song/poem writing wizard

## Overview

Extract the song/poem writing conversational flow into a **Swift Package (SPM)** that can be developed and tested in isolation. The module will be unified to support both songs and poems.

### Design Decisions
- **Package Type**: Swift Package (SPM) - shareable, clean boundaries
- **Poem Reuse**: High priority - unify Song and Poem wizards
- **Offline Mode**: Not needed - API availability assumed

---

## Problem Statement

The current `StoryWizardView.swift` is a 1000+ line file with 18+ @State variables tightly coupled to the main app. This makes it difficult to:
1. Iterate on the AI question flow independently
2. Unit test the business logic
3. Reuse the same flow for poems
4. Maintain consistency between song and poem wizards

---

## Architecture

### Module Structure

```
PorizoApp/
├── Packages/
│   └── StoryCollectionKit/              # New SPM Package
│       ├── Package.swift
│       ├── Sources/StoryCollectionKit/
│       │   ├── Public/
│       │   │   ├── ContentWizardCoordinator.swift    # Entry point
│       │   │   ├── Protocols/
│       │   │   │   ├── QuestionProvider.swift        # AI question abstraction
│       │   │   │   └── WizardTheme.swift             # Theming protocol
│       │   │   ├── Configuration/
│       │   │   │   └── WizardConfig.swift            # Occasions, styles, limits
│       │   │   └── Models/
│       │   │       ├── ContentCollectionResult.swift # Output (songs + poems)
│       │   │       ├── ContentQuestion.swift
│       │   │       └── ContentAnswer.swift
│       │   │
│       │   └── Internal/
│       │       ├── ViewModel/
│       │       │   └── ContentWizardViewModel.swift  # Main state + logic
│       │       ├── Views/
│       │       │   ├── ContentWizardView.swift       # Container
│       │       │   ├── Steps/
│       │       │   │   ├── BasicsStepView.swift
│       │       │   │   ├── StoryStepView.swift       # AI Q&A flow
│       │       │   │   └── PreviewStepView.swift
│       │       │   └── Components/
│       │       │       ├── WizardStepIndicator.swift
│       │       │       ├── FormSectionCard.swift
│       │       │       ├── ChipSelector.swift
│       │       │       ├── FormTextField.swift
│       │       │       ├── FormTextArea.swift
│       │       │       └── AIQuestionCard.swift
│       │       └── StateMachine/
│       │           ├── WizardState.swift
│       │           └── WizardReducer.swift           # Pure, testable logic
│       │
│       └── Tests/StoryCollectionKitTests/
│           ├── WizardReducerTests.swift
│           └── ViewModelTests.swift
│
└── PorizoApp/                           # Main app
    └── Adapters/
        └── PorizoQuestionProvider.swift  # Implements QuestionProvider
```

---

## Key Protocols (Public API)

### QuestionProvider

Abstracts AI question generation so main app can provide its own implementation:

```swift
public protocol QuestionProvider: Sendable {
    func generateQuestions(
        currentContent: String,
        contentType: ContentType,  // .song or .poem
        occasion: String?,
        recipientName: String?
    ) async throws -> [ContentQuestion]
}
```

### ContentCollectionResult (Output)

The unified output structure that works for both songs and poems:

```swift
public struct ContentCollectionResult: Sendable {
    public let contentType: ContentType      // .song or .poem
    public let recipientName: String
    public let occasionId: String
    public let styleId: String               // Music style for songs, tone for poems
    public let storyContent: String          // Accumulated story
    public let answers: [ContentAnswer]      // Q&A history
    public let specialPhrases: String?
    public let whatMakesThemSpecial: String?
}
```

### WizardConfig (Configurable)

Allows different configurations for songs vs poems:

```swift
public struct WizardConfig {
    public let contentType: ContentType
    public let occasions: [OccasionOption]
    public let styles: [StyleOption]         // MusicStyle for songs, PoemTone for poems
    public let minContentLength: Int
    public let maxContentLength: Int
    public let title: String                 // "Create Song" or "Create Poem"

    public static let song = WizardConfig(...)
    public static let poem = WizardConfig(...)
}
```

### WizardTheme (Optional Customization)

```swift
public protocol WizardTheme {
    var primaryColor: Color { get }
    var backgroundColor: Color { get }
    var cardBackground: Color { get }
    var textPrimary: Color { get }
    var textSecondary: Color { get }
    var successColor: Color { get }
    var errorColor: Color { get }
}
```

---

## State Machine Design

### WizardState

```swift
public enum WizardStep: Int, CaseIterable, Sendable {
    case basics = 0
    case story = 1
    case preview = 2
}

public enum WizardState: Sendable, Equatable {
    case idle
    case step(WizardStep)
    case loadingQuestion
    case questionReady(ContentQuestion)
    case questionError(String)
    case storyComplete
    case submitting
    case completed(ContentCollectionResult)
    case cancelled
}
```

### WizardReducer (Pure, Testable)

```swift
public struct WizardReducer {
    private let config: WizardConfig

    /// Pure function: (State, Action, Context) -> State
    /// 100% unit testable with no side effects
    public func reduce(
        state: WizardState,
        action: WizardAction,
        context: WizardContext
    ) -> WizardState {
        switch (state, action) {
        case (.step(.basics), .nextStep):
            guard canProceed(from: .basics, context: context) else { return state }
            return .step(.story)
        // ... other transitions
        }
    }

    public func canProceed(from step: WizardStep, context: WizardContext) -> Bool {
        switch step {
        case .basics: return !context.recipientName.trimmingCharacters(in: .whitespaces).isEmpty
        case .story: return context.storyContent.count >= config.minContentLength
        case .preview: return true
        }
    }
}
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONSUMING APP                                   │
│  ┌───────────────────┐                        ┌────────────────────────────┐│
│  │   APIClient       │                        │  Track/Poem Creation       ││
│  │  (implements      │                        │  (receives result)         ││
│  │  QuestionProvider)│                        │                            ││
│  └─────────┬─────────┘                        └────────────────────────────┘│
│            │ injects                                       ▲                 │
│            ▼                                               │ ContentResult   │
│  ┌─────────────────────────────────────────────────────────┴────────────────┐│
│  │                    ContentWizardCoordinator                              ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STORY COLLECTION KIT                                 │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         ContentWizardView                               │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │ │
│  │  │  BasicsStepView │  │  StoryStepView  │  │ PreviewStepView │         │ │
│  │  │ - Recipient     │  │ - AI Questions  │  │ - Summary       │         │ │
│  │  │ - Occasion      │  │ - Answers       │  │ - Extras        │         │ │
│  │  │ - Style/Tone    │  │ - Story Preview │  │ - Edit          │         │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                     │                                        │
│                                     ▼                                        │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       ContentWizardViewModel                            │ │
│  │  @Published state, validation, action dispatch                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                     │                                        │
│                                     ▼                                        │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          WizardReducer                                  │ │
│  │  Pure function: (State, Action, Context) -> State                       │ │
│  │  100% unit testable                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Create SPM Package Structure (1-2 hours)

**Files to create:**
- `PorizoApp/Packages/StoryCollectionKit/Package.swift`
- `Sources/StoryCollectionKit/Public/Protocols/QuestionProvider.swift`
- `Sources/StoryCollectionKit/Public/Protocols/WizardTheme.swift`
- `Sources/StoryCollectionKit/Public/Configuration/WizardConfig.swift`
- `Sources/StoryCollectionKit/Public/Models/*.swift`

### Phase 2: Extract State Machine & ViewModel (2-3 hours)

**Extract from:** `PorizoApp/PorizoApp/StoryWizardView.swift`

Key extractions:
- `WizardState` enum - All possible states
- `WizardReducer` - Pure function state transitions (unit testable)
- `ContentWizardViewModel` - @MainActor ObservableObject with:
  - All @State variables from current StoryWizardView (18+ variables)
  - fetchNextQuestion(), submitAnswer(), skipQuestion(), finishQuestions()
  - Validation logic (canProceed)

### Phase 3: Extract UI Components (2-3 hours)

**Move components from StoryWizardView.swift:**
- `FormSectionCard` (lines 17-68)
- `FormTextField` (lines 71-88)
- `FormTextArea` (lines 91-121)
- `ChipSelector` (lines 124-176)
- `WizardStepTabs` (lines 269-334)

**Create step views:**
- `BasicsStepView` - Who, Occasion, Style/Tone
- `StoryStepView` - AI Q&A with live story building
- `PreviewStepView` - Summary and extras

### Phase 4: Create Entry Point (1 hour)

```swift
public struct ContentWizardCoordinator: View {
    public init(
        questionProvider: QuestionProvider,
        config: WizardConfig,
        theme: WizardTheme? = nil,
        onComplete: @escaping (ContentCollectionResult) -> Void,
        onCancel: @escaping () -> Void
    )

    public var body: some View {
        ContentWizardView(
            viewModel: ContentWizardViewModel(
                questionProvider: questionProvider,
                config: config
            ),
            theme: theme ?? DefaultTheme(),
            onComplete: onComplete,
            onCancel: onCancel
        )
    }
}
```

### Phase 5: Create Adapter in Main App (1 hour)

**File:** `PorizoApp/PorizoApp/Adapters/PorizoQuestionProvider.swift`

```swift
struct PorizoQuestionProvider: QuestionProvider {
    let apiClient: APIClient

    func generateQuestions(
        currentContent: String,
        contentType: ContentType,
        occasion: String?,
        recipientName: String?
    ) async throws -> [ContentQuestion] {
        let response = try await apiClient.generateMemoryQuestions(
            memory: currentContent,
            occasion: occasion,
            recipientName: recipientName
        )
        return response.questions.map {
            ContentQuestion(
                id: $0.id,
                question: $0.question,
                placeholder: $0.placeholder
            )
        }
    }
}
```

### Phase 6: Integrate & Remove Old Code (1-2 hours)

**Modify:**
- `ContentView.swift` - Use `ContentWizardCoordinator` instead of `StoryWizardView`
- `MainTabView.swift` - Update `CreateFlowView` to use new module
- Delete old `StoryWizardView.swift` (after verification)
- Update `PoemWizardView.swift` to use same module with poem config

**Example integration:**
```swift
// In ContentView or CreateFlowView
ContentWizardCoordinator(
    questionProvider: PorizoQuestionProvider(apiClient: apiClient),
    config: .song,  // or .poem
    onComplete: { result in
        // Convert to StoryContext for backward compatibility
        let context = StoryContext(from: result)
        storyContext = context
        appState = .creatingTrack
    },
    onCancel: {
        appState = .mySongs
    }
)
```

### Phase 7: Add Tests (1-2 hours)

**WizardReducerTests.swift:**
```swift
class WizardReducerTests: XCTestCase {
    func testCannotProceedWithEmptyRecipientName() {
        let reducer = WizardReducer(config: .song)
        var context = WizardContext.initial
        context.recipientName = ""

        XCTAssertFalse(reducer.canProceed(from: .basics, context: context))
    }

    func testSubmitAnswerAppendsToStory() {
        // Test that answers accumulate correctly
    }

    func testMinimumStoryLengthRequired() {
        // Test validation logic
    }
}
```

**ViewModelTests.swift:**
```swift
class ViewModelTests: XCTestCase {
    func testFetchQuestionUpdatesState() async {
        let mockProvider = MockQuestionProvider()
        let vm = ContentWizardViewModel(
            questionProvider: mockProvider,
            config: .song
        )

        await vm.fetchQuestion()

        XCTAssertNotNil(vm.currentQuestion)
        XCTAssertFalse(vm.isLoading)
    }
}
```

---

## Files to Modify (Main App)

| File | Action |
|------|--------|
| `PorizoApp/StoryWizardView.swift` | Extract logic → Delete |
| `PorizoApp/PoemWizardView.swift` | Replace with ContentWizardCoordinator |
| `PorizoApp/ContentView.swift` | Update wizard integration |
| `PorizoApp/MainTabView.swift` | Update CreateFlowView |
| `PorizoApp/Models.swift` | Keep existing, add adapters |
| `PorizoApp/APIClient.swift` | No change (adapter wraps it) |

---

## Benefits

1. **Independent Iteration** - Improve AI question flow without touching main app
2. **Testable** - WizardReducer is pure function, 100% unit testable
3. **Unified** - One module for both songs and poems (via config)
4. **Clean Boundaries** - Protocol-based dependencies, no hard coupling
5. **Shareable** - Could be used in future apps or extensions
6. **Maintainable** - Single source of truth for wizard logic

---

## Estimated Time

| Phase | Time |
|-------|------|
| Package structure | 1-2h |
| State machine & ViewModel | 2-3h |
| UI components | 2-3h |
| Entry point | 1h |
| Adapter | 1h |
| Integration | 1-2h |
| Tests | 1-2h |
| **Total** | **10-14h** |

---

## Future Enhancements

1. **Analytics Integration** - Add optional `WizardAnalytics` protocol for tracking
2. **A/B Testing** - Configuration-based question flow variants
3. **Localization** - Extract all strings for i18n
4. **Accessibility** - VoiceOver, Dynamic Type support
5. **Offline Mode** - Static fallback questions (if needed later)
