//
//  StoryWizardView.swift
//  PorizoApp
//
//  Single-page form for capturing song details.
//  Card-based sections with horizontal pill selectors.
//  Light rose theme.
//

import SwiftUI

// Reference DesignTokens from MainTabView.swift

// MARK: - Reusable Form Components

/// Form section card with title, optional helper button, and character count
struct FormSectionCard<Content: View>: View {
    let title: String
    var characterCount: Int? = nil
    var maxCharacters: Int? = nil
    var helperButtonTitle: String? = nil
    var helperButtonAction: (() -> Void)? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header row
            HStack {
                Text(title)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                // Character count
                if let count = characterCount, let max = maxCharacters {
                    Text("\(count)/\(max)")
                        .font(.caption)
                        .foregroundColor(count > max ? DesignTokens.error : DesignTokens.textTertiary)
                }
            }

            // Helper button if provided
            if let buttonTitle = helperButtonTitle, let action = helperButtonAction {
                Button(action: action) {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles")
                            .font(.caption)
                        Text(buttonTitle)
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(DesignTokens.rose)
                }
            }

            content
        }
        .padding(16)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(DesignTokens.cardBorder, lineWidth: 1)
        )
    }
}

/// Minimal text field for form sections - full width with good contrast
struct FormTextField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        TextField(placeholder, text: $text)
            .font(.body)
            .foregroundColor(DesignTokens.textPrimary)
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Color.white)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.cardBorder, lineWidth: 1)
            )
    }
}

/// Multiline text area for form sections - full width with good contrast
struct FormTextArea: View {
    let placeholder: String
    @Binding var text: String
    var minHeight: CGFloat = 80

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .font(.body)
                .foregroundColor(DesignTokens.textPrimary)
                .frame(maxWidth: .infinity, minHeight: minHeight)
                .padding(12)
                .scrollContentBackground(.hidden)
                .background(Color.white)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(DesignTokens.cardBorder, lineWidth: 1)
                )

            if text.isEmpty {
                Text(placeholder)
                    .font(.body)
                    .foregroundColor(Color(hex: "#9ca3af")) // Darker gray for better contrast
                    .padding(.horizontal, 16)
                    .padding(.vertical, 20)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// Horizontal scrollable chip selector (style pills)
struct ChipSelector<Item: Hashable & Identifiable>: View {
    let items: [Item]
    @Binding var selection: Item
    let labelProvider: (Item) -> String
    var showRefreshButton: Bool = false
    var onRefresh: (() -> Void)? = nil

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Optional refresh button
                if showRefreshButton, let refresh = onRefresh {
                    Button(action: refresh) {
                        Image(systemName: "arrow.clockwise")
                            .font(.subheadline)
                            .foregroundColor(DesignTokens.textSecondary)
                            .frame(width: 36, height: 36)
                            .background(DesignTokens.backgroundSubtle)
                            .cornerRadius(18)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .stroke(DesignTokens.cardBorder, lineWidth: 1)
                            )
                    }
                }

                ForEach(items) { item in
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            selection = item
                        }
                    } label: {
                        Text(labelProvider(item))
                            .font(.subheadline)
                            .fontWeight(selection == item ? .semibold : .regular)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 18)
                                    .fill(selection == item ? DesignTokens.rose : DesignTokens.backgroundSubtle)
                            )
                            .foregroundColor(selection == item ? .white : DesignTokens.textPrimary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .stroke(selection == item ? Color.clear : DesignTokens.cardBorder, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Toggle row for form options
struct FormToggleRow: View {
    let title: String
    @Binding var isOn: Bool

    var body: some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
            Spacer()
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(DesignTokens.rose)
        }
    }
}

// Keep legacy components for backward compatibility

/// Card container for wizard input sections
struct WizardInputCard<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                if let subtitle = subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }

            content
        }
        .padding(16)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .cardShadow()
    }
}

