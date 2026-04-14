//
//  OnboardingV2View.swift
//  PorizoApp
//
//  Root container for the V2 onboarding flow.
//  Orchestrates 9 screens: Living Splash → Mirror → Questionnaire → Payoff.
//  The questionnaire screens are driven by QuestionGraphEngine.
//

import SwiftUI
import AVFoundation

// MARK: - Onboarding Result

struct OnboardingResult {
    let recipientName: String
    let relationshipType: String
    let emotionalSeed: String
    let occasion: String?
    let goalIntent: String?
    let painPoints: [String]
    let suggestion: OnboardingSuggestion?
}

struct PartialOnboardingResult {
    let suggestion: OnboardingSuggestion
    let recipientName: String
    let occasion: String?
}

// MARK: - OnboardingV2View

struct OnboardingV2View: View {
    let splashDemoURL: String?
    let splashRecipientLabel: String?
    let splashLyricsPreview: String?
    let questionGraphVersion: Int?
    let questionGraphUrl: String?
    let apiClient: APIClient
    let onComplete: (OnboardingResult) -> Void
    let onSkip: (PartialOnboardingResult?) -> Void

    @State private var engine: QuestionGraphEngine?
    @State private var screen: OnboardingScreen = .splash
    @State private var suggestion: OnboardingSuggestion?
    @State private var suggestionLoading = false
    @State private var painPointSelections: Set<String> = []
    @State private var nameInput = ""
    @State private var startTime = Date()

    // Audio owned here so it persists across splash → mirror → pain points → goal
    @State private var bgPlayer: AVPlayer?
    @State private var bgAudioTask: Task<Void, Never>?

    enum OnboardingScreen {
        case splash
        case mirror
        case questionnaire
        case payoff
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            Group {
                switch screen {
                case .splash:
                    LivingSplashView(
                        demoURL: splashDemoURL,
                        recipientLabel: splashRecipientLabel,
                        lyricsPreview: splashLyricsPreview,
                        onAdvance: {
                            transitionTo(.mirror)
                            AnalyticsService.shared.log(.onboardingV2MirrorViewed)
                        },
                        onAudioPlayed: { trigger in
                            AnalyticsService.shared.log(.onboardingV2SplashAudioPlayed, properties: ["trigger": trigger])
                        }
                    )

                case .mirror:
                    MirrorView {
                        if engine == nil {
                            engine = QuestionGraphEngine(graph: QuestionGraphEngine.loadBundled())
                        }
                        transitionTo(.questionnaire)
                    }

                case .questionnaire:
                    questionnaireContent

                case .payoff:
                    OnboardingPayoffView(
                        recipientName: engine?.answers.recipientName ?? "",
                        suggestion: suggestion,
                        isLoading: suggestionLoading,
                        onCreateTapped: {
                            logCompletion()
                            guard let engine else { return }
                            AnalyticsService.shared.log(.onboardingV2CreateTapped, properties: [
                                "relationship_type": engine.answers.relationshipType ?? "",
                                "occasion": engine.answers.occasion ?? "just_because"
                            ])
                            onComplete(OnboardingResult(
                                recipientName: engine.answers.recipientName ?? "",
                                relationshipType: engine.answers.relationshipType ?? "",
                                emotionalSeed: engine.answers.emotionalSeed ?? "",
                                occasion: engine.answers.occasion,
                                goalIntent: engine.answers.goalIntent,
                                painPoints: engine.answers.painPoints,
                                suggestion: suggestion
                            ))
                        },
                        onSkip: {
                            logCompletion()
                            AnalyticsService.shared.log(.onboardingV2Skipped, properties: [
                                "skipped_at_screen": "payoff"
                            ])
                            if let suggestion, let engine {
                                onSkip(PartialOnboardingResult(
                                    suggestion: suggestion,
                                    recipientName: engine.answers.recipientName ?? "",
                                    occasion: engine.answers.occasion
                                ))
                            } else {
                                onSkip(nil)
                            }
                        }
                    )
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
        }
        .onAppear {
            startTime = Date()
            AnalyticsService.shared.log(.onboardingV2Started, properties: [
                "audio_available": splashDemoURL != nil ? "true" : "false"
            ])
            // Start background audio that persists across splash → mirror → pain points → goal
            startBackgroundAudio()
            // Load graph with server override in background
            Task {
                let graph = await QuestionGraphEngine.loadWithServerOverride(version: questionGraphVersion, url: questionGraphUrl)
                if engine == nil {
                    engine = QuestionGraphEngine(graph: graph)
                }
            }
        }
        .onDisappear {
            stopBackgroundAudio()
        }
        .onChange(of: screen) { _, newScreen in
            // Fade out audio when user reaches the interactive questionnaire
            if newScreen == .questionnaire {
                fadeOutBackgroundAudio()
            }
        }
    }

