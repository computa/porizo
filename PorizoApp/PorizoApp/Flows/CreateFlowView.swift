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

    @State private var flowState: CreateFlowState
    @State private var selectedType: CreationType?

    // Shared flow state (07a-07e)
    @State private var recipientName: String = ""
    @State private var selectedOccasion: Occasion = .birthday
    @State private var selectedStyle: MusicStyle = .pop
    @State private var selectedTone: PoemTone = .heartfelt
    @State private var selectedVoiceMode: VoiceMode = .aiVoice
    @State private var messagePrompt: String = ""
    @State private var customSongRequest: CustomSongRequest?

    // Setup screen toggles (new in redesign)
    @State private var isInstrumental: Bool = false
    @State private var hasOwnLyrics: Bool = false

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
        case createMerged  // 07 - Merged: recipient + occasion + style + toggles
        case simpleCreate  // 08 - Simple: focused story input with prompts
        case recipient     // Legacy - kept for restoration
        case occasion      // Legacy - kept for restoration
        case style         // Legacy - kept for restoration
        case voice
        case createMode    // 08 - Custom Create (advanced options)
        case storyConversation  // Handles both conversation and completion via reactive view selection
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
        _flowState = State(initialValue: preselectedType == nil ? .typeSelection : .createMerged)
        _selectedType = State(initialValue: preselectedType)
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
        .onChange(of: flowState) { oldValue, newValue in
            print("[CreateFlowView] Flow state changed: \(oldValue) → \(newValue)")
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
    }

    // MARK: - Flow Content

    @ViewBuilder
    private var flowContent: some View {
        switch flowState {
        case .typeSelection:
            typeSelectionView

        case .createMerged:
            createMergedView

        case .simpleCreate:
            SimpleCreateView(
                recipientName: recipientName,
                occasion: selectedOccasion,
                isInstrumental: isInstrumental,
                hasOwnLyrics: hasOwnLyrics,
                onContinue: { description in
                    let request = CustomSongRequest(
                        description: description,
                        lyrics: nil,
                        isInstrumental: isInstrumental,
                        styles: [selectedStyle.rawValue],
                        title: nil,
                        tempo: nil,
                        mood: nil,
                        duration: nil
                    )
                    customSongRequest = request
                    Task { await startStoryConversation() }
                },
                onBack: {
                    flowState = .createMerged
                },
                onCancel: {
                    clearAllState()
                    onCancel()
                },
                contentKind: selectedType == .poem ? .poem : .song
            )
            .environmentObject(apiWrapper)

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
                    // Update track voice mode on server, then proceed to player
                    Task {
                        if let trackId = currentTrackId {
                            do {
                                try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "updateVoiceMode") {
                                    try await apiClient.updateVoiceMode(trackId: trackId, voiceMode: mode.rawValue)
                                }
                                print("[CreateFlowView] Updated track voice_mode to \(mode.rawValue)")
                            } catch {
                                print("[CreateFlowView] Failed to update voice_mode: \(error.localizedDescription)")
                                // Continue anyway - render will use track's existing voice_mode
                            }
                        }
                        await MainActor.run {
                            flowState = .trackPlayer
                        }
                    }
                },
                onBack: {
                    flowState = .lyricsReview  // Back to lyrics review (new flow)
                }
            )

        case .createMode:
            CustomCreateView(
                apiClient: apiClient,
                onCreateSong: { request in
                    customSongRequest = request
                    Task { await startStoryConversation() }
                },
                onCancel: {
                    // Go back to type selection (unified flow)
                    flowState = .typeSelection
                },
                contentKind: selectedType == .poem ? .poem : .song,
                primaryCtaTitle: createCtaTitle,
                primaryCtaIcon: createCtaIcon
            )
            .environmentObject(apiWrapper)

        case .storyConversation:
            // Reactive view selection: show confirmation when complete, conversation otherwise
            if storyEngine.session.isComplete {
                StoryConfirmationView(
                    engine: storyEngine,
                    creationNoun: creationNoun,
                    onContinue: completeStoryFlow,
                    onEdit: {
                        storyEngine.session.isComplete = false
                    },
                    onClose: {
                        clearAllState()
                        onCancel()
                    }
                )
            } else {
                AdaptiveConversationView(engine: storyEngine) {
                    clearAllState()
                    onCancel()
                }
                .environmentObject(apiWrapper)
            }

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
                        flowState = .storyConversation
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
                        // Songs go to voice selection after lyrics approval
                        // This allows users to see their lyrics before deciding on voice mode
                        if selectedType == .song {
                            print("[CreateFlowView] Lyrics approved! Transitioning to voice selection. trackId=\(trackId)")
                            flowState = .voice
                        } else {
                            print("[CreateFlowView] Lyrics approved! Transitioning to trackPlayer. trackId=\(trackId), versionNum=\(versionNum)")
                            flowState = .trackPlayer
                        }
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
                let _ = print("[CreateFlowView] Rendering TrackPlayerFullView with trackId=\(trackId), versionNum=\(versionNum)")
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
                                _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "addStoryDetails") {
                                    try await apiClient.addStoryDetails(storyId: storyId, detail: detail)
                                }
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
                        // Poem is already saved to backend via createPoemFromStory
                        // Show success feedback and invalidate cache so poems list refreshes
                        ToastService.shared.success("Poem saved to your library!")
                        LocalCache.shared.invalidatePoems()

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
        case .typeSelection:
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
        default:
            return 0
        }
    }

    private var totalStepCount: Int {
        selectedType == .song ? 4 : 3
    }

    private var canGoBack: Bool {
        switch flowState {
        case .recipient, .occasion, .style:
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

    // MARK: - Merged Create View (07 - Create Merged)

    private var createMergedView: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with close button
                HStack {
                    Button {
                        flowState = .typeSelection
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 24) {
                        // Title
                        VStack(spacing: 8) {
                            Text("Create your\n\(selectedType == .poem ? "poem" : "song")")
                                .font(DesignTokens.displayFont(size: 28, weight: .semibold))
                                .foregroundColor(DesignTokens.textPrimary)
                                .multilineTextAlignment(.center)
                            Text("Tell us about your gift")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                        .padding(.top, 8)

                        // For (Recipient)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("For")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)

                            HStack(spacing: 12) {
                                Image(systemName: "person")
                                    .foregroundColor(DesignTokens.textTertiary)
                                TextField("Their name...", text: $recipientName)
                                    .textFieldStyle(.plain)
                                    .foregroundColor(DesignTokens.textPrimary)
                                    .autocapitalization(.words)
                            }
                            .padding(14)
                            .background(DesignTokens.inputBackground)
                            .cornerRadius(12)
                        }

                        // Occasion (2-column grid for all 10 occasions)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Occasion")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)

                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                ForEach(mergedOccasionOptions) { occasion in
                                    mergedOccasionButton(occasion)
                                }
                            }
                        }

                        // Style / Tone section (horizontal scroll chips)
                        VStack(alignment: .leading, spacing: 8) {
                            Text(selectedType == .poem ? "Tone" : "Style")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) {
                                    if selectedType == .poem {
                                        ForEach(mergedToneOptions) { tone in
                                            toneChip(tone)
                                        }
                                    } else {
                                        ForEach(mergedStyleOptions) { style in
                                            styleChip(style)
                                        }
                                    }
                                }
                            }
                        }

                        // Song-specific options (not shown for poems)
                        if selectedType == .song {
                            // Instrumental toggle
                            HStack {
                                HStack(spacing: 10) {
                                    Image(systemName: "music.note")
                                        .font(.system(size: 16))
                                        .foregroundColor(DesignTokens.textSecondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Instrumental Only")
                                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                            .foregroundColor(DesignTokens.textPrimary)
                                        Text("No vocals, just the music")
                                            .font(DesignTokens.bodyFont(size: 12))
                                            .foregroundColor(DesignTokens.textTertiary)
                                    }
                                }
                                Spacer()
                                Toggle("", isOn: $isInstrumental)
                                    .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                                    .labelsHidden()
                            }
                            .padding(14)
                            .background(DesignTokens.surface)
                            .cornerRadius(12)

                            // Add Lyrics toggle (only if not instrumental)
                            if !isInstrumental {
                                HStack {
                                    HStack(spacing: 10) {
                                        Image(systemName: "doc.text")
                                            .font(.system(size: 16))
                                            .foregroundColor(DesignTokens.textSecondary)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("I'll write my own lyrics")
                                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                                .foregroundColor(DesignTokens.textPrimary)
                                            Text("Provide your own words")
                                                .font(DesignTokens.bodyFont(size: 12))
                                                .foregroundColor(DesignTokens.textTertiary)
                                        }
                                    }
                                    Spacer()
                                    Toggle("", isOn: $hasOwnLyrics)
                                        .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                                        .labelsHidden()
                                }
                                .padding(14)
                                .background(DesignTokens.surface)
                                .cornerRadius(12)
                            }
                        }

                        // Continue button
                        VelvetButton("Continue", style: .primary, isDisabled: !canContinueFromMerged) {
                            // Songs now skip voice selection here - it happens AFTER lyrics confirmation
                            // This allows users to see their lyrics before deciding on voice mode
                            if hasOwnLyrics {
                                flowState = .createMode  // Custom mode for providing lyrics
                            } else {
                                flowState = .simpleCreate  // Simple mode for story gathering
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
                }
            }
        }
    }

    private var mergedOccasionOptions: [Occasion] {
        Occasion.allCases  // All 10 occasions
    }

    private var mergedStyleOptions: [MusicStyle] {
        [.pop, .acoustic, .soul, .folk, .jazz, .rnb, .rock, .country]  // 8 popular styles
    }

    private var canContinueFromMerged: Bool {
        !recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func mergedOccasionButton(_ occasion: Occasion) -> some View {
        Button {
            selectedOccasion = occasion
        } label: {
            VStack(spacing: 4) {
                Text(occasion.emoji)
                    .font(.system(size: 16))
                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundColor(selectedOccasion == occasion ? .black : DesignTokens.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(selectedOccasion == occasion ? DesignTokens.gold : DesignTokens.surface)
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(selectedOccasion == occasion ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func styleChip(_ style: MusicStyle) -> some View {
        Button {
            selectedStyle = style
        } label: {
            Text(style.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(selectedStyle == style ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(selectedStyle == style ? DesignTokens.gold : DesignTokens.surface)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(selectedStyle == style ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var mergedToneOptions: [PoemTone] {
        [.heartfelt, .playful, .formal, .poetic, .simple]  // 5 popular tones
    }

    private func toneChip(_ tone: PoemTone) -> some View {
        Button {
            selectedTone = tone
        } label: {
            Text(tone.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(selectedTone == tone ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(selectedTone == tone ? DesignTokens.gold : DesignTokens.surface)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(selectedTone == tone ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Step Views (Legacy)

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
                    .background(DesignTokens.inputBackground)
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
                    flowState = .createMode
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
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

    private var creationNoun: String {
        selectedType == .poem ? "poem" : "song"
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
        default:
            break
        }
    }

    private func startFlow(_ type: CreationType) {
        selectedType = type
        resetStoryStateKeepingBasics()
        // Go to merged screen (07) then unified create (08)
        flowState = .createMerged
    }

    private func startStoryConversation() async {
        errorMessage = ""

        // Build initial prompt from customSongRequest (Simple or Custom mode)
        let initialPrompt: String
        if let desc = customSongRequest?.description, !desc.isEmpty {
            initialPrompt = desc  // Simple mode
        } else if let lyrics = customSongRequest?.lyrics, !lyrics.isEmpty {
            if customSongRequest?.isInstrumental == true {
                initialPrompt = "Create an instrumental track with style: \(customSongRequest?.styles.joined(separator: ", ") ?? "")"
            } else {
                initialPrompt = lyrics  // Custom mode
            }
        } else {
            initialPrompt = ""
        }

        storyEngine.updateBasics(
            recipientName: recipientName,
            occasion: selectedOccasion.rawValue,
            style: selectedStyle.rawValue
        )

        // Transition to conversation view FIRST, so loading indicator is visible
        // Note: Do NOT set isLoading here - startSession() manages its own loading state
        // and has a guard that returns early if isLoading is already true
        flowState = .storyConversation

        // Now start the session - startSession() will set isLoading = true internally
        do {
            try await storyEngine.startSession(initialPrompt: initialPrompt)
        } catch {
            errorMessage = error.localizedDescription
            showError = true
            // Go back to previous state on error
            flowState = .simpleCreate
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
        isInstrumental = false
        hasOwnLyrics = false
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
            flowState = .createMode
            return
        }

        if let persisted = flowStore.load() {
            if let storyId = persisted.storyId,
               let session = V2SessionStore.shared.load(),
               session.storyId == storyId {
                restoreStorySession(session, kind: persisted.kind)
                flowState = .storyConversation  // Reactive view handles showing confirmation when complete
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
        flowState = .createMerged
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
        case .storyConversation:
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