/// Text field with character count
struct CharacterCountTextField: View {
    let placeholder: String
    @Binding var text: String
    var maxLength: Int = 50
    var minHeight: CGFloat? = nil

    private var isMultiline: Bool { minHeight != nil }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if isMultiline {
                FormTextArea(placeholder: placeholder, text: $text, minHeight: minHeight ?? 80)
            } else {
                FormTextField(placeholder: placeholder, text: $text)
            }

            Text("\(text.count)/\(maxLength)")
                .font(.caption2)
                .foregroundColor(text.count > maxLength ? DesignTokens.error : DesignTokens.textTertiary)
        }
        .onChange(of: text) { _, newValue in
            if newValue.count > maxLength {
                text = String(newValue.prefix(maxLength))
            }
        }
    }
}

/// Horizontal scrollable pill selector
struct HorizontalPillSelector<Item: Hashable & Identifiable>: View {
    let items: [Item]
    @Binding var selection: Item
    let labelProvider: (Item) -> String
    var emojiProvider: ((Item) -> String)? = nil

    var body: some View {
        ChipSelector(items: items, selection: $selection, labelProvider: labelProvider)
    }
}

/// Wizard step tab indicator (legacy - kept for compatibility)
struct WizardStepTabs: View {
    let steps: [String]
    let currentStep: Int
    let onStepTap: (Int) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    Button {
                        if index < currentStep {
                            onStepTap(index)
                        }
                    } label: {
                        VStack(spacing: 6) {
                            ZStack {
                                Circle()
                                    .fill(stepColor(for: index))
                                    .frame(width: 28, height: 28)

                                if index < currentStep {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundColor(.white)
                                } else {
                                    Text("\(index + 1)")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                        .foregroundColor(index == currentStep ? .white : DesignTokens.textSecondary)
                                }
                            }

                            Text(step)
                                .font(.caption2)
                                .fontWeight(index == currentStep ? .semibold : .regular)
                                .foregroundColor(index <= currentStep ? DesignTokens.textPrimary : DesignTokens.textTertiary)
                        }
                        .frame(width: 60)
                    }
                    .buttonStyle(.plain)
                    .disabled(index > currentStep)

                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(index < currentStep ? DesignTokens.rose : DesignTokens.cardBorder)
                            .frame(width: 20, height: 2)
                            .offset(y: -8)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 12)
        .background(DesignTokens.cardBackground)
    }

    private func stepColor(for index: Int) -> Color {
        if index < currentStep {
            return DesignTokens.success
        } else if index == currentStep {
            return DesignTokens.rose
        } else {
            return DesignTokens.cardBorder
        }
    }
}

// MARK: - Story Wizard View (Streamlined 3-Step)

/// Streamlined 3-step wizard for capturing song details
struct StoryWizardView: View {
    let apiClient: APIClient
    let onComplete: (StoryContext) -> Void
    let onCancel: () -> Void

    // MARK: - Wizard State

    @State private var currentStep: Int = 0

    // Step 0: Basics (Who + Occasion + Style)
    @State private var recipientName = ""
    @State private var selectedOccasion: Occasion = .birthday
    @State private var selectedStyle: MusicStyle = .pop

    // Step 1: Story/Memory
    @State private var storyDescription = ""

    // Step 2: Extras
    @State private var specialPhrases = ""
    @State private var whatMakesThemSpecial = ""

    // Error handling
    @State private var showingError = false
    @State private var errorMessage = ""

    private let steps = ["Basics", "Story", "Preview"]

    // AI-powered conversational Q&A state for Story step
    @State private var currentAnswer: String = ""
    @State private var currentAIQuestion: MemoryQuestion? = nil
    @State private var isLoadingQuestion: Bool = false
    @State private var questionError: String? = nil
    @State private var answeredQuestions: [MemoryAnswer] = []
    @State private var hasMoreQuestions: Bool = true

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Step tabs at top
                WizardStepTabs(
                    steps: steps,
                    currentStep: currentStep,
                    onStepTap: { step in
                        withAnimation {
                            currentStep = step
                        }
                    }
                )

