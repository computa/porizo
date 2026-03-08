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
    var preselectedType: CreateFlowKind?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    var resumeTarget: CreateFlowResumeTarget?
    var variationSourcePoem: Poem?
    var maxSongRerolls: Int? = nil
    var initialSongRerollsUsed: Int = 0
    var allowedRerollTypes: [RerollType] = RerollType.allCases
    var onSongRerollUsed: ((Int) -> Void)? = nil
    var onPoemComplete: ((Poem) -> Void)? = nil
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    @State private var flowState: CreateFlowState
    @State private var selectedType: CreateFlowKind?
    @State private var songRerollsUsed: Int

    @State private var setup = StorySetup()
    @State private var songFlow = SongFlowCoordinator()
    @State private var poemFlow = PoemFlowCoordinator()

    // Story engine (09a/09b/09c)
    @State private var storyEngine: V2StoryEngine
    @StateObject private var apiWrapper: APIClientWrapper

    // UI state
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""
    @State private var showSpeechInput: Bool = false

    private let flowStore = CreateFlowStore.shared

    init(
        apiClient: APIClient,
        preselectedOccasion: Occasion? = nil,
        preselectedType: CreateFlowKind? = nil,
        resumeTrackId: String? = nil,
        resumeVersionNum: Int? = nil,
        resumeTarget: CreateFlowResumeTarget? = nil,
        variationSourcePoem: Poem? = nil,
        maxSongRerolls: Int? = nil,
        initialSongRerollsUsed: Int = 0,
        allowedRerollTypes: [RerollType] = RerollType.allCases,
        onSongRerollUsed: ((Int) -> Void)? = nil,
        onPoemComplete: ((Poem) -> Void)? = nil,
        onComplete: @escaping (String, Int) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.apiClient = apiClient
        self.preselectedOccasion = preselectedOccasion
        self.preselectedType = preselectedType
        self.resumeTrackId = resumeTrackId
        self.resumeVersionNum = resumeVersionNum
        self.resumeTarget = resumeTarget
        self.variationSourcePoem = variationSourcePoem
        self.maxSongRerolls = maxSongRerolls
        self.initialSongRerollsUsed = initialSongRerollsUsed
        self.allowedRerollTypes = allowedRerollTypes
        self.onSongRerollUsed = onSongRerollUsed
        self.onPoemComplete = onPoemComplete
        self.onComplete = onComplete
        self.onCancel = onCancel
        _flowState = State(initialValue: preselectedType == nil ? .typeSelection : .createMerged)
        _selectedType = State(initialValue: preselectedType)
        _songRerollsUsed = State(initialValue: initialSongRerollsUsed)
        _storyEngine = State(initialValue: V2StoryEngine(apiClient: apiClient))
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
                storyId: storyEngine.storyId ?? "",
                onTranscription: { text in
                    songFlow.messagePrompt = text
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
        .onChange(of: songFlow.currentTrackId) { _, _ in
            persistResumeState()
        }
        .onChange(of: songFlow.currentVersionNum) { _, _ in
            persistResumeState()
        }
        .onChange(of: poemFlow.storyId) { _, _ in
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
                recipientName: setup.recipientName,
                occasion: setup.occasion,
                isInstrumental: songFlow.isInstrumental,
                hasOwnLyrics: songFlow.hasOwnLyrics,
                onContinue: { description in
                    let request = CustomSongRequest(
                        description: description,
                        lyrics: nil,
                        isInstrumental: songFlow.isInstrumental,
                        styles: [setup.style.rawValue],
                        title: nil,
                        tempo: nil,
                        mood: nil,
                        duration: nil
                    )
                    songFlow.customSongRequest = request
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

        case .voice:
            VoiceModeSelectionView(
                apiClient: apiClient,
                onSelect: { mode in
                    songFlow.voiceMode = mode
                    // Update track voice mode on server, then proceed to player
                    Task {
                        if let trackId = songFlow.currentTrackId {
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
                            flowState = songFlow.voiceSelectionCompleteState()
                        }
                    }
                },
                onBack: {
                    flowState = songFlow.voiceSelectionBackState()
                }
            )

        case .createMode:
            CustomCreateView(
                apiClient: apiClient,
                onCreateSong: { request in
                    songFlow.customSongRequest = request
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
            if storyEngine.isComplete {
                StoryConfirmationView(
                    engine: storyEngine,
                    creationNoun: creationNoun,
                    onContinue: completeStoryFlow,
                    onEdit: {
                        storyEngine.enterReviewEditMode()
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
            if let context = songFlow.storyContext {
                CreatingTrackView(
                    apiClient: apiClient,
                    storyContext: context,
                    voiceMode: songFlow.voiceMode,
                    onTrackCreated: { trackId, versionNum, lyrics in
                        flowState = songFlow.storeCreatedTrackAndAdvance(
                            trackId: trackId,
                            versionNum: versionNum,
                            storyId: context.storyId,
                            lyrics: lyrics,
                            originState: .storyConversation
                        )
                    },
                    onError: { error in
                        errorMessage = error
                        showError = true
                    },
                    onCancel: {
                        flowState = songFlow.cancelTrackCreationState()
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
            if let trackId = songFlow.currentTrackId,
               let versionNum = songFlow.currentVersionNum,
               let storyId = songFlow.currentStoryId {
                LyricsReviewView(
                    apiClient: apiClient,
                    trackId: trackId,
                    versionNum: versionNum,
                    storyId: storyId,
                    initialLyrics: songFlow.initialLyrics,
                    highlightTerms: songFlow.renderPolicyTerms,
                    onApproved: {
                        songFlow.renderPolicyTerms = []
                        let nextState = songFlow.lyricsApprovalState(for: selectedType)
                        print("[CreateFlowView] Lyrics approved! Transitioning to \(nextState.rawValue). trackId=\(trackId), versionNum=\(versionNum)")
                        flowState = nextState
                    },
                    onBack: {
                        flowState = songFlow.lyricsOriginState
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
            if let trackId = songFlow.currentTrackId, let versionNum = songFlow.currentVersionNum {
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
                    },
                    onRerollComplete: { newVersionNum in
                        songFlow.currentVersionNum = newVersionNum
                    },
                    onEditLyricsRequested: { terms in
                        flowState = songFlow.prepareLyricsEdit(terms: terms)
                    },
                    allowedRerollTypes: allowedRerollTypes,
                    rerollLimit: maxSongRerolls,
                    rerollsUsed: songRerollsUsed,
                    onRerollUsed: {
                        let updatedRerolls = songRerollsUsed + 1
                        songRerollsUsed = updatedRerolls
                        onSongRerollUsed?(updatedRerolls)
                    }
                )
            }

        case .poemCreating:
            if let storyId = poemFlow.storyId {
                PoemCreatingView(
                    apiClient: apiClient,
                    storyId: storyId,
                    storyDraftVersion: storyEngine.narrativeVersion,
                    finalNotes: storyEngine.finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? nil
                        : storyEngine.finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines),
                    onPoemReady: { poem in
                        flowState = poemFlow.storeGeneratedPoem(poem)
                    },
                    onNeedsDetails: { gaps, question in
                        flowState = poemFlow.storeGap(gaps: gaps, question: question)
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
            if let question = poemFlow.gapQuestion, let storyId = poemFlow.storyId {
                PoemGapQuestionView(
                    question: question,
                    onSubmit: { detail in
                        Task {
                            do {
                                _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "addStoryDetails") {
                                    try await apiClient.addStoryDetails(storyId: storyId, detail: detail)
                                }
                                await MainActor.run {
                                    flowState = poemFlow.clearGapAndResumeCreation()
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
            if let poem = poemFlow.currentPoem {
                PoemPreviewView(
                    poem: poem,
                    apiClient: apiClient,
                    onRegenerate: {
                        flowState = poemFlow.regenerateState()
                    },
                    onDone: {
                        if let onPoemComplete {
                            onPoemComplete(poem)
                        } else {
                            // Poem is already saved to backend via createPoemFromStory.
                            // Invalidate cache so poems list refreshes in the library flow.
                            ToastService.shared.success("Poem saved to your library!")
                            LocalCache.shared.invalidatePoems()
                        }
                        resetPoemState()
                        clearStoryState()
                        flowStore.clear()
                        onCancel()  // Dismiss the fullScreenCover
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
        case .voice:
            return 3
        default:
            return 0
        }
    }

    private var totalStepCount: Int {
        selectedType == .song ? 4 : 3
    }

    private var createFlowHeader: some View {
        HStack {
            Color.clear.frame(width: 44, height: 44)

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
        ScrollView {
            VStack(spacing: 0) {
                Text("What would you\nlike to create?")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.top, 32)
                    .padding(.bottom, 32)

                createTypeCard(
                    icon: "music.note.list",
                    title: "A Song",
                    description: "Create a personalized song for someone special. Choose an occasion, add a message, and hear it in your voice.",
                    gradientColors: [DesignTokens.gold.opacity(0.3), DesignTokens.gold.opacity(0.05)]
                ) {
                    startFlow(.song)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 14)

                createTypeCard(
                    icon: "text.book.closed",
                    title: "A Poem",
                    description: "Craft heartfelt words for any moment. Personalize with their name, occasion, and your feelings.",
                    gradientColors: [DesignTokens.roseGold.opacity(0.2), DesignTokens.roseGold.opacity(0.05)]
                ) {
                    startFlow(.poem)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)

                Text("Not sure? Start with a song")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textTertiary)

                Spacer(minLength: 120)
            }
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
                                TextField("Their name...", text: $setup.recipientName)
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
                                Toggle("", isOn: $songFlow.isInstrumental)
                                    .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                                    .labelsHidden()
                            }
                            .padding(14)
                            .background(DesignTokens.surface)
                            .cornerRadius(12)

                            // Add Lyrics toggle (only if not instrumental)
                            if !songFlow.isInstrumental {
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
                                    Toggle("", isOn: $songFlow.hasOwnLyrics)
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
                            if songFlow.hasOwnLyrics {
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
        Occasion.allCases  // All occasions
    }

    private var mergedStyleOptions: [MusicStyle] {
        MusicStyle.allCases
    }

    private var canContinueFromMerged: Bool {
        !setup.recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func mergedOccasionButton(_ occasion: Occasion) -> some View {
        Button {
            setup.occasion = occasion
        } label: {
            VStack(spacing: 4) {
                Text(occasion.emoji)
                    .font(.system(size: 16))
                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundColor(setup.occasion == occasion ? .black : DesignTokens.textPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(setup.occasion == occasion ? DesignTokens.gold : DesignTokens.surface)
            .cornerRadius(10)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(setup.occasion == occasion ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func styleChip(_ style: MusicStyle) -> some View {
        Button {
            setup.style = style
        } label: {
            Text(style.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(setup.style == style ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(setup.style == style ? DesignTokens.gold : DesignTokens.surface)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(setup.style == style ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var mergedToneOptions: [PoemTone] {
        [.heartfelt, .playful, .formal, .poetic, .simple]  // 5 popular tones
    }

    private func toneChip(_ tone: PoemTone) -> some View {
        Button {
            setup.tone = tone
        } label: {
            Text(tone.displayName)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(setup.tone == tone ? .black : DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(setup.tone == tone ? DesignTokens.gold : DesignTokens.surface)
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(setup.tone == tone ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Option Card (v1.pen style)

    private func createTypeCard(
        icon: String,
        title: String,
        description: String,
        gradientColors: [Color],
        action: @escaping () -> Void
    ) -> some View {
        Button(action: {
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
            action()
        }) {
            HStack(spacing: 16) {
                // Gold gradient left accent
                RoundedRectangle(cornerRadius: 4)
                    .fill(LinearGradient(
                        colors: [DesignTokens.gold, DesignTokens.goldDark],
                        startPoint: .top, endPoint: .bottom))
                    .frame(width: 4, height: 80)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Image(systemName: icon)
                            .font(.system(size: 22))
                            .foregroundColor(DesignTokens.gold)
                        Text(title)
                            .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)
                    }
                    Text(description)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
                        .lineSpacing(3)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.textTertiary)
            }
            .padding(16)
            .frame(height: 120)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                    .fill(LinearGradient(colors: gradientColors, startPoint: .leading, endPoint: .trailing))
            )
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(description)
    }

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

    // MARK: - Helpers

    private var creationNoun: String {
        selectedType == .poem ? "poem" : "song"
    }

    private var createCtaTitle: String {
        selectedType == .poem ? "Continue" : "Create Song"
    }

    private var createCtaIcon: String {
        selectedType == .poem ? "arrow.right" : "music.note"
    }

    private func startFlow(_ type: CreateFlowKind) {
        selectedType = type
        resetStoryStateKeepingBasics()
        // Go to merged screen (07) then unified create (08)
        flowState = .createMerged
    }

    private func startStoryConversation() async {
        errorMessage = ""
        let initialPrompt = songFlow.buildInitialPrompt()

        storyEngine.updateBasics(
            recipientName: setup.recipientName,
            occasion: setup.occasion.rawValue,
            style: setup.style.rawValue
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
        guard let storyId = storyEngine.storyId else {
            errorMessage = "Story session could not be found. Please try again."
            showError = true
            return
        }

        if selectedType == .poem {
            flowState = poemFlow.storeStoryCompletion(storyId: storyId)
        } else {
            flowState = songFlow.storeStoryCompletion(
                storyId: storyId,
                setup: setup,
                engine: storyEngine
            )
        }
    }

    private func resetStoryStateKeepingBasics() {
        storyEngine.reset()
        songFlow.resetDraftingInputs()
    }

    private func clearStoryState() {
        storyEngine.reset()
        V2SessionStore.shared.clear()
        songFlow.clearAll()
    }

    private func resetPoemState() {
        poemFlow.reset()
    }

    private func clearAllState() {
        flowStore.clear()
        clearStoryState()
        resetPoemState()
        selectedType = nil
        setup = StorySetup()
        if let occasion = preselectedOccasion {
            setup.occasion = occasion
        }
        errorMessage = ""
        showError = false
    }

    private func initializeFlow() {
        if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
            flowState = songFlow.resume(
                trackId: trackId,
                versionNum: versionNum,
                storyId: flowStore.load()?.storyId,
                target: resumeTarget
            )
            return
        }

        if let sourcePoem = variationSourcePoem {
            selectedType = .poem
            setup.recipientName = sourcePoem.recipientName
            setup.occasion = Occasion(rawValue: sourcePoem.occasion) ?? .birthday
            flowState = .createMode
            return
        }

        if let persisted = flowStore.load() {
            if let storyId = persisted.storyId,
               let session = V2SessionStore.shared.load(),
               session.storyId == storyId {
                restoreStorySession(session, kind: persisted.kind)
                flowState = .storyConversation  // Reactive view handles showing confirmation when complete
                Task {
                    await refreshRestoredStorySession()
                }
                return
            }

            if persisted.kind == .poem, let storyId = persisted.storyId {
                selectedType = .poem
                flowState = poemFlow.restoreResume(storyId: storyId)
                return
            }
        }

        clearAllState()
        flowState = .typeSelection

        if applyPreselectedTypeIfNeeded() {
            return
        }

        if let occasion = preselectedOccasion {
            setup.occasion = occasion
        }
    }

    private func applyPreselectedTypeIfNeeded() -> Bool {
        guard flowState == .typeSelection, let forcedType = preselectedType else {
            return false
        }

        selectedType = forcedType
        resetStoryStateKeepingBasics()
        if let occasion = preselectedOccasion {
            setup.occasion = occasion
        }
        flowState = .createMerged
        return true
    }

    private func persistResumeState() {
        switch flowState {
        case .lyricsReview, .trackPlayer, .creatingTrack:
            if let state = songFlow.makeResumeState(flowState: flowState) {
                flowStore.save(state)
            }
        case .poemCreating, .poemGap, .poemPreview:
            if let state = poemFlow.makeResumeState(flowState: flowState) {
                flowStore.save(state)
            }
        case .storyConversation:
            guard let kind = selectedType else { return }
            if let storyId = storyEngine.storyId {
                let state = CreateFlowResumeState(
                    kind: kind,
                    step: flowState,
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

    private func restoreStorySession(_ session: V2Session, kind: CreateFlowKind) {
        selectedType = kind
        setup.recipientName = session.recipientName
        setup.occasion = Occasion(rawValue: session.occasion) ?? .birthday
        if let style = session.style, let parsedStyle = MusicStyle(rawValue: style) {
            setup.style = parsedStyle
        } else {
            setup.style = .pop
        }
        songFlow.restoreSessionPrompt(session.initialPrompt)
        storyEngine.restoreSession(session)
    }

    @MainActor
    private func refreshRestoredStorySession() async {
        do {
            try await storyEngine.refreshSessionFromServer()
            setup.recipientName = storyEngine.recipientName
            setup.occasion = Occasion(rawValue: storyEngine.occasion) ?? setup.occasion
            if let style = storyEngine.style, let parsedStyle = MusicStyle(rawValue: style) {
                setup.style = parsedStyle
            }
            songFlow.restoreSessionPrompt(storyEngine.initialPrompt ?? songFlow.messagePrompt)
        } catch {
            // Preserve the cached session as a fallback so resume remains non-blocking.
            print("[CreateFlowView] Story session refresh failed, keeping cached session: \(error.localizedDescription)")
        }
    }
}

#Preview {
    CreateFlowView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onComplete: { _, _ in },
        onCancel: { }
    )
}
