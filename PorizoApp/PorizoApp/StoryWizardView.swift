//
//  StoryWizardView.swift
//  PorizoApp
//
//  Guided wizard for capturing the emotional essence of a memory
//  to create personalized songs.
//

import SwiftUI

/// The main story wizard that guides users through memory extraction
struct StoryWizardView: View {
    let apiClient: APIClient
    let onComplete: (StoryContext) -> Void
    let onCancel: () -> Void

    // MARK: - Wizard State

    @State private var currentStep: WizardStep = .who
    @State private var storyContext = StoryContextBuilder()

    // Step 1: Who
    @State private var recipientName = ""

    // Step 2: Occasion
    @State private var selectedOccasion: Occasion = .birthday

    // Step 3: Memory
    @State private var specificMemory = ""

    // Step 4: AI Questions
    @State private var memoryQuestions: [MemoryQuestion] = []
    @State private var memoryAnswers: [String: String] = [:]
    @State private var isLoadingQuestions = false
    @State private var questionsError: String?

    // Step 5: Nicknames
    @State private var specialPhrases = ""

    // Step 6: What makes them special
    @State private var whatMakesThemSpecial = ""

    // Step 7: Style
    @State private var selectedStyle: MusicStyle = .pop

    // Error handling
    @State private var showingError = false
    @State private var errorMessage = ""

    enum WizardStep: Int, CaseIterable {
        case who = 1
        case occasion = 2
        case memory = 3
        case aiQuestions = 4
        case nicknames = 5
        case whatMakesSpecial = 6
        case review = 7

        var title: String {
            switch self {
            case .who: return "Who"
            case .occasion: return "Occasion"
            case .memory: return "Memory"
            case .aiQuestions: return "Tell Me More"
            case .nicknames: return "Nicknames"
            case .whatMakesSpecial: return "Special"
            case .review: return "Review"
            }
        }

        var isSkippable: Bool {
            switch self {
            case .who, .occasion, .memory, .aiQuestions, .review:
                return false
            case .nicknames, .whatMakesSpecial:
                return true
            }
        }
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Progress indicator
                progressBar

                // Step content
                stepContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Navigation buttons
                navigationButtons
            }
            .navigationTitle(currentStep.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Progress Bar

    private var progressBar: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color.gray.opacity(0.2))
                    .frame(height: 4)

