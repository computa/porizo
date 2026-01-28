//
//  CreateFlowView.swift
//  PorizoApp
//
//  Create flow matching v1.pen steps 07a-07e, 08a/08b, 09a/09b/09c.
//  Velvet & Gold design system with progress dots and centered questions.
//

import SwiftUI

// MARK: - Create Flow View

struct CreateFlowView: View {
    let apiClient: APIClient
    var preselectedOccasion: Occasion?
    var preselectedType: CreationType?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    var variationSourcePoem: Poem?
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    @State private var flowState: CreateFlowState = .typeSelection
    @State private var selectedType: CreationType?

    // Shared flow state (07a-07e)
    @State private var recipientName: String = ""
    @State private var selectedOccasion: Occasion = .birthday
    @State private var selectedStyle: MusicStyle = .pop
    @State private var selectedVoiceMode: VoiceMode = .aiVoice
    @State private var messagePrompt: String = ""
    @State private var customSongRequest: CustomSongRequest?

    // Story engine (09a/09b/09c)
    @StateObject private var storyEngine: V2StoryEngine
    @StateObject private var apiWrapper: APIClientWrapper

    // Song flow state
    @State private var storyContext: StoryContext?
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?
    @State private var currentStoryId: String?
    @State private var initialLyrics: Lyrics?

    // Poem flow state
    @State private var poemStoryId: String?
    @State private var currentPoem: Poem?
    @State private var poemGaps: [StoryPoemGap] = []
    @State private var poemGapQuestion: String?

    // UI state
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""
    @State private var showSpeechInput: Bool = false

    private let flowStore = CreateFlowStore.shared

    enum CreateFlowState {
        case typeSelection
        case recipient
        case occasion
        case style
        case voice
        case message
        case createMode
        case storyConversation
        case storyComplete
        case creatingTrack
        case lyricsReview
        case trackPlayer
        case poemCreating
        case poemGap
        case poemPreview
    }

    enum CreationType {
        case song
        case poem
    }

    init(
        apiClient: APIClient,
        preselectedOccasion: Occasion? = nil,
        preselectedType: CreationType? = nil,
        resumeTrackId: String? = nil,
        resumeVersionNum: Int? = nil,
        variationSourcePoem: Poem? = nil,
        onComplete: @escaping (String, Int) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.apiClient = apiClient
        self.preselectedOccasion = preselectedOccasion
        self.preselectedType = preselectedType
        self.resumeTrackId = resumeTrackId
        self.resumeVersionNum = resumeVersionNum
        self.variationSourcePoem = variationSourcePoem
        self.onComplete = onComplete
        self.onCancel = onCancel
        _storyEngine = StateObject(wrappedValue: V2StoryEngine(apiClient: apiClient))
        _apiWrapper = StateObject(wrappedValue: APIClientWrapper(client: apiClient))
    }

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                if showsHeader {
                    createFlowHeader
                }