    // MARK: - Questionnaire Content

    @ViewBuilder
    private var questionnaireContent: some View {
        if let engine {
            let node = engine.currentNode
            let nodeId = engine.currentNodeId

            switch node?.type {
            case .multiSelect:
                PainPointsView(
                    options: node?.options ?? [],
                    selections: $painPointSelections,
                    minRequired: node?.minSelections ?? 1,
                    onContinue: { values in
                        engine.selectMultiple(values)
                        AnalyticsService.shared.log(.onboardingV2PainPointsSelected, properties: [
                            "pain_points": values.joined(separator: ","),
                            "count": "\(values.count)"
                        ])
                        engine.advance()
                        advanceOrPayoff()
                    }
                )

            case .singleSelect where nodeId == "goal_question":
                GoalQuestionView(
                    options: node?.options ?? [],
                    onSelect: { value in
                        engine.selectSingle(value)
                        AnalyticsService.shared.log(.onboardingV2GoalSelected, properties: [
                            "goal_intent": value
                        ])
                        engine.advance()
                        advanceOrPayoff()
                    }
                )

            case .singleSelect where nodeId == "relationship_picker":
                RecipientPickerView(
                    options: node?.options ?? [],
                    onSelect: { value in
                        engine.selectSingle(value)
                        AnalyticsService.shared.log(.onboardingV2PersonSelected, properties: [
                            "relationship_type": value
                        ])
                        engine.advance()
                        advanceOrPayoff()
                    }
                )

            case .singleSelect:
                // Occasion picker or other single-select
                AdaptiveQuestionView(
                    resolvedQuestion: engine.resolvedQuestion,
                    options: node?.options ?? [],
                    allowFreeText: false,
                    preselectedValue: engine.currentNodeId == "occasion_picker" ? engine.answers.occasion : nil,
                    onContinue: { value in
                        let resolvedValue = value.isEmpty ? nil : value
                        engine.selectSingle(resolvedValue)
                        if engine.currentNodeId == "occasion_picker" {
                            AnalyticsService.shared.log(.onboardingV2SeedSelected, properties: [
                                "seed_type": engine.answers.emotionalSeed ?? "",
                                "relationship_type": engine.answers.relationshipType ?? "",
                                "has_occasion": resolvedValue != nil ? "true" : "false"
                            ])
                        }
                        engine.advance()
                        advanceOrPayoff()
                    }
                )

            case .textInput:
                RecipientNameView(
                    resolvedQuestion: engine.resolvedQuestion,
                    nameInput: $nameInput,
                    onContinue: { name in
                        engine.enterText(name)
                        AnalyticsService.shared.log(.onboardingV2NameEntered)
                        engine.advance()
                        advanceOrPayoff()
                    }
                )

            case .singleSelectOrText:
                AdaptiveQuestionView(
                    resolvedQuestion: engine.resolvedQuestion,
                    options: node?.options ?? [],
                    allowFreeText: node?.allowFreeText ?? false,
                    onContinue: { value in
                        engine.selectSingle(value)
                        // seed_selected analytics fires at occasion_picker with has_occasion
                        engine.advance()
                        advanceOrPayoff()
                    }
                )

            case .terminal:
                // Should not render here — transition to payoff
                EmptyView()
                    .onAppear { transitionToPayoff() }

            case nil:
                EmptyView()
            }
        } else {
            ProgressView()
                .tint(DesignTokens.gold)
        }
    }

    // MARK: - Navigation Helpers

    private func transitionTo(_ newScreen: OnboardingScreen) {
        withAnimation(.easeInOut(duration: 0.35)) {
            screen = newScreen
        }
    }

    /// After advancing the engine, check if we've reached a terminal node and transition accordingly.
    private func advanceOrPayoff() {
        guard let engine else { return }
        if engine.isTerminal {
            transitionToPayoff()
        }
    }

    private func transitionToPayoff() {
        guard let engine else { return }
        // Generate fallback suggestion immediately
        let fallback = FallbackSuggestion.generate(from: engine.answers)
        suggestion = fallback
        suggestionLoading = true
        transitionTo(.payoff)

        let payload = engine.suggestionPayload
        let generationStart = Date()

        AnalyticsService.shared.log(.onboardingV2SuggestionShown, properties: [
            "source": "template",
            "generation_time_ms": "0"
        ])

        // Try server suggestion — logs upgrade event only if server replaces template
        Task { @MainActor in
            do {
                let serverSuggestion = try await withTimeout(seconds: 5) {
                    try await apiClient.requestOnboardingSuggestion(payload)
                }
                let elapsed = Int(Date().timeIntervalSince(generationStart) * 1000)
                suggestion = serverSuggestion
                AnalyticsService.shared.log(.onboardingV2SuggestionUpgraded, properties: [
                    "source": serverSuggestion.source,
                    "generation_time_ms": "\(elapsed)"
                ])
            } catch {
                // Keep fallback — it's already showing
                #if DEBUG
                print("[OnboardingV2] Suggestion fetch failed: \(error.localizedDescription)")
                #endif
            }
            suggestionLoading = false
        }
    }

