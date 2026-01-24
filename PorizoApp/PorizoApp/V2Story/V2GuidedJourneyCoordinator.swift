//
//  V2GuidedJourneyCoordinator.swift
//  PorizoApp
//
//  Coordinates the 3-phase V2 Guided Journey flow:
//  1. Basics - Recipient name, occasion, style selection
//  2. Journey - Interactive V2 story collection
//  3. Complete - Create StoryContext, call onComplete
//

import SwiftUI

// MARK: - Coordinator View

struct V2GuidedJourneyCoordinator: View {
    let apiClient: APIClient
    let preselectedOccasion: Occasion?
    let resumeSession: V2Session?
    let creationNoun: String
    let onComplete: (StoryContext) -> Void
    let onCancel: () -> Void

    @State private var phase: Phase = .basics
    @StateObject private var engine: V2StoryEngine
    @State private var didRestoreSession: Bool = false

    enum Phase {
        case basics
        case initialPrompt
        case journey
    }

    // Basics state
    @State private var recipientName: String = ""
    @State private var selectedOccasion: Occasion = .birthday
    @State private var selectedStyle: MusicStyle = .pop

    // Initial prompt state
    @State private var initialPrompt: String = ""

    init(
        apiClient: APIClient,
        preselectedOccasion: Occasion? = nil,
        resumeSession: V2Session? = nil,
        creationNoun: String = "song",
        onComplete: @escaping (StoryContext) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.apiClient = apiClient
        self.preselectedOccasion = preselectedOccasion
        self.resumeSession = resumeSession
        self.creationNoun = creationNoun
        self.onComplete = onComplete
        self.onCancel = onCancel

        // Initialize engine with apiClient
        _engine = StateObject(wrappedValue: V2StoryEngine(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            switch phase {
            case .basics:
                basicsView

            case .initialPrompt:
                initialPromptView

            case .journey:
                journeyView
            }
        }
        .navigationTitle(navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    onCancel()
                }
                .foregroundColor(DesignTokens.rose)
            }

            if phase != .basics {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        goBack()
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .foregroundColor(DesignTokens.rose)
                }
            }
        }
        .onAppear {
            if let occasion = preselectedOccasion {
                selectedOccasion = occasion
            }
            if let session = resumeSession, !didRestoreSession {
                didRestoreSession = true
                engine.restoreSession(session)
                recipientName = session.recipientName
                selectedOccasion = Occasion(rawValue: session.occasion) ?? .birthday
                selectedStyle = MusicStyle(rawValue: session.style ?? "pop") ?? .pop
                initialPrompt = session.initialPrompt ?? ""
                phase = .journey
                Task {
                    try? await engine.refreshSessionFromServer()
                }
            }
        }
    }

    private var navigationTitle: String {
        switch phase {
        case .basics: return "Who's this for?"
        case .initialPrompt: return "Your Memory"
        case .journey: return "Your Story"
        }
    }

    // MARK: - Phase 1: Basics

    private var basicsView: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 48))
                        .foregroundColor(DesignTokens.rose)

                    Text("Who are you creating this for?")
                        .font(.title2.bold())
                        .foregroundColor(DesignTokens.textPrimary)
                }
                .padding(.top, 20)

                // Recipient name
                VStack(alignment: .leading, spacing: 8) {
                    Text("Their name")
                        .font(.subheadline.bold())
                        .foregroundColor(DesignTokens.textPrimary)

                    TextField("Enter their name", text: $recipientName)
                        .font(.body)
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.rose)
                        .padding(16)
                        .background(DesignTokens.cardBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(DesignTokens.cardBorder, lineWidth: 1)
                        )
                }
                .padding(.horizontal)

                // Occasion selection
                VStack(alignment: .leading, spacing: 12) {
                    Text("What's the occasion?")
                        .font(.subheadline.bold())
                        .foregroundColor(DesignTokens.textPrimary)
                        .padding(.horizontal)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        ForEach(Occasion.allCases) { occasion in
                            occasionButton(occasion)
                        }
                    }
                    .padding(.horizontal)
                }

                if shouldShowStyleSelection {
                    // Style selection
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Music style")
                            .font(.subheadline.bold())
                            .foregroundColor(DesignTokens.textPrimary)
                            .padding(.horizontal)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(MusicStyle.allCases) { style in
                                    styleButton(style)
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
                }

                Spacer(minLength: 40)

                // Continue button
                Button {
                    continueToInitialPrompt()
                } label: {
                    Text("Continue")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(canContinueFromBasics ? DesignTokens.rose : DesignTokens.cardBorder)
                        .cornerRadius(12)
                }
                .disabled(!canContinueFromBasics)
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
        }
    }

    private var canContinueFromBasics: Bool {
        !recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var shouldShowStyleSelection: Bool {
        creationNoun.lowercased() != "poem"
    }

    private func occasionButton(_ occasion: Occasion) -> some View {
        Button {
            selectedOccasion = occasion
        } label: {
            HStack {
                Text(occasion.emoji)
                Text(occasion.displayName)
                    .font(.subheadline)
            }
            .foregroundColor(selectedOccasion == occasion ? .white : DesignTokens.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(selectedOccasion == occasion ? DesignTokens.rose : DesignTokens.cardBackground)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(selectedOccasion == occasion ? Color.clear : DesignTokens.cardBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func styleButton(_ style: MusicStyle) -> some View {
        Button {
            selectedStyle = style
        } label: {
            Text(style.displayName)
                .font(.subheadline)
                .foregroundColor(selectedStyle == style ? .white : DesignTokens.textPrimary)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(selectedStyle == style ? DesignTokens.rose : DesignTokens.cardBackground)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(selectedStyle == style ? Color.clear : DesignTokens.cardBorder, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Phase 2: Initial Prompt

    private var initialPromptView: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 48))
                        .foregroundColor(DesignTokens.rose)

                    Text("Share a memory")
                        .font(.title2.bold())
                        .foregroundColor(DesignTokens.textPrimary)

                    Text("What's a moment with \(recipientName) that means a lot to you?")
                        .font(.body)
                        .foregroundColor(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                .padding(.top, 20)

                // Memory input
                VStack(alignment: .leading, spacing: 8) {
                    TextEditor(text: $initialPrompt)
                        .font(.body)
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.rose)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 150)
                        .padding(12)
                        .background(DesignTokens.cardBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(DesignTokens.cardBorder, lineWidth: 1)
                        )

                    Text("\(initialPrompt.count)/500 characters")
                        .font(.caption)
                        .foregroundColor(initialPrompt.count > 500 ? DesignTokens.error : DesignTokens.textTertiary)

                    // Error display
                    if let error = engine.error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(DesignTokens.error)
                            .padding(8)
                            .background(DesignTokens.error.opacity(0.1))
                            .cornerRadius(8)
                    }
                }
                .padding(.horizontal)

                // Example prompts
                VStack(alignment: .leading, spacing: 12) {
                    Text("Need inspiration?")
                        .font(.subheadline.bold())
                        .foregroundColor(DesignTokens.textPrimary)

                    ForEach(examplePrompts, id: \.self) { prompt in
                        Button {
                            initialPrompt = prompt
                        } label: {
                            Text(prompt)
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textPrimary)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(DesignTokens.backgroundSubtle)
                                .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)

                Spacer(minLength: 40)

                // Continue button
                Button {
                    startJourney()
                } label: {
                    HStack {
                        if engine.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        } else {
                            Text("Begin Journey")
                                .font(.headline)
                            Image(systemName: "arrow.right")
                        }
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(canStartJourney ? DesignTokens.rose : DesignTokens.cardBorder)
                    .cornerRadius(12)
                }
                .disabled(!canStartJourney || engine.isLoading)
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
        }
    }

    private var canStartJourney: Bool {
        !initialPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && initialPrompt.count <= 500
    }

    private var examplePrompts: [String] {
        switch selectedOccasion {
        case .birthday:
            return [
                "The time we surprised them with a trip and they couldn't stop smiling",
                "How they always know exactly what to say when I'm having a bad day"
            ]
        case .anniversary:
            return [
                "The moment I knew they were the one",
                "Our first adventure together that set the tone for everything after"
            ]
        case .thankYou:
            return [
                "When they dropped everything to help me during a tough time",
                "The small daily things they do that make such a big difference"
            ]
        case .iLoveYou:
            return [
                "The way they look at me that makes everything feel okay",
                "A quiet moment together that I'll never forget"
            ]
        default:
            return [
                "A moment that changed our relationship",
                "Something they do that always makes me smile"
            ]
        }
    }

    // MARK: - Phase 3: Journey

    private var journeyView: some View {
        Group {
            if engine.session.isComplete {
                // Show confirmation view when story is complete
                StoryConfirmationView(
                    engine: engine,
                    creationNoun: creationNoun,
                    onContinue: completeJourney
                )
            } else {
                // Show adaptive conversation during story collection
                AdaptiveConversationView(engine: engine)
            }
        }
    }

    // MARK: - Navigation

    private func continueToInitialPrompt() {
        let styleValue: String? = shouldShowStyleSelection ? selectedStyle.rawValue : nil
        engine.updateBasics(
            recipientName: recipientName,
            occasion: selectedOccasion.rawValue,
            style: styleValue
        )
        withAnimation {
            phase = .initialPrompt
        }
    }

    private func startJourney() {
        Task {
            do {
                try await engine.startSession(initialPrompt: initialPrompt)
                withAnimation {
                    phase = .journey
                }
            } catch {
                // Error displayed in engine.error
            }
        }
    }

    private func goBack() {
        withAnimation {
            switch phase {
            case .basics:
                break
            case .initialPrompt:
                phase = .basics
            case .journey:
                if engine.session.currentTurn <= 1 {
                    // Can go back to prompt if just started
                    engine.reset()
                    phase = .initialPrompt
                }
                // Otherwise stay in journey (can't go back mid-conversation)
            }
        }
    }

    private func completeJourney() {
        // Build StoryContext from the engine session
        let resolvedInitialPrompt = initialPrompt.isEmpty ? (engine.session.initialPrompt ?? "") : initialPrompt
        let storyContext = StoryContext(
            storyId: engine.session.storyId,
            recipientName: recipientName,
            occasion: selectedOccasion,
            specificMemory: resolvedInitialPrompt,
            memoryAnswers: buildMemoryAnswers(),
            specialPhrases: nil,
            whatMakesThemSpecial: engine.session.soulOfStory,
            style: selectedStyle
        )

        onComplete(storyContext)
    }

    private func buildMemoryAnswers() -> [MemoryAnswer] {
        // Convert V2 messages to MemoryAnswers for track creation
        var answers: [MemoryAnswer] = []
        var currentQuestion: String? = nil
        var questionIndex = 0

        for message in engine.session.messages {
            if message.role == .ai {
                currentQuestion = message.content
            } else if message.role == .user, let question = currentQuestion {
                questionIndex += 1
                answers.append(MemoryAnswer(
                    questionId: "q\(questionIndex)",  // Backend expects maxLength: 20
                    question: question,
                    answer: message.content
                ))
                currentQuestion = nil
            }
        }

        return answers
    }
}