                flowContent
            }
        }
        .alert("Error", isPresented: $showError) {
            Button("Try Again") {
                if selectedType == .poem {
                    flowState = .poemCreating
                } else {
                    flowState = .storyConversation
                }
            }
            Button("Start Over") {
                clearAllState()
                flowState = .typeSelection
            }
        } message: {
            Text(errorMessage)
        }
        .fullScreenCover(isPresented: $showSpeechInput) {
            SpeechInputView(
                storyId: storyEngine.session.storyId ?? "",
                onTranscription: { text in
                    messagePrompt = text
                    showSpeechInput = false
                },
                onCancel: {
                    showSpeechInput = false
                }
            )
            .environmentObject(apiWrapper)
        }
        .onAppear(perform: initializeFlow)
        .onChange(of: preselectedType) { _, _ in
            _ = applyPreselectedTypeIfNeeded()
        }
        .onChange(of: flowState) { _, _ in
            persistResumeState()
        }
        .onChange(of: currentTrackId) { _, _ in
            persistResumeState()
        }
        .onChange(of: currentVersionNum) { _, _ in
            persistResumeState()
        }
        .onChange(of: poemStoryId) { _, _ in
            persistResumeState()
        }
        .onChange(of: storyEngine.session.isComplete) { _, isComplete in
            if isComplete && flowState == .storyConversation {
                flowState = .storyComplete
            }
        }
    }

    // MARK: - Flow Content

    @ViewBuilder
    private var flowContent: some View {
        switch flowState {
        case .typeSelection:
            typeSelectionView

        case .recipient:
            recipientStepView

        case .occasion:
            occasionStepView

        case .style:
            styleStepView

        case .voice:
            VoiceModeSelectionView(
                apiClient: apiClient,
                onSelect: { mode in
                    selectedVoiceMode = mode
                    flowState = .message
                },
                onBack: {
                    flowState = .style
                }
            )

        case .message:
            messageStepView

        case .createMode:
            CustomCreateView(
                apiClient: apiClient,
                onCreateSong: { request in
                    customSongRequest = request
                    Task { await startStoryConversation() }
                },
                onCancel: {
                    flowState = .message
                },
                contentKind: selectedType == .poem ? .poem : .song,
                primaryCtaTitle: createCtaTitle,
                primaryCtaIcon: createCtaIcon
            )
            .environmentObject(apiWrapper)

        case .storyConversation:
            AdaptiveConversationView(engine: storyEngine) {
                clearAllState()
                onCancel()
            }
            .environmentObject(apiWrapper)

        case .storyComplete:
            StoryConfirmationView(
                engine: storyEngine,
                creationNoun: creationNoun,
                onContinue: completeStoryFlow,
                onClose: {
                    clearAllState()
                    onCancel()
                }
            )

        case .creatingTrack:
            if let context = storyContext {
                CreatingTrackView(
                    apiClient: apiClient,
                    storyContext: context,
                    voiceMode: selectedVoiceMode,
                    onTrackCreated: { trackId, versionNum, lyrics in
                        currentTrackId = trackId
                        currentVersionNum = versionNum
                        currentStoryId = context.storyId
                        initialLyrics = lyrics
                        flowState = .lyricsReview
                    },
                    onError: { error in
                        errorMessage = error
                        showError = true
                    },
                    onCancel: {
                        flowState = .storyComplete
                    }
                )
            } else {
                Text("Error: No story context available")
                    .foregroundColor(DesignTokens.error)
                    .onAppear {
                        errorMessage = "Story context was not captured. Please try again."
                        showError = true
                    }
            }

        case .lyricsReview:
            if let trackId = currentTrackId, let versionNum = currentVersionNum, let storyId = currentStoryId {
                LyricsReviewView(
                    apiClient: apiClient,
                    trackId: trackId,
                    versionNum: versionNum,
                    storyId: storyId,
                    initialLyrics: initialLyrics,
                    onApproved: {
                        flowState = .trackPlayer
                    },
                    onBack: {
                        flowState = .createMode
                    }
                )
            } else {
                Text("Error: Missing story context for lyrics.")
                    .foregroundColor(DesignTokens.error)
                    .onAppear {
                        errorMessage = "Story context was not captured. Please try again."
                        showError = true
                    }
            }

        case .trackPlayer:
            if let trackId = currentTrackId, let versionNum = currentVersionNum {
                TrackPlayerFullView(
                    apiClient: apiClient,
                    trackId: trackId,
                    versionNum: versionNum,
                    onDone: {
                        clearAllState()
                        onComplete(trackId, versionNum)
                    },
                    onNewSong: {
                        clearAllState()
                        flowState = .typeSelection
                    }
                )
            }

        case .poemCreating:
            if let storyId = poemStoryId {
                PoemCreatingView(
                    apiClient: apiClient,
                    storyId: storyId,
                    onPoemReady: { poem in
                        currentPoem = poem
                        flowState = .poemPreview
                    },
                    onNeedsDetails: { gaps, question in
                        poemGaps = gaps
                        poemGapQuestion = question
                        flowState = .poemGap
                    },
                    onError: { error in
                        errorMessage = error
                        showError = true
                    },
                    onCancel: {
                        resetPoemState()
                        flowState = .typeSelection
                        clearStoryState()
                        flowStore.clear()
                    }
                )
            } else {
                Text("Error: Missing story session.")
                    .foregroundColor(DesignTokens.error)
                    .onAppear {
                        errorMessage = "Story session could not be found. Please try again."
                        showError = true
                    }
            }

        case .poemGap:
            if let question = poemGapQuestion, let storyId = poemStoryId {
                PoemGapQuestionView(
                    question: question,
                    onSubmit: { detail in
                        Task {
                            do {
                                _ = try await apiClient.addStoryDetails(storyId: storyId, detail: detail)
                                await MainActor.run {
                                    poemGapQuestion = nil
                                    poemGaps = []
                                    flowState = .poemCreating
                                }
                            } catch {
                                await MainActor.run {
                                    errorMessage = error.localizedDescription
                                    showError = true
                                }
                            }
                        }
                    },
                    onCancel: {
                        resetPoemState()
                        flowState = .typeSelection
                        clearStoryState()
                        flowStore.clear()
                    }
                )
            }

        case .poemPreview:
            if let poem = currentPoem {
                PoemPreviewView(
                    poem: poem,
                    onRegenerate: {
                        flowState = .poemCreating
                    },
                    onDone: {
                        resetPoemState()
                        flowState = .typeSelection
                        clearStoryState()
                        flowStore.clear()
                    }
                )
            }
        }
    }

    // MARK: - Header Logic

    private var showsHeader: Bool {
        switch flowState {
        case .typeSelection, .recipient, .occasion, .style, .message:
            return true
        default:
            return false
        }
    }

    private var currentStepIndex: Int {
        switch flowState {
        case .recipient:
            return 0
        case .occasion:
            return 1
        case .style:
            return 2
        case .voice:
            return 3
        case .message:
            return selectedType == .song ? 4 : 3
        default:
            return 0
        }
    }

    private var totalStepCount: Int {
        selectedType == .song ? 5 : 4
    }

    private var canGoBack: Bool {
        switch flowState {
        case .recipient, .occasion, .style, .message:
            return true
        default:
            return false
        }
    }

    private var createFlowHeader: some View {
        HStack {
            if canGoBack {
                Button {
                    handleBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
            } else {
                Color.clear.frame(width: 44, height: 44)
            }

            Spacer()

            progressDots(current: currentStepIndex, total: totalStepCount)

            Spacer()

            Button {
                clearAllState()
                onCancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    private func progressDots(current: Int, total: Int) -> some View {
        HStack(spacing: 8) {
            ForEach(0..<total, id: \.self) { index in
                Circle()
                    .fill(index <= current ? DesignTokens.gold : Color(hex: "#333333"))
                    .frame(width: 8, height: 8)
            }
        }
    }

    // MARK: - Type Selection (v1.pen style)

    private var typeSelectionView: some View {
        VStack(spacing: 0) {
            Spacer()
                .frame(height: 40)

            Text("What would you\nlike to create?")
                .font(DesignTokens.displayFont(size: 36))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 24)

            Spacer()
                .frame(height: 48)

            VStack(spacing: 16) {
                createOptionCard(
                    icon: "music.note",
                    title: "Personalized Song",
                    subtitle: "A custom song created just for them",
                    isSelected: false
                ) {
                    startFlow(.song)
                }

                createOptionCard(
                    icon: "text.book.closed",
                    title: "Custom Poem",
                    subtitle: "Heartfelt words crafted for them",
                    isSelected: false
                ) {
                    startFlow(.poem)
                }
            }
            .padding(.horizontal, 24)

            Spacer()
        }
    }

    // MARK: - Step Views (07a-07e)

    private var recipientStepView: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 40)

            Text("Who are you creating this for?")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Text("Their name")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .padding(.top, 8)

            VStack(spacing: 12) {
                TextField("Enter their name", text: $recipientName)
                    .textFieldStyle(.plain)
                    .padding(16)
                    .background(DesignTokens.surface)
                    .cornerRadius(14)
                    .foregroundColor(DesignTokens.textPrimary)
                    .autocapitalization(.words)
            }
            .padding(.top, 24)
            .padding(.horizontal, 24)

            Spacer()

            VelvetButton("Continue", style: .primary, isDisabled: !canContinueFromRecipient) {
                flowState = .occasion
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    private var occasionStepView: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 24)

            Text("What's the occasion?")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Text("Choose one")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .padding(.top, 8)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(Occasion.allCases) { occasion in
                    occasionButton(occasion)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)

            Spacer()

            VelvetButton("Continue", style: .primary) {
                flowState = .style
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    private var styleStepView: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 24)

            Text("Pick a style")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Text("Choose music style")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .padding(.top, 8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(MusicStyle.allCases) { style in
                        styleButton(style)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
            }

            Spacer()

            VelvetButton("Continue", style: .primary) {
                if selectedType == .song {
                    flowState = .voice
                } else {
                    flowState = .message
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    private var messageStepView: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("Share what you want to say")
                        .font(DesignTokens.displayFont(size: 26, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)

                    Text("Message")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .padding(.top, 12)

                VStack(alignment: .leading, spacing: 8) {
                    ZStack(alignment: .topLeading) {
                        if messagePrompt.isEmpty {
                            Text(messagePlaceholder)
                                .font(DesignTokens.bodyFont(size: 16))
                                .foregroundColor(DesignTokens.textTertiary)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 16)
                        }

                        TextEditor(text: $messagePrompt)
                            .font(DesignTokens.bodyFont(size: 16))
                            .foregroundColor(DesignTokens.textPrimary)
                            .scrollContentBackground(.hidden)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 12)
                            .tint(DesignTokens.gold)
                    }
                    .frame(height: 160)
                    .background(DesignTokens.surface)
                    .cornerRadius(16)

                    HStack {
                        Button {
                            showSpeechInput = true
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "mic.fill")
                                Text("Speak instead")
                            }
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.gold)
                        }
                        .buttonStyle(.plain)

                        Spacer()

                        Text("\(messagePrompt.count)/500")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundColor(messagePrompt.count > 500 ? DesignTokens.error : DesignTokens.textTertiary)
                    }
                }
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Need inspiration?")
                        .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)

                    ForEach(examplePrompts, id: \.self) { prompt in
                        Button {
                            messagePrompt = prompt
                        } label: {
                            Text(prompt)
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundColor(DesignTokens.textPrimary)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(DesignTokens.surface)
                                .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)

                VelvetButton("Continue", style: .primary, isDisabled: !canContinueFromMessage) {
                    flowState = .createMode
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
    }

    // MARK: - Option Card (v1.pen style)

    private func createOptionCard(
        icon: String,
        title: String,
        subtitle: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold.opacity(0.15))
                        .frame(width: 56, height: 56)

                    Image(systemName: icon)
                        .font(.system(size: 24))
                        .foregroundColor(DesignTokens.gold)
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                    Text(subtitle)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(DesignTokens.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .background(DesignTokens.surface)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? DesignTokens.gold : DesignTokens.borderSubtle, lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(subtitle)
    }

    private func occasionButton(_ occasion: Occasion) -> some View {
        Button {
            selectedOccasion = occasion
        } label: {
            HStack {
                Text(occasion.emoji)
                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
            }
            .foregroundColor(selectedOccasion == occasion ? .white : DesignTokens.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(selectedOccasion == occasion ? DesignTokens.gold : DesignTokens.surface)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(selectedOccasion == occasion ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func styleButton(_ style: MusicStyle) -> some View {
        Button {
            selectedStyle = style
        } label: {
            Text(style.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(selectedStyle == style ? .white : DesignTokens.textPrimary)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(selectedStyle == style ? DesignTokens.gold : DesignTokens.surface)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(selectedStyle == style ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private var canContinueFromRecipient: Bool {
        !recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canContinueFromMessage: Bool {
        let trimmed = messagePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed.count <= 500
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

    private var creationNoun: String {
        selectedType == .poem ? "poem" : "song"
    }

    private var messagePlaceholder: String {
        "Write the message for your \(creationNoun)..."
    }

    private var createCtaTitle: String {
        selectedType == .poem ? "Continue" : "Create Song"
    }

    private var createCtaIcon: String {
        selectedType == .poem ? "arrow.right" : "music.note"
    }

    private func handleBack() {
        switch flowState {
        case .recipient:
            flowState = .typeSelection
        case .occasion:
            flowState = .recipient
        case .style:
            flowState = .occasion
        case .message:
            flowState = selectedType == .song ? .voice : .style
        default:
            break
        }
    }

    private func startFlow(_ type: CreationType) {
        selectedType = type
        resetStoryStateKeepingBasics()
        flowState = .recipient
    }

    private func startStoryConversation() async {
        guard canContinueFromMessage else { return }
        errorMessage = ""

        storyEngine.updateBasics(
            recipientName: recipientName,
            occasion: selectedOccasion.rawValue,
            style: selectedStyle.rawValue
        )

        do {
            try await storyEngine.startSession(initialPrompt: messagePrompt)
            await MainActor.run {
                flowState = .storyConversation
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                showError = true
            }
        }
    }

    private func completeStoryFlow() {
        guard let storyId = storyEngine.session.storyId else {
            errorMessage = "Story session could not be found. Please try again."
            showError = true
            return
        }

        let resolvedPrompt = messagePrompt.isEmpty ? (storyEngine.session.initialPrompt ?? "") : messagePrompt
        let context = StoryContext(
            storyId: storyId,
            recipientName: recipientName,
            occasion: selectedOccasion,
            specificMemory: resolvedPrompt,
            memoryAnswers: buildMemoryAnswers(),
            specialPhrases: nil,
            whatMakesThemSpecial: storyEngine.session.soulOfStory,
            style: selectedStyle
        )

        storyContext = context
        currentStoryId = storyId

        if selectedType == .poem {
            poemStoryId = storyId
            flowState = .poemCreating
        } else {
            flowState = .creatingTrack
        }
    }

    private func buildMemoryAnswers() -> [MemoryAnswer] {
        var answers: [MemoryAnswer] = []
        var currentQuestion: String? = nil
        var questionIndex = 0

        for message in storyEngine.session.messages {
            if message.role == .ai {
                currentQuestion = message.content
            } else if message.role == .user, let question = currentQuestion {
                questionIndex += 1
                answers.append(MemoryAnswer(
                    questionId: "q\(questionIndex)",
                    question: question,
                    answer: message.content
                ))
                currentQuestion = nil
            }
        }

        return answers
    }

    private func resetStoryStateKeepingBasics() {
        storyEngine.reset()
        messagePrompt = ""
        customSongRequest = nil
    }

    private func clearStoryState() {
        storyEngine.reset()
        V2SessionStore.shared.clear()
        messagePrompt = ""
        customSongRequest = nil
        storyContext = nil
        currentStoryId = nil
    }

    private func resetPoemState() {
        poemStoryId = nil
        currentPoem = nil
        poemGaps = []
        poemGapQuestion = nil
    }

    private func clearAllState() {
        flowStore.clear()
        clearStoryState()
        resetPoemState()
        selectedType = nil
        recipientName = ""
        selectedOccasion = preselectedOccasion ?? .birthday
        selectedStyle = .pop
        selectedVoiceMode = .aiVoice
        currentTrackId = nil
        currentVersionNum = nil
        initialLyrics = nil
        errorMessage = ""
        showError = false
    }

    private func initializeFlow() {
        if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
            currentTrackId = trackId
            currentVersionNum = versionNum
            currentStoryId = flowStore.load()?.storyId
            flowState = .lyricsReview
            return
        }

        if let sourcePoem = variationSourcePoem {
            selectedType = .poem
            recipientName = sourcePoem.recipientName
            selectedOccasion = Occasion(rawValue: sourcePoem.occasion) ?? .birthday
            flowState = .recipient
            return
        }

        if let persisted = flowStore.load() {
            if let storyId = persisted.storyId,
               let session = V2SessionStore.shared.load(),
               session.storyId == storyId {
                restoreStorySession(session, kind: persisted.kind)
                flowState = session.isComplete ? .storyComplete : .storyConversation
                return
            }

            if persisted.kind == .poem, let storyId = persisted.storyId {
                selectedType = .poem
                poemStoryId = storyId
                flowState = .poemCreating
                return
            }
        }

        clearAllState()
        flowState = .typeSelection

        if applyPreselectedTypeIfNeeded() {
            return
        }

        if let occasion = preselectedOccasion {
            selectedOccasion = occasion
        }
    }

    private func applyPreselectedTypeIfNeeded() -> Bool {
        guard flowState == .typeSelection, let forcedType = preselectedType else {
            return false
        }

        selectedType = forcedType
        resetStoryStateKeepingBasics()
        if let occasion = preselectedOccasion {
            selectedOccasion = occasion
        }
        flowState = .recipient
        return true
    }

    private func persistResumeState() {
        switch flowState {
        case .lyricsReview, .trackPlayer, .creatingTrack:
            let storyId = storyContext?.storyId ?? currentStoryId
            if let trackId = currentTrackId, let versionNum = currentVersionNum {
                let state = CreateFlowResumeState(
                    kind: .song,
                    step: "\(flowState)",
                    storyId: storyId,
                    trackId: trackId,
                    versionNum: versionNum,
                    updatedAt: Date()
                )
                flowStore.save(state)
            }
        case .poemCreating, .poemGap, .poemPreview:
            if let storyId = poemStoryId {
                let state = CreateFlowResumeState(
                    kind: .poem,
                    step: "\(flowState)",
                    storyId: storyId,
                    trackId: nil,
                    versionNum: nil,
                    updatedAt: Date()
                )
                flowStore.save(state)
            }
        case .storyConversation, .storyComplete:
            guard let kind = selectedType else { return }
            if let storyId = storyEngine.session.storyId {
                let state = CreateFlowResumeState(
                    kind: kind == .poem ? .poem : .song,
                    step: "\(flowState)",
                    storyId: storyId,
                    trackId: nil,
                    versionNum: nil,
                    updatedAt: Date()
                )
                flowStore.save(state)
            }
        default:
            break
        }
    }

    private func restoreStorySession(_ session: V2Session, kind: CreateFlowResumeState.Kind) {
        selectedType = kind == .poem ? .poem : .song
        recipientName = session.recipientName
        selectedOccasion = Occasion(rawValue: session.occasion) ?? .birthday
        if let style = session.style, let parsedStyle = MusicStyle(rawValue: style) {
            selectedStyle = parsedStyle
        } else {
            selectedStyle = .pop
        }
        messagePrompt = session.initialPrompt ?? ""
        storyEngine.restoreSession(session)
    }
}

#Preview {
    CreateFlowView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onComplete: { _, _ in },
        onCancel: { }
    )
}