    private func logCompletion() {
        let elapsed = Int(Date().timeIntervalSince(startTime))
        AnalyticsService.shared.log(.onboardingV2Completed, properties: [
            "total_time_seconds": "\(elapsed)"
        ])
    }

    // MARK: - Background Audio (persists across splash → mirror → pain points → goal)

    private func startBackgroundAudio() {
        guard let urlString = splashDemoURL, let url = URL(string: urlString) else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            #if DEBUG
            print("[OnboardingV2] Audio session setup failed: \(error.localizedDescription)")
            #endif
            return
        }
        let player = AVPlayer(url: url)
        player.volume = 0.4
        player.play()
        bgPlayer = player

        // Auto-fade after 30 seconds
        bgAudioTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            fadeOutBackgroundAudio()
        }
    }

    private func fadeOutBackgroundAudio() {
        guard let player = bgPlayer, player.volume > 0 else { return }
        bgAudioTask?.cancel()
        // Smooth fade over 2 seconds
        Task { @MainActor in
            let steps = 20
            let interval: TimeInterval = 2.0 / Double(steps)
            let volumeStep = player.volume / Float(steps)
            for _ in 0..<steps {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { break }
                player.volume = max(0, player.volume - volumeStep)
            }
            player.pause()
            bgPlayer = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func stopBackgroundAudio() {
        bgAudioTask?.cancel()
        bgPlayer?.pause()
        bgPlayer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Simple timeout wrapper for async operations.
    private func withTimeout<T: Sendable>(seconds: TimeInterval, operation: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw CancellationError()
            }
            guard let result = try await group.next() else {
                throw CancellationError()
            }
            group.cancelAll()
            return result
        }
    }

    // MARK: - Fallback Suggestion Generator

    private enum FallbackSuggestion {
        static func generate(from answers: OnboardingAnswers) -> OnboardingSuggestion {
            let name = answers.recipientName ?? "them"
            let occasion = answers.occasion
            let seed = answers.emotionalSeed ?? ""

            let occasionLabel = occasion?
                .replacingOccurrences(of: "_", with: " ")
                .capitalized

            let title = occasionLabel != nil ? "\(occasionLabel!) Song for \(name)" : "A Song for \(name)"

            let seedLabel = seed
                .replacingOccurrences(of: "_", with: " ")
                .capitalized

            let emotionalAngle: String
            if let label = occasionLabel {
                emotionalAngle = "A \(label.lowercased()) song for \(name) about \(seedLabel.lowercased())"
            } else {
                emotionalAngle = "A song for \(name) about \(seedLabel.lowercased())"
            }

            let previewLine = previewForSeed(seed: seed, name: name)

            return OnboardingSuggestion(
                title: title,
                emotionalAngle: emotionalAngle,
                previewLine: previewLine,
                source: "template"
            )
        }

        private static func previewForSeed(seed: String, name: String) -> String {
            switch seed {
            case "thank_you_everything":
                return "For every moment you gave without asking, \(name)..."
            case "childhood_memory":
                return "Remember those days that felt like they'd last forever..."
            case "unsaid_words":
                return "There's something I've been meaning to tell you, \(name)..."
            case "first_met":
                return "From the very first moment I knew, \(name)..."
            case "inside_joke":
                return "Nobody else would understand, but we always will..."
            case "always_remember":
                return "Hold onto this, \(name) — it's yours forever..."
            case "growing_up":
                return "Side by side through everything, \(name)..."
            case "survived_together":
                return "We made it through, and that's what matters..."
            case "how_we_met":
                return "Who knew that day would change everything, \(name)..."
            case "always_laugh":
                return "Every time I think of it, I can't help but smile..."
            case "changed_everything":
                return "That moment when everything shifted, \(name)..."
            case "proud":
                return "If you could see yourself through my eyes, \(name)..."
            case "made_me_smile":
                return "That look on your face, \(name) — I'll never forget it..."
            case "pass_on":
                return "Carry this with you always, \(name)..."
            case "treasured_memory":
                return "Some moments become part of who we are, \(name)..."
            case "always_admired":
                return "The way you see the world, \(name) — it inspires me..."
            case "preserve_moment":
                return "Before time takes this away, let me say it now..."
            default:
                return "This one's for you, \(name) — every word, every note..."
            }
        }
    }
}