                Rectangle()
                    .fill(Color.blue)
                    .frame(width: geometry.size.width * progressPercentage, height: 4)
                    .animation(.easeInOut(duration: 0.3), value: currentStep)
            }
        }
        .frame(height: 4)
    }

    private var progressPercentage: CGFloat {
        CGFloat(currentStep.rawValue) / CGFloat(WizardStep.allCases.count)
    }

    // MARK: - Step Content

    @ViewBuilder
    private var stepContent: some View {
        ScrollView {
            switch currentStep {
            case .who:
                whoStep
            case .occasion:
                occasionStep
            case .memory:
                memoryStep
            case .aiQuestions:
                aiQuestionsStep
            case .nicknames:
                nicknamesStep
            case .whatMakesSpecial:
                whatMakesSpecialStep
            case .review:
                reviewStep
            }
        }
    }

    // MARK: - Step 1: Who

    private var whoStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Who is this song for?")
                .font(.title2)
                .fontWeight(.bold)

            TextField("Enter their name", text: $recipientName)
                .textFieldStyle(.roundedBorder)
                .font(.body)

            Text("e.g., \"Mom\", \"My love\", \"Best friend Jake\"")
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()
        }
        .padding()
    }

    // MARK: - Step 2: Occasion

    private var occasionStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("What's the occasion?")
                .font(.title2)
                .fontWeight(.bold)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                ForEach(Occasion.allCases) { occasion in
                    Button {
                        selectedOccasion = occasion
                    } label: {
                        VStack(spacing: 8) {
                            Text(occasion.emoji)
                                .font(.system(size: 32))
                            Text(occasion.displayName)
                                .font(.caption)
                                .foregroundColor(selectedOccasion == occasion ? .white : .primary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(selectedOccasion == occasion ? Color.blue : Color.gray.opacity(0.1))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Step 3: Memory (THE HEART)

    private var memoryStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("What's the ONE memory you want this song to capture?")
                .font(.title2)
                .fontWeight(.bold)

            TextEditor(text: $specificMemory)
                .frame(minHeight: 120)
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                )

            VStack(alignment: .leading, spacing: 8) {
                Text("Examples:")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text("\"The day we met at the coffee shop\"")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .italic()

                Text("\"When you held my hand at the hospital\"")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .italic()

                Text("\"The night we danced in the rain\"")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .italic()
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Step 4: AI Questions

    private var aiQuestionsStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            if isLoadingQuestions {
                VStack(spacing: 16) {
                    Spacer()
                    ProgressView()
                        .scaleEffect(1.2)
                    Text("Let me think of some questions about that moment...")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else if let error = questionsError {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 40))
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Try Again") {
                        loadQuestions()
                    }
                    .buttonStyle(.bordered)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                Text("Tell me more about \"\(specificMemory.prefix(30))...\"")
                    .font(.title3)
                    .fontWeight(.semibold)

                ForEach(memoryQuestions) { question in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(question.question)
                            .font(.body)
                            .fontWeight(.medium)

                        TextField(question.placeholder, text: Binding(
                            get: { memoryAnswers[question.id] ?? "" },
                            set: { memoryAnswers[question.id] = $0 }
                        ))
                        .textFieldStyle(.roundedBorder)
                    }
                }
            }

            Spacer()
        }
        .padding()
        .onAppear {
            if memoryQuestions.isEmpty && !isLoadingQuestions {
                loadQuestions()
            }
        }
    }

    // MARK: - Step 5: Nicknames

    private var nicknamesStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Any nicknames or inside jokes?")
                .font(.title2)
                .fontWeight(.bold)

            TextField("Enter nicknames or phrases", text: $specialPhrases)
                .textFieldStyle(.roundedBorder)

            Text("e.g., \"Sunshine\", \"My rock\", \"Partner in crime\"")
                .font(.caption)
                .foregroundColor(.secondary)

            Text("These will be woven naturally into the lyrics")
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()
        }
        .padding()
    }

    // MARK: - Step 6: What Makes Them Special

    private var whatMakesSpecialStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("What makes \(recipientName) special to you?")
                .font(.title2)
                .fontWeight(.bold)

            TextEditor(text: $whatMakesThemSpecial)
                .frame(minHeight: 100)
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                )

            Text("e.g., \"Their laugh fills every room\", \"They never gave up on me\"")
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()
        }
        .padding()
    }

    // MARK: - Step 7: Review

    private var reviewStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Ready to create your song?")
                .font(.title2)
                .fontWeight(.bold)

            VStack(alignment: .leading, spacing: 16) {
                reviewRow(label: "For", value: recipientName)
                reviewRow(label: "Occasion", value: "\(selectedOccasion.displayName) \(selectedOccasion.emoji)")
                reviewRow(label: "Memory", value: specificMemory)

                // Style picker
                HStack {
                    Text("Style")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Spacer()
                    Picker("Style", selection: $selectedStyle) {
                        ForEach(MusicStyle.allCases) { style in
                            Text(style.displayName).tag(style)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.gray.opacity(0.1))
            )

            Spacer()
        }
        .padding()
        .onAppear {
            // Set default style based on occasion
            selectedStyle = suggestedStyle(for: selectedOccasion)
        }
    }

    private func reviewRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)
            Text(value)
                .font(.body)
                .lineLimit(2)
        }
    }

    // MARK: - Navigation Buttons

    private var navigationButtons: some View {
        HStack(spacing: 16) {
            // Back button
            if currentStep != .who {
                Button {
                    goBack()
                } label: {
                    HStack {
                        Image(systemName: "chevron.left")
                        Text("Back")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                }
                .buttonStyle(.bordered)
            }

            // Skip button (for optional steps)
            if currentStep.isSkippable {
                Button {
                    goNext()
                } label: {
                    Text("Skip")
                        .frame(maxWidth: .infinity)
                        .padding()
                }
                .buttonStyle(.bordered)
            }

            // Next/Create button
            Button {
                if currentStep == .review {
                    createSong()
                } else {
                    goNext()
                }
            } label: {
                HStack {
                    if currentStep == .review {
                        Image(systemName: "wand.and.stars")
                        Text("Create My Song")
                    } else {
                        Text("Next")
                        Image(systemName: "chevron.right")
                    }
                }
                .frame(maxWidth: .infinity)
                .padding()
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canProceed)
        }
        .padding()
    }

    // MARK: - Navigation Logic

    private var canProceed: Bool {
        switch currentStep {
        case .who:
            return !recipientName.trimmingCharacters(in: .whitespaces).isEmpty
        case .occasion:
            return true
        case .memory:
            return specificMemory.trimmingCharacters(in: .whitespaces).count >= 10
        case .aiQuestions:
            // Allow proceeding even if questions failed (fallback to defaults on backend)
            return !isLoadingQuestions
        case .nicknames, .whatMakesSpecial:
            return true
        case .review:
            return true
        }
    }

    private func goNext() {
        guard let nextStep = WizardStep(rawValue: currentStep.rawValue + 1) else {
            return
        }
        withAnimation {
            currentStep = nextStep
        }
    }

    private func goBack() {
        guard let prevStep = WizardStep(rawValue: currentStep.rawValue - 1) else {
            return
        }
        withAnimation {
            currentStep = prevStep
        }
    }

    // MARK: - API Calls

    private func loadQuestions() {
        isLoadingQuestions = true
        questionsError = nil

        Task {
            do {
                let response = try await apiClient.generateMemoryQuestions(
                    memory: specificMemory,
                    occasion: selectedOccasion.rawValue,
                    recipientName: recipientName
                )

                await MainActor.run {
                    memoryQuestions = response.questions
                    isLoadingQuestions = false
                }
            } catch {
                await MainActor.run {
                    questionsError = "Couldn't generate questions. You can still proceed."
                    isLoadingQuestions = false
                    // Provide default questions as fallback
                    memoryQuestions = [
                        MemoryQuestion(id: "q1", question: "What were you feeling in that moment?", placeholder: "e.g., Pure joy, peaceful, overwhelmed with love..."),
                        MemoryQuestion(id: "q2", question: "What details do you remember most vividly?", placeholder: "e.g., The way they smiled, the sounds around you..."),
                        MemoryQuestion(id: "q3", question: "How did this moment end?", placeholder: "e.g., We laughed together, we made a promise...")
                    ]
                }
            }
        }
    }

    private func createSong() {
        // Build the story context
        let answers = memoryQuestions.compactMap { question -> MemoryAnswer? in
            guard let answer = memoryAnswers[question.id], !answer.isEmpty else { return nil }
            return MemoryAnswer(questionId: question.id, question: question.question, answer: answer)
        }

        let context = StoryContext(
            recipientName: recipientName,
            occasion: selectedOccasion,
            specificMemory: specificMemory,
            memoryAnswers: answers,
            specialPhrases: specialPhrases.isEmpty ? nil : specialPhrases,
            whatMakesThemSpecial: whatMakesThemSpecial.isEmpty ? nil : whatMakesThemSpecial,
            style: selectedStyle
        )

        onComplete(context)
    }

    // MARK: - Style Suggestion

    private func suggestedStyle(for occasion: Occasion) -> MusicStyle {
        switch occasion {
        case .birthday: return .pop
        case .anniversary: return .soul
        case .wedding: return .acoustic
        case .thankYou: return .folk
        case .iLoveYou: return .rnb
        case .graduation: return .pop
        case .apology: return .acoustic
        case .encouragement: return .soul
        case .celebration: return .afrobeats
        case .custom: return .pop
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