                // Step content
                ScrollView {
                    stepContent
                        .padding(16)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DesignTokens.backgroundSubtle)

                // Bottom action button
                actionButton
            }
            .navigationTitle("Create Song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundColor(DesignTokens.textSecondary)
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Step Content

    @ViewBuilder
    private var stepContent: some View {
        switch currentStep {
        case 0:
            basicsStep
        case 1:
            conversationalStoryStep
        case 2:
            previewStep
        default:
            EmptyView()
        }
    }

    // MARK: - Step 0: Basics (Who + Occasion + Style)

    private var basicsStep: some View {
        VStack(spacing: 16) {
            // Who is this for?
            FormSectionCard(
                title: "Who is this song for?",
                characterCount: recipientName.count,
                maxCharacters: 40
            ) {
                FormTextField(
                    placeholder: "e.g., Mom, My love, Best friend Jake",
                    text: $recipientName
                )
            }

            // Occasion
            FormSectionCard(title: "Occasion") {
                ChipSelector(
                    items: Occasion.allCases,
                    selection: $selectedOccasion,
                    labelProvider: { $0.displayName }
                )
            }

            // Music Style
            FormSectionCard(
                title: "Music Style",
                helperButtonTitle: "Random",
                helperButtonAction: { randomizeStyle() }
            ) {
                ChipSelector(
                    items: Array(MusicStyle.allCases.prefix(8)),
                    selection: $selectedStyle,
                    labelProvider: { $0.displayName },
                    showRefreshButton: true,
                    onRefresh: { randomizeStyle() }
                )
            }

            Spacer()
        }
    }

    // MARK: - Step 1: Conversational Story Builder (AI-Powered)

    private var conversationalStoryStep: some View {
        VStack(spacing: 16) {
            // Main accumulated story area - shows everything collected so far
            FormSectionCard(
                title: "Your Song Story",
                characterCount: storyDescription.count,
                maxCharacters: 2000
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Watch your song story build as you answer questions")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)

                    // The live-building story area
                    FormTextArea(
                        placeholder: "Your story will appear here as you answer the questions below...",
                        text: $storyDescription,
                        minHeight: 200
                    )
                }
            }

            // AI-powered question card
            if isLoadingQuestion {
                loadingQuestionCard
            } else if let error = questionError {
                errorQuestionCard(error: error)
            } else if let question = currentAIQuestion {
                aiQuestionCard(question: question)
            } else if !hasMoreQuestions || storyDescription.count >= 100 {
                storyCompleteCard
            } else {
                // Initial state - prompt to start
                startStoryCard
            }

            Spacer()
        }
        .onAppear {
            // Fetch first question when entering Story step
            if currentAIQuestion == nil && !isLoadingQuestion && storyDescription.isEmpty {
                fetchNextQuestion()
            }
        }
    }

    // Loading state while AI generates next question
    private var loadingQuestionCard: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(DesignTokens.rose)
                .scaleEffect(1.2)

            Text("AI is thinking of the next question...")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(32)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(DesignTokens.cardBorder, lineWidth: 1)
        )
    }

    // Error state
    private func errorQuestionCard(error: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundColor(DesignTokens.warning)

            Text(error)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                fetchNextQuestion()
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundColor(DesignTokens.rose)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(DesignTokens.cardBorder, lineWidth: 1)
        )
    }

    // Initial prompt to start answering
    private var startStoryCard: some View {
        VStack(spacing: 16) {
            Image(systemName: "text.bubble.fill")
                .font(.system(size: 40))
                .foregroundColor(DesignTokens.rose)

            Text("Let's write your song!")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text("I'll ask you questions to understand the story you want to tell. Your answers will shape the lyrics.")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                fetchNextQuestion()
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                    Text("Start Writing")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(DesignTokens.rose)
                .cornerRadius(10)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(DesignTokens.cardBorder, lineWidth: 1)
        )
    }

    // The AI-generated question card
    private func aiQuestionCard(question: MemoryQuestion) -> some View {
        FormSectionCard(title: question.question) {
            VStack(spacing: 12) {
                FormTextArea(
                    placeholder: question.placeholder,
                    text: $currentAnswer,
                    minHeight: 100
                )

                // Done button - submit answer
                Button {
                    submitAnswer(for: question)
                } label: {
                    HStack {
                        Text("Done")
                        Image(systemName: "checkmark")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(currentAnswer.trimmingCharacters(in: .whitespaces).isEmpty ? DesignTokens.textTertiary : DesignTokens.rose)
                    .cornerRadius(10)
                }
                .disabled(currentAnswer.trimmingCharacters(in: .whitespaces).isEmpty)

                // Skip or finish options
                HStack(spacing: 16) {
                    Button {
                        skipCurrentQuestion()
                    } label: {
                        Text("Skip this question")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                    }

                    if storyDescription.count >= 50 {
                        Text("•")
                            .foregroundColor(DesignTokens.textTertiary)

                        Button {
                            finishQuestions()
                        } label: {
                            Text("I'm done")
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }
                }
            }
        }
    }

    // Shown when story is complete
    private var storyCompleteCard: some View {
        VStack(spacing: 16) {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.success)

                Text("Story Complete!")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Review your story above and edit if needed, then continue to preview your song.")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.cardBorder, lineWidth: 1)
            )

            // Option to add more
            Button {
                hasMoreQuestions = true
                fetchNextQuestion()
            } label: {
                HStack {
                    Image(systemName: "plus.circle")
                    Text("Add more details")
                }
                .font(.subheadline)
                .foregroundColor(DesignTokens.rose)
            }
        }
    }

    // MARK: - AI Question Logic

    /// Fetch the next contextual question from AI
    private func fetchNextQuestion() {
        isLoadingQuestion = true
        questionError = nil

        Task {
            do {
                let response = try await apiClient.generateMemoryQuestions(
                    memory: storyDescription,
                    occasion: selectedOccasion.rawValue,
                    recipientName: recipientName.isEmpty ? nil : recipientName
                )

                await MainActor.run {
                    isLoadingQuestion = false
                    if let firstQuestion = response.questions.first {
                        currentAIQuestion = firstQuestion
                    } else {
                        // No more questions - story is complete
                        hasMoreQuestions = false
                        currentAIQuestion = nil
                    }
                }
            } catch {
                await MainActor.run {
                    isLoadingQuestion = false
                    questionError = "Couldn't generate question. Please try again."
                    print("Question generation error: \(error)")
                }
            }
        }
    }

    /// Submit the current answer and fetch next question
    private func submitAnswer(for question: MemoryQuestion) {
        let trimmedAnswer = currentAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedAnswer.isEmpty else { return }

        // Store the answer for track creation
        let memoryAnswer = MemoryAnswer(
            questionId: question.id,
            question: question.question,
            answer: trimmedAnswer
        )
        answeredQuestions.append(memoryAnswer)

        // Append to the visible story area
        if storyDescription.isEmpty {
            storyDescription = trimmedAnswer
        } else {
            storyDescription += "\n\n" + trimmedAnswer
        }

        // Clear and fetch next question
        currentAnswer = ""
        currentAIQuestion = nil
        fetchNextQuestion()
    }

    /// Skip the current question and get next one
    private func skipCurrentQuestion() {
        currentAnswer = ""
        currentAIQuestion = nil
        fetchNextQuestion()
    }

    /// User indicates they're done answering
    private func finishQuestions() {
        hasMoreQuestions = false
        currentAIQuestion = nil
        currentAnswer = ""
    }

    // MARK: - Step 2: Preview & Edit

    private var previewStep: some View {
        VStack(spacing: 16) {
            // Song summary header
            VStack(spacing: 8) {
                Text("🎵")
                    .font(.system(size: 48))

                Text("Song for \(recipientName)")
                    .font(.title2.weight(.bold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("\(selectedOccasion.emoji) \(selectedOccasion.displayName) • \(selectedStyle.displayName)")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(occasionGradient(for: selectedOccasion).opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.cardBorder, lineWidth: 1)
            )

            // Editable story content
            FormSectionCard(
                title: "Story & Lyrics Content",
                characterCount: storyDescription.count,
                maxCharacters: 2000
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Review and edit your song content")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)

                    FormTextArea(
                        placeholder: "Your story content...",
                        text: $storyDescription,
                        minHeight: 200
                    )
                }
            }

            // Optional extras
            FormSectionCard(title: "Special Touches (Optional)") {
                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Nicknames / Inside Jokes")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                        FormTextField(
                            placeholder: "e.g., Sunshine, My rock",
                            text: $specialPhrases
                        )
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("What makes them special")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                        FormTextField(
                            placeholder: "e.g., Their laugh fills every room",
                            text: $whatMakesThemSpecial
                        )
                    }
                }
            }

            Spacer()
        }
    }

    // MARK: - Action Button

    private var actionButton: some View {
        Button {
            if currentStep == steps.count - 1 {
                createSong()
            } else {
                goNext()
            }
        } label: {
            HStack {
                if currentStep == steps.count - 1 {
                    Image(systemName: "wand.and.stars")
                }
                Text(actionButtonText)
                if currentStep < steps.count - 1 {
                    Image(systemName: "arrow.right")
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(canProceed ? DesignTokens.rose : DesignTokens.textTertiary)
            .foregroundColor(.white)
            .cornerRadius(14)
        }
        .disabled(!canProceed)
        .padding(16)
        .background(DesignTokens.cardBackground)
    }

    // MARK: - Navigation Logic

    private var canProceed: Bool {
        switch currentStep {
        case 0: // Basics - need recipient name
            return !recipientName.trimmingCharacters(in: .whitespaces).isEmpty
        case 1: // Story - need some content (at least answered one question or typed directly)
            return storyDescription.trimmingCharacters(in: .whitespaces).count >= 20
        case 2: // Preview - always can proceed to create
            return true
        default:
            return true
        }
    }

    private var actionButtonText: String {
        switch currentStep {
        case 0:
            return "Continue"
        case 1:
            return storyDescription.isEmpty ? "Answer questions first" : "Preview Song"
        case 2:
            return "Create My Song"
        default:
            return "Continue"
        }
    }

    private func goNext() {
        if currentStep < steps.count - 1 {
            withAnimation {
                currentStep += 1
            }
        }
    }

    // MARK: - Actions

    private func randomizeStyle() {
        selectedStyle = MusicStyle.allCases.randomElement() ?? .pop
    }

    private func generateRandomStory() {
        let samples = [
            "The day we met changed everything. I remember your smile and how nervous I was.",
            "You've always been there for me, through every challenge and every celebration.",
            "That summer night under the stars, when we promised to always be there for each other."
        ]
        storyDescription = samples.randomElement() ?? ""
    }

    private func createSong() {
        let context = StoryContext(
            recipientName: recipientName,
            occasion: selectedOccasion,
            specificMemory: storyDescription,
            memoryAnswers: answeredQuestions,  // Pass AI Q&A answers
            specialPhrases: specialPhrases.isEmpty ? nil : specialPhrases,
            whatMakesThemSpecial: whatMakesThemSpecial.isEmpty ? nil : whatMakesThemSpecial,
            style: selectedStyle
        )

        onComplete(context)
    }

    // MARK: - Helpers

    private func occasionGradient(for occasion: Occasion) -> LinearGradient {
        let colors: [Color]
        switch occasion {
        case .birthday:
            colors = [Color(hex: "#ec4899"), Color(hex: "#f472b6")]
        case .anniversary:
            colors = [Color(hex: "#f43f5e"), Color(hex: "#fb7185")]
        case .thankYou:
            colors = [Color(hex: "#f59e0b"), Color(hex: "#fbbf24")]
        case .iLoveYou:
            colors = [Color(hex: "#ef4444"), Color(hex: "#f87171")]
        case .wedding:
            colors = [Color(hex: "#a855f7"), Color(hex: "#c084fc")]
        case .graduation:
            colors = [Color(hex: "#3b82f6"), Color(hex: "#60a5fa")]
        case .encouragement:
            colors = [Color(hex: "#10b981"), Color(hex: "#34d399")]
        case .apology:
            colors = [Color(hex: "#6366f1"), Color(hex: "#818cf8")]
        case .celebration:
            colors = [Color(hex: "#06b6d4"), Color(hex: "#22d3ee")]
        case .custom:
            colors = [DesignTokens.rose, DesignTokens.roseLight]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Legacy Helpers (kept for compatibility)

extension StoryWizardView {
    private func styleIcon(for style: MusicStyle) -> String {
        switch style {
        case .pop: return "sparkles"
        case .soul: return "heart.fill"
        case .rnb: return "waveform"
        case .folk: return "leaf.fill"
        case .acoustic: return "guitars.fill"
        case .afrobeats: return "drum.fill"
        case .rock: return "bolt.fill"
        case .country: return "music.note"
        case .jazz: return "pianokeys"
        case .highlife: return "sun.max.fill"
        case .afropop: return "star.fill"
        case .reggaeton: return "flame.fill"
        case .salsa: return "figure.dance"
        case .bossaNova: return "leaf.circle.fill"
        case .bachata: return "heart.circle.fill"
        case .latinPop: return "guitars.fill"
        }
    }

    private func styleDescription(for style: MusicStyle) -> String {
        switch style {
        case .pop: return "Catchy, upbeat, and universally loved"
        case .soul: return "Deep, emotional, and heartfelt"
        case .rnb: return "Smooth, groovy, and romantic"
        case .folk: return "Warm, storytelling, and intimate"
        case .acoustic: return "Pure, simple, and authentic"
        case .afrobeats: return "Vibrant, rhythmic, and celebratory"
        case .rock: return "Powerful, energetic, and bold"
        case .country: return "Storytelling, heartfelt, and genuine"
        case .jazz: return "Sophisticated, smooth, and timeless"
        case .highlife: return "Uplifting, joyful African rhythms"
        case .afropop: return "Modern African pop fusion"
        case .reggaeton: return "Latin beats with urban flair"
        case .salsa: return "Passionate, dance-ready Latin"
        case .bossaNova: return "Smooth, romantic Brazilian jazz"
        case .bachata: return "Romantic, heartfelt Latin ballad"
        case .latinPop: return "Catchy Latin pop vibes"
        }
    }
}

// MARK: - Story Context

/// The complete story context gathered from the wizard
struct StoryContext {
    let recipientName: String
    let occasion: Occasion
    let specificMemory: String
    let memoryAnswers: [MemoryAnswer]
    let specialPhrases: String?
    let whatMakesThemSpecial: String?
    let style: MusicStyle
}

/// Helper for building story context incrementally
struct StoryContextBuilder {
    var recipientName: String = ""
    var occasion: Occasion = .birthday
    var specificMemory: String = ""
    var memoryAnswers: [MemoryAnswer] = []
    var specialPhrases: String?
    var whatMakesThemSpecial: String?
    var style: MusicStyle = .pop
}

#Preview {
    StoryWizardView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onComplete: { context in
            print("Story context: \(context)")
        },
        onCancel: { }
    )
}
