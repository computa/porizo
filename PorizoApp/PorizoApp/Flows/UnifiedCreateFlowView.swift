//
//  UnifiedCreateFlowView.swift
//  PorizoApp
//
//  Production unified creation flow — single-thread chat-to-player experience.
//  Behind feature flag: AppConfig.useUnifiedCreateFlow
//
//  Phase 2: Setup form → Chat with V2StoryEngine → Confirmation
//  Composes with existing InputBarView, reuses engine.messages, engine.currentBeats,
//  engine.factInventory, engine.completionScore. No mock data.
//

import SwiftUI

struct UnifiedCreateFlowView: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    var preselectedOccasion: Occasion?
    var preselectedType: CreateFlowKind?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    var resumeTarget: CreateFlowResumeTarget?
    var variationSourcePoem: Poem?
    var onPoemComplete: ((Poem) -> Void)? = nil
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    // Flow phase (types in CreateFlowTypes.swift)

    @Environment(\.scenePhase) private var scenePhase
    @Environment(StyleStore.self) private var styleStore
    @State private var phase: UnifiedPhase = .chat
    @State private var songProgress: SongProgress = .conversing
    @State private var storyEngine: V2StoryEngine
    @State private var apiWrapper: APIClientWrapper
    @State private var setup = StorySetup()
    @State private var songFlow = SongFlowCoordinator()
    @State private var poemFlow = PoemFlowCoordinator()
    @State private var selectedType: CreateFlowKind?

    // Chat state
    @State private var pendingSpeechText: String?
    @State private var isInputActive: Bool = false
    @Environment(STTRouter.self) private var sttRouter

    // Story flow coordinators
    private let asyncService: CreateFlowAsyncService
    private let storyFlowCoordinator: StoryFlowCoordinator
    private let resumeCoordinator: CreateFlowResumeCoordinator

    // Controllers (owned by this view, shared with inline cards)
    @State private var trackCreationController: TrackCreationController
    @State private var playbackController = PlaybackController()
    @State private var renderController: RenderController
    @State private var lyricsController: LyricsReviewController?
    @State private var createdLyrics: Lyrics?

    // Track metadata (populated from render callbacks)
    @State private var trackTitle: String = "Your Song"
    @State private var coverImageUrl: String?

    // Task handles
    @State private var creationTask: Task<Void, Never>?
    @State private var styleSyncTask: Task<Void, Never>?

    // Presentation router (replaces 11 individual @State booleans)
    @State private var activeSheet: ActiveSheet?
    @State private var activeAlert: ActiveAlert?

    @State private var isStartingFullRender = false

    // Lifecycle
    @State private var didInitializeFlow = false
    @State private var didStartConversation = false

    // Flow state
    @AppStorage("hasCompletedFirstSong") private var hasCompletedFirstSong = false
    @State private var enrollmentCompletedProfile: VoiceProfile?
    @State private var showOccasionPicker = false
    @State private var allowsLegacyPreviewContinuation = false
    @State private var pendingEntitlementFlowType: CreateFlowKind?
    @State private var myVoiceEnabled = true
    @State private var preSessionPrompt: String?
    @State private var showSongOptionsCard = false

    // Share
    @State private var shareController: ShareController?

    init(
        apiClient: APIClient,
        storeKit: StoreKitManager,
        preselectedOccasion: Occasion? = nil,
        preselectedType: CreateFlowKind? = nil,
        resumeTrackId: String? = nil,
        resumeVersionNum: Int? = nil,
        resumeTarget: CreateFlowResumeTarget? = nil,
        variationSourcePoem: Poem? = nil,
        onPoemComplete: ((Poem) -> Void)? = nil,
        onComplete: @escaping (String, Int) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.apiClient = apiClient
        self.storeKit = storeKit
        self.preselectedOccasion = preselectedOccasion
        self.preselectedType = preselectedType
        self.resumeTrackId = resumeTrackId
        self.resumeVersionNum = resumeVersionNum
        self.resumeTarget = resumeTarget
        self.variationSourcePoem = variationSourcePoem
        self.onPoemComplete = onPoemComplete
        self.onComplete = onComplete
        self.onCancel = onCancel
        self.asyncService = CreateFlowAsyncService(apiClient: apiClient)
        self.storyFlowCoordinator = StoryFlowCoordinator()
        self.resumeCoordinator = CreateFlowResumeCoordinator()
        _storyEngine = State(initialValue: V2StoryEngine(apiClient: apiClient))
        _apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
        _selectedType = State(initialValue: preselectedType)
        _trackCreationController = State(initialValue: TrackCreationController(apiClient: apiClient))
        _renderController = State(initialValue: RenderController(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            switch phase {
            case .typeSelection:
                typeSelectionPhase
            case .setup:
                setupPhase
            case .chat:
                chatPhase
            // Poem phases (still full-screen)
            case .poemCreating:
                poemCreatingPhase
            case .poemGap:
                poemGapPhase
            case .poemPreview:
                poemPreviewPhase
            }
        }
        .goldBorderOverlay()
        // MARK: - Alert Router (single slot for all alerts/dialogs)
        .alert(
            alertTitle,
            isPresented: Binding(
                get: { activeAlert != nil },
                set: { if !$0 { activeAlert = nil } }
            )
        ) {
            alertActions
        } message: {
            alertMessage
        }
        // MARK: - Sheet Router (single slot for all sheets)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .upgrade:
                SubscriptionView(apiClient: apiClient, storeKit: storeKit)

            case .customLyrics:
                CustomCreateView(
                    apiClient: apiClient,
                    onCreateSong: { request in
                        songFlow.customSongRequest = request
                        activeSheet = nil
                        didStartConversation = true
                        Task { await beginConversation() }
                    },
                    onCancel: { activeSheet = nil },
                    contentKind: .song
                )
                .environment(apiWrapper)

            case .voiceEnrollment:
                VoiceEnrollmentView(completedProfile: $enrollmentCompletedProfile)
                    .environment(apiWrapper)

            case .share(let payload):
                ShareSheetView(
                    shareController: payload.controller,
                    trackId: payload.trackId,
                    versionNum: payload.versionNum,
                    trackTitle: payload.trackTitle,
                    recipientName: payload.recipientName
                )

            case .editLyrics(let section):
                if let ctrl = lyricsController,
                   let lyrics = ctrl.lyrics,
                   section.id < lyrics.sections.count {
                    SectionEditSheet(
                        sectionName: lyrics.sections[section.id].name,
                        lines: Binding(
                            get: { ctrl.editedLines },
                            set: { ctrl.editedLines = $0 }
                        ),
                        onSave: {
                            if ctrl.saveEditedSection(at: section.id) {
                                createdLyrics = ctrl.lyrics
                                activeSheet = nil
                            }
                        },
                        onCancel: {
                            ctrl.editingSection = nil
                            activeSheet = nil
                        }
                    )
                }

            case .speechInput(let context):
                SpeechInputView(
                    storyId: context.storyId,
                    onTranscription: { text in
                        activeSheet = nil
                        pendingSpeechText = text
                    },
                    onCancel: {
                        activeSheet = nil
                    }
                )
                .environment(sttRouter)
            }
        }
        .onChange(of: activeSheet?.id) { oldValue, _ in
            // Voice enrollment dismissal handling
            if oldValue == "voiceEnrollment" && activeSheet?.id != "voiceEnrollment" {
                handleVoiceEnrollmentDismissal()
            }
            // Upgrade sheet dismissed — re-check entitlements and continue if purchase succeeded
            if oldValue == "upgrade" && activeSheet?.id != "upgrade" {
                let flowType = pendingEntitlementFlowType
                pendingEntitlementFlowType = nil
                // Guard: only re-check entitlements if we know which flow triggered the upgrade sheet
                guard let flowType else { return }
                let state = storeKit.subscriptionState
                if flowType == .poem {
                    // Poem flow: subscriber can proceed; free users need server-side poem credit check
                    if state.hasActiveSubscription {
                        withAnimation { phase = .poemCreating }
                    } else {
                        Task { await checkEntitlementsForPoem() }
                    }
                } else {
                    // Song flow: always server-verify after purchase
                    Task { await checkEntitlementsForSong() }
                }
            }
        }
        .task {
            guard !didInitializeFlow else { return }
            didInitializeFlow = true
            initializeFlow()
            await loadMyVoiceFlag()
        }
        .onChange(of: scenePhase) { oldPhase, newPhase in
            guard newPhase == .active, oldPhase == .background else { return }
            guard let trackId = songFlow.currentTrackId, let versionNum = songFlow.currentVersionNum else { return }

            switch songProgress {
            case .lyricsApproved:
                renderController.recoverAfterForeground(trackId: trackId, versionNum: versionNum, mode: .preview)
            case .fullRenderActive:
                renderController.recoverAfterForeground(trackId: trackId, versionNum: versionNum, mode: .fullRender)
            default:
                break
            }
        }
        .onChange(of: setup.style) { _, newStyle in
            guard newStyle != storyEngine.style else { return }

            storyEngine.updateBasics(
                recipientName: storyEngine.recipientName,
                occasion: storyEngine.occasion,
                style: newStyle
            )

            guard storyEngine.storyId != nil,
                  songProgress == .conversing else { return }

            styleSyncTask?.cancel()
            styleSyncTask = Task { @MainActor in
                do {
                    let syncedStyle = try await storyEngine.syncStoryStyle(newStyle)
                    if setup.style != syncedStyle {
                        setup.style = syncedStyle
                    }
                } catch {
                    guard !Task.isCancelled else { return }
                    ToastService.shared.show(
                        "Couldn't sync that genre yet. Your local selection is still kept for this song.",
                        type: .warning
                    )
                }
            }
        }
    }

    // MARK: - Type Selection Phase

    private var typeSelectionPhase: some View {
        CreateFlowTypeSelectionView(
            onSelectSong: {
                selectedType = .song
                withAnimation { phase = .chat }
            },
            onSelectPoem: {
                selectedType = .poem
                withAnimation { phase = .chat }
            }
        )
    }

    // MARK: - Setup Phase (reuses existing merged setup view)

    private var setupPhase: some View {
        CreateFlowMergedSetupView(
            selectedType: selectedType,
            setup: $setup,
            isInstrumental: $songFlow.isInstrumental,
            hasOwnLyrics: $songFlow.hasOwnLyrics,
            canContinue: !setup.recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            onBack: {
                if preselectedType != nil {
                    onCancel()
                } else {
                    withAnimation { phase = .typeSelection }
                }
            },
            onContinue: {
                setup.applyPreselectedOccasion(preselectedOccasion)
                continueFromSetup()
            }
        )
    }

    // Old simpleCreate and customLyrics phases removed — handled inline in chat

    /// Routes from setup to chat (setup is only used for resume/variation bootstrap).
    private func continueFromSetup() {
        withAnimation { phase = .chat }
    }

    private func handleVoiceEnrollmentDismissal() {
        guard enrollmentCompletedProfile != nil else { return }
        enrollmentCompletedProfile = nil

        Task {
            do {
                let profile = try await apiClient.getVoiceProfile()
                guard profile.hasProfile else {
                    await MainActor.run {
                        activeAlert = .error("Voice setup finished, but your voice profile is not ready yet. Try My Voice again in a moment.")
                    }
                    return
                }

                await MainActor.run {
                    songFlow.voiceMode = .myVoice
                    songProgress = .voiceSelected
                }
                await applyVoiceAndCreateTrack()
            } catch {
                await MainActor.run {
                    activeAlert = .error("Voice setup finished, but we couldn't verify your profile. Try My Voice again.")
                }
            }
        }
    }

    // MARK: - Chat Phase

    private var chatPhase: some View {
        VStack(spacing: 0) {
            if !didStartConversation {
                // Inline name prompt — replaces the old full-page setup form
                InlineNamePromptView(
                    selectedType: selectedType,
                    preselectedOccasion: preselectedOccasion?.displayName,
                    hasOwnLyrics: $songFlow.hasOwnLyrics,
                    isInstrumental: $songFlow.isInstrumental,
                    onStart: { name, _ in
                        startChatWithName(name)
                    },
                    onCancel: onCancel
                )
            } else {
                // Active conversation + accumulated inline cards
                ChatHeaderView(
                    recipientName: setup.recipientName,
                    selectedType: selectedType,
                    storyId: storyEngine.storyId,
                    completionScore: storyEngine.completionScore,
                    occasion: setup.occasion,
                    isComplete: storyEngine.isComplete,
                    onCancel: onCancel
                )

                // Scrollable content: messages + inline cards
                SongInlineCardsView(
                    selectedType: selectedType,
                    songProgress: songProgress,
                    storyEngine: storyEngine,
                    showOccasionPicker: showOccasionPicker,
                    showSongOptionsCard: showSongOptionsCard,
                    preSessionPrompt: preSessionPrompt,
                    lyricsController: lyricsController,
                    createdLyrics: createdLyrics,
                    trackCreationController: trackCreationController,
                    renderController: renderController,
                    playbackController: playbackController,
                    trackTitle: trackTitle,
                    recipientName: setup.recipientName,
                    coverImageUrl: coverImageUrl,
                    allowsLegacyPreviewContinuation: allowsLegacyPreviewContinuation,
                    isStartingFullRender: isStartingFullRender,
                    shareController: shareController,
                    currentTrackId: songFlow.currentTrackId,
                    currentVersionNum: songFlow.currentVersionNum,
                    styleName: setup.style.map(styleStore.displayName(for:)) ?? "Custom",
                    renderPolicyTerms: songFlow.renderPolicyTerms,
                    myVoiceEnabled: myVoiceEnabled,
                    didStartConversation: didStartConversation,
                    storyId: storyEngine.storyId,
                    callbacks: songInlineCardsCallbacks
                )
                .onChange(of: songProgress) { _, newValue in
                    // Lazy-init share controller when entering player states
                    switch newValue {
                    case .previewReady, .fullRenderReady:
                        if shareController == nil {
                            shareController = ShareController(apiClient: apiClient)
                        }
                        // Mark first song completed so future flows show voice selection
                        if !hasCompletedFirstSong {
                            hasCompletedFirstSong = true
                        }
                    case .fullRenderActive:
                        if allowsLegacyPreviewContinuation, shareController == nil {
                            shareController = ShareController(apiClient: apiClient)
                        }
                    default: break
                    }

                    // Persist songProgress for resume (only post-track states)
                    if songFlow.currentTrackId != nil {
                        let flowState: CreateFlowState? = switch newValue {
                        case .trackCreated: .lyricsReview
                        case .lyricsApproved, .previewReady, .fullRenderActive, .fullRenderReady: .trackPlayer
                        default: CreateFlowState?.none
                        }
                        if let flowState {
                            resumeCoordinator.persistResumeState(
                                flowState: flowState,
                                selectedType: selectedType,
                                songFlow: songFlow,
                                poemFlow: PoemFlowCoordinator(),
                                storyId: storyEngine.storyId
                            )
                        }
                    }
                }

                // Genre picker (songs only, during conversation)
                if selectedType == .song && songProgress == .conversing && storyEngine.storyId != nil {
                    CollapsibleStylePicker(
                        selectedStyle: $setup.style,
                        styleStore: styleStore,
                        onCreate: storyEngine.isComplete ? {
                            guard setup.style != nil else {
                                activeAlert = .genreRequired
                                return
                            }
                            finishConversation()
                        } : nil,
                        createEnabled: storyEngine.isComplete && !storyEngine.isLoading && storyEngine.draft.pendingRevision == nil
                    )
                    .padding(.horizontal, 16)
                }

                // Unified input bar (pre-session or active session)
                if let callbacks = currentInputCallbacks {
                    InputBarView(
                        engine: storyEngine,
                        callbacks: callbacks,
                        pendingSpeechText: $pendingSpeechText,
                        isInputActive: $isInputActive
                    )
                    .id(storyEngine.storyId ?? "pre-session")
                }
            }
        }
    }

    // inlineNamePrompt → extracted to InlineNamePromptView.swift

    private func startChatWithName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        setup.recipientName = trimmed
        setup.applyPreselectedOccasion(preselectedOccasion)
        didStartConversation = true

        if let type = selectedType {
            handleTypeSelected(type)
        }
        // else: type chips render automatically via didStartConversation flag
    }

    private func handleTypeSelected(_ type: CreateFlowKind) {
        selectedType = type
        preSessionPrompt = nil
        showSongOptionsCard = false

        guard setup.occasion != nil else {
            showOccasionPicker = true
            return
        }

        continueAfterOccasionSelection(for: type)
    }

    private func continueAfterOccasionSelection(for type: CreateFlowKind) {
        selectedType = type
        showOccasionPicker = false

        switch type {
        case .poem:
            showPreSessionQuestion(type: type)

        case .song:
            if songFlow.hasOwnLyrics {
                activeSheet = .customLyrics
            } else if preselectedType == .song {
                showPreSessionQuestion(type: type)
            } else {
                showSongOptionsCard = true
            }
        }
    }

    private func showPreSessionQuestion(type: CreateFlowKind) {
        selectedType = type
        let typeLabel = type == .poem ? "poem" : "song"
        preSessionPrompt = "Tell me about the story with \(setup.recipientName) that you want to turn into a \(typeLabel). What's a moment or memory that stands out?"
    }

    // chatHeader + chatHeaderTitle → extracted to ChatHeaderView.swift

    // MARK: - Alert Router Helpers

    /// Title for the currently active alert.
    private var alertTitle: String {
        switch activeAlert {
        case .error:              return "Error"
        case .genreRequired:      return "Pick a genre"
        case .doneWarning:        return "Leave?"
        case .discardLyricsEdits: return "Discard edits?"
        case .staleResume:        return "Song Unavailable"
        case nil:                 return ""
        }
    }

    /// Action buttons for the currently active alert.
    @ViewBuilder
    private var alertActions: some View {
        switch activeAlert {
        case .error:
            Button("OK") {}
        case .genreRequired:
            Button("OK", role: .cancel) {}
        case .staleResume:
            Button("Start Fresh") {
                resetToFreshFlow()
                activeAlert = nil
            }
            Button("Cancel", role: .cancel) {
                onCancel()
                activeAlert = nil
            }
        case .doneWarning:
            Button("Leave", role: .destructive) {
                if let trackId = songFlow.currentTrackId,
                   let versionNum = songFlow.currentVersionNum {
                    onComplete(trackId, versionNum)
                } else {
                    onCancel()
                }
                activeAlert = nil
            }
            Button("Cancel", role: .cancel) { activeAlert = nil }
        case .discardLyricsEdits:
            Button("Discard & Regenerate", role: .destructive) {
                lyricsController?.regenerateLyrics()
            }
            Button("Cancel", role: .cancel) {}
        case nil:
            EmptyView()
        }
    }

    /// Message body for the currently active alert.
    @ViewBuilder
    private var alertMessage: some View {
        switch activeAlert {
        case .error(let message):
            Text(message)
        case .genreRequired:
            Text("Choose a genre before creating your song.")
        case .doneWarning(let kind):
            switch kind {
            case .previewOnly:
                Text("Only the preview is saved. Get the full song first?")
            case .fullRenderInProgress:
                Text("Full song is still rendering. Leave anyway?")
            }
        case .discardLyricsEdits:
            Text("You have unsaved lyrics edits. Regenerating will replace them.")
        case .staleResume:
            Text("This song is no longer available. Would you like to start a new one?")
        case nil:
            Text("")
        }
    }

    // chatBubbleFromText, chatBubble, loadingIndicator, playerDisplayMode,
    // shouldShowPlayerCard → extracted to SongInlineCardsView.swift

    // MARK: - Song Inline Cards Callbacks

    // PERF: This computed property creates a new SongInlineCardsCallbacks struct with 18 closures
    // on every body evaluation. This is intentional — closures capture current state and are cheap
    // to allocate in Swift. EquatableView won't help because SongInlineCardsView depends on
    // @Observable controllers (V2StoryEngine, RenderController, etc.) which trigger re-renders
    // independently of struct diffing. Profiling with Self._printChanges() confirms the real
    // re-render drivers are @Observable state mutations, not the callbacks struct.
    private var songInlineCardsCallbacks: SongInlineCardsCallbacks {
        SongInlineCardsCallbacks(
            onTypeSelected: { type in handleTypeSelected(type) },
            onOccasionSelected: { occasion in
                setup.occasion = occasion
                showOccasionPicker = false
                if let selectedType {
                    continueAfterOccasionSelection(for: selectedType)
                }
            },
            onSongOptionsContinue: {
                showSongOptionsCard = false
                showPreSessionQuestion(type: .song)
            },
            onSongOptionsOwnLyrics: {
                showSongOptionsCard = false
                songFlow.hasOwnLyrics = true
                activeSheet = .customLyrics
            },
            onSongOptionsInstrumental: {
                showSongOptionsCard = false
                songFlow.isInstrumental = true
                showPreSessionQuestion(type: .song)
            },
            onSuggestionChipTapped: { suggestion in submitAndScroll(suggestion) },
            onConfirmEditMode: { storyEngine.enterReviewEditMode() },
            onVoiceSelected: { mode, gender in
                songFlow.voiceMode = mode
                songFlow.voiceGender = gender
                songProgress = .voiceSelected
                Task { await applyVoiceAndCreateTrack() }
            },
            onMyVoiceRequested: {
                Task {
                    let profile = try? await apiClient.getVoiceProfile()
                    if profile?.hasProfile == true {
                        songFlow.voiceMode = .myVoice
                        songProgress = .voiceSelected
                        await applyVoiceAndCreateTrack()
                    } else {
                        activeSheet = .voiceEnrollment
                    }
                }
            },
            onLyricsApproved: {
                lyricsController?.approveLyrics()
            },
            onRegenerateLyrics: {
                if lyricsController?.hasUnsavedChanges == true {
                    activeAlert = .discardLyricsEdits
                } else {
                    lyricsController?.regenerateLyrics()
                }
            },
            onEditLyricsSection: { index in
                guard let ctrl = lyricsController else { return }
                ctrl.startEditing(section: index)
                activeSheet = .editLyrics(EditingLyricsSection(id: index))
            },
            onRenderRetry: {
                guard let trackId = songFlow.currentTrackId, let versionNum = songFlow.currentVersionNum else { return }
                if songProgress == .lyricsApproved {
                    renderController.retryPreviewRender(trackId: trackId, versionNum: versionNum)
                } else {
                    renderController.retryFullRender(trackId: trackId, versionNum: versionNum)
                }
            },
            onEditLyricsFromRender: { terms in
                songFlow.renderPolicyTerms = terms
                lyricsController?.onAppear(
                    initialLyrics: createdLyrics,
                    highlightTerms: terms
                )
                songProgress = .trackCreated
            },
            onGetFullSong: {
                guard allowsLegacyPreviewContinuation else { return }
                startFullRender()
            },
            onShare: {
                guard let trackId = songFlow.currentTrackId,
                      let versionNum = songFlow.currentVersionNum,
                      let controller = shareController else { return }
                activeSheet = .share(ShareSheetPayload(
                    controller: controller,
                    trackId: trackId,
                    versionNum: versionNum,
                    trackTitle: trackTitle,
                    recipientName: setup.recipientName
                ))
            },
            onDone: {
                switch songProgress {
                case .fullRenderActive:
                    activeAlert = .doneWarning(.fullRenderInProgress)
                case .previewReady:
                    if allowsLegacyPreviewContinuation {
                        activeAlert = .doneWarning(.previewOnly)
                    } else if let trackId = songFlow.currentTrackId,
                              let versionNum = songFlow.currentVersionNum {
                        onComplete(trackId, versionNum)
                    }
                default:
                    if let trackId = songFlow.currentTrackId,
                       let versionNum = songFlow.currentVersionNum {
                        onComplete(trackId, versionNum)
                    }
                }
            }
        )
    }

    // MARK: - Track Creation

    private func startTrackCreation() {
        guard let styleKey = setup.style else {
            activeAlert = .genreRequired
            return
        }

        guard let context = storyEngine.buildStoryContext(styleKey: styleKey) else {
            presentFlowMessage("Could not build story context")
            phase = .chat
            return
        }

        creationTask?.cancel()
        creationTask = Task {
            do {
                let outcome = try await trackCreationController.createTrack(
                    storyContext: context,
                    voiceMode: songFlow.voiceMode,
                    voiceGender: songFlow.voiceGender
                )
                try Task.checkCancellation()

                switch outcome {
                case .needsInput(let guidance):
                    await MainActor.run {
                        applyStoryGuidanceAndReturnToConversation(guidance)
                    }
                    return
                case .created(let result):
                    createdLyrics = result.lyrics

                    songFlow.currentTrackId = result.trackId
                    songFlow.currentVersionNum = result.versionNum

                    // Initialize lyrics controller now that trackId exists
                    makeLyricsController(trackId: result.trackId, versionNum: result.versionNum)
                    lyricsController?.onAppear(
                        initialLyrics: result.lyrics,
                        highlightTerms: songFlow.renderPolicyTerms
                    )

                    // Persist resume state
                    resumeCoordinator.persistResumeState(
                        flowState: .lyricsReview,
                        selectedType: selectedType,
                        songFlow: songFlow,
                        poemFlow: PoemFlowCoordinator(),
                        storyId: storyEngine.storyId
                    )

                    // Advance to interactive lyrics review
                    withAnimation { songProgress = .trackCreated }
                }
            } catch is CancellationError {
                // User cancelled — already returned to chat
            } catch {
                guard !Task.isCancelled else { return }
                presentFlowError(error, context: "Starting track creation")
                songProgress = .confirmed // Return to voice chips so user can retry
            }
        }
    }

    private func applyStoryGuidanceAndReturnToConversation(_ guidance: StoryGuidanceResponse) {
        storyEngine.applyConfirmGuidance(guidance)
        createdLyrics = nil
        creationTask = nil
        withAnimation {
            phase = .chat
            songProgress = .conversing
        }
    }

    private func cancelCreation() {
        creationTask?.cancel()
        creationTask = nil
        // Return to voice selection (conversation still visible above)
        withAnimation { songProgress = .confirmed }
    }

    /// Reset to a completely fresh flow after a stale resume (e.g. track deleted server-side).
    private func resetToFreshFlow() {
        creationTask?.cancel()
        creationTask = nil
        CreateFlowStore.shared.clear()
        songFlow = SongFlowCoordinator()
        lyricsController = nil
        createdLyrics = nil
        trackCreationController = TrackCreationController(apiClient: apiClient)
        storyEngine.reset()
        setup = StorySetup()
        withAnimation {
            phase = .chat
            songProgress = .conversing
        }
    }

    // MARK: - Bootstrap

    private func initializeFlow() {
        let persisted = CreateFlowStore.shared.load()
        let persistedSession = storyEngine.loadPersistedSession()
        let bootstrap = CreateFlowBootstrapAction.resolve(
            preselectedOccasion: preselectedOccasion,
            preselectedType: preselectedType,
            resumeTrackId: resumeTrackId,
            resumeVersionNum: resumeVersionNum,
            resumeTarget: resumeTarget,
            variationSourcePoem: variationSourcePoem,
            persisted: persisted,
            persistedSession: persistedSession
        )

        switch bootstrap {
        case let .resumeTrack(trackId, versionNum, storyId, target):
            _ = songFlow.resume(
                trackId: trackId,
                versionNum: versionNum,
                storyId: storyId,
                target: target
            )
            selectedType = .song
            phase = .chat

            // Restore chat continuity with session identity validation
            var restoredChat = false
            if let persistedSession = storyEngine.loadPersistedSession(),
               persistedSession.storyId != nil,
               persistedSession.storyId == storyId {
                storyEngine.restoreSession(persistedSession)
                if !storyEngine.recipientName.isEmpty {
                    setup.recipientName = storyEngine.recipientName
                }
                restoredChat = true
            }
            if !restoredChat {
                injectResumeContext(storyId: storyId, target: target)
            }

            rebuildInlineSongState(trackId: trackId, versionNum: versionNum, storyId: storyId, target: target)

        case let .variationSourcePoem(variationSetup):
            selectedType = .poem
            setup = variationSetup
            // Go to setup so user can review/edit before chat
            phase = .setup

        case let .restoredStory(kind, session):
            let restored = resumeCoordinator.restoreStorySession(
                kind: kind,
                session: session,
                engine: storyEngine
            )
            selectedType = restored.kind
            setup = restored.setup
            songFlow = restored.songFlow
            phase = .chat
            Task {
                await refreshRestoredStorySession()
            }

        case let .restoredPoem(storyId):
            selectedType = .poem
            _ = poemFlow.restoreResume(storyId: storyId)
            phase = .poemCreating

        case let .freshStart(initialSetup, forcedType):
            setup = initialSetup
            selectedType = forcedType ?? preselectedType
            phase = .chat
        }
    }

    private func loadMyVoiceFlag() async {
        do {
            let appConfig = try await apiClient.getAppConfig()
            myVoiceEnabled = appConfig.flags?.myVoiceEnabled ?? true
        } catch {
            myVoiceEnabled = true // fail-open
        }
    }

    @MainActor
    private func refreshRestoredStorySession() async {
        if let refreshed = await resumeCoordinator.refreshRestoredStorySession(
            engine: storyEngine,
            fallbackPrompt: songFlow.messagePrompt
        ) {
            setup = refreshed.setup
            songFlow.restoreSessionPrompt(refreshed.restoredPrompt)
        } else {
            ToastService.shared.show("Using cached session — refresh failed", type: .warning)
        }
    }

    // MARK: - Actions

    private func beginConversation(initialPromptOverride: String? = nil) async {
        withAnimation { phase = .chat }

        let result = await storyFlowCoordinator.startConversation(
            setup: setup,
            songFlow: songFlow,
            engine: storyEngine,
            asyncService: asyncService,
            initialPromptOverride: initialPromptOverride
        )

        if let message = result.errorMessage {
            presentFlowMessage(message)
            // Recovery: re-show pre-session prompt so user can retry
            if storyEngine.storyId == nil, let type = selectedType {
                showPreSessionQuestion(type: type)
                storyEngine.removeLastLocalUserMessage()
            }
        }

        // Persist resume state
        resumeCoordinator.persistResumeState(
            flowState: .storyConversation,
            selectedType: selectedType,
            songFlow: songFlow,
            poemFlow: PoemFlowCoordinator(),
            storyId: storyEngine.storyId
        )
    }

    // MARK: - Helpers

    private func makeLyricsController(trackId: String, versionNum: Int, storyId: String? = nil) {
        lyricsController = LyricsReviewController(
            apiClient: apiClient,
            trackId: trackId,
            versionNum: versionNum,
            storyId: storyId ?? storyEngine.storyId
        )
        wireLyricsControllerCallbacks()
    }

    private func applyTrackMetadata(title: String, coverUrl: String?) {
        trackTitle = title
        coverImageUrl = coverUrl
    }

    private func presentFlowMessage(_ message: String) {
        activeAlert = .error(message)
    }

    private func presentFlowError(_ error: Error, context: String? = nil) {
        presentFlowMessage(ErrorHandler.friendlyMessage(for: error, context: context))
    }

    // MARK: - Input bar callbacks

    private var currentInputCallbacks: InputBarCallbacks? {
        guard songProgress == .conversing, selectedType != nil else { return nil }

        if storyEngine.storyId == nil, preSessionPrompt != nil {
            // Pre-session: onFinishEarly/onExitReviewEdit are no-ops because
            // engine.currentTurn < 2, so InputBarView never renders those actions
            return InputBarCallbacks(
                onSubmit: { submitPreSessionAnswer($0) },
                onSpeechInput: { activeSheet = .speechInput(SpeechInputContext(storyId: nil)) },
                onFinishEarly: { },
                onExitReviewEdit: { }
            )
        }
        if !storyEngine.isComplete, storyEngine.storyId != nil {
            return InputBarCallbacks(
                onSubmit: { submitAndScroll($0) },
                onSpeechInput: {
                    guard let sid = storyEngine.storyId else { return }
                    activeSheet = .speechInput(SpeechInputContext(storyId: sid))
                },
                onFinishEarly: { finishConversation() },
                onExitReviewEdit: {
                    storyEngine.exitReviewEditMode()
                    songProgress = .conversing
                }
            )
        }
        // After story is complete, the CollapsibleStylePicker's Create button
        // is the CTA — no text input needed
        return nil
    }

    private func submitPreSessionAnswer(_ answer: String) {
        let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        preSessionPrompt = nil
        storyEngine.addLocalUserMessage(trimmed) // visible immediately; ensureInitialPromptMessage deduplicates
        Task { await beginConversation(initialPromptOverride: trimmed) }
    }

    private func submitAndScroll(_ answer: String) {
        Task {
            do {
                try await storyEngine.submitAnswer(answer)
                // Auto-scroll handled by onChange
            } catch {
                presentFlowError(error, context: "Submitting story answer")
            }
        }
    }

    private func finishConversation() {
        if selectedType == .song, setup.style == nil {
            activeAlert = .genreRequired
            return
        }

        let result = storyFlowCoordinator.completeFlow(
            selectedType: selectedType,
            setup: setup,
            songFlow: songFlow,
            poemFlow: poemFlow,
            engine: storyEngine
        )
        songFlow = result.songFlow
        poemFlow = result.poemFlow

        if let message = result.errorMessage {
            presentFlowMessage(message)
            return
        }

        // Route based on flow type
        switch result.nextState {
        case .poemCreating:
            Task { await checkEntitlementsForPoem() }
        default:
            Task { await checkEntitlementsForSong() }
        }
    }

    private func checkEntitlementsForSong() async {
        do {
            let entitlements = try await apiClient.getBillingEntitlements()
            if entitlements.songsRemaining > 0 {
                advanceAfterEntitlementCheck()
            } else {
                pendingEntitlementFlowType = .song
                activeSheet = .upgrade
            }
        } catch {
            #if DEBUG
            print("[UnifiedCreateFlow] Entitlement check failed: \(error.localizedDescription)")
            #endif
            presentFlowMessage("Unable to verify your account. Please check your connection and try again.")
        }
    }

    private func checkEntitlementsForPoem() async {
        do {
            let entitlements = try await apiClient.getBillingEntitlements()
            if entitlements.poemsRemaining > 0 {
                withAnimation { phase = .poemCreating }
            } else {
                pendingEntitlementFlowType = .poem
                activeSheet = .upgrade
            }
        } catch {
            #if DEBUG
            print("[UnifiedCreateFlow] Poem entitlement check failed: \(error.localizedDescription)")
            #endif
            presentFlowMessage("Unable to verify your account. Please check your connection and try again.")
        }
    }

    /// After entitlements pass, advance to voice selection or skip if instrumental/first-time.
    private func advanceAfterEntitlementCheck() {
        if songFlow.isInstrumental {
            // Instrumental: skip voice selection, go straight to track creation
            withAnimation { songProgress = .voiceSelected }
            Task { await applyVoiceAndCreateTrack() }
        } else if !hasCompletedFirstSong {
            // First-time user: auto-select AI female voice, skip voice chips
            songFlow.voiceMode = .aiVoice
            songFlow.voiceGender = .female
            withAnimation { songProgress = .voiceSelected }
            Task { await applyVoiceAndCreateTrack() }
        } else {
            withAnimation { songProgress = .confirmed }
        }
    }

    // MARK: - Resume Reconstruction

    /// Rebuild all inline song state from persisted track/version IDs.
    /// Sets both view state and coordinator state, creates controllers,
    /// and fetches server state to derive the correct songProgress.
    /// Inject a synthetic resume message when no matching chat session exists on disk.
    private func injectResumeContext(storyId: String?, target: CreateFlowResumeTarget?) {
        let progressLabel: String = switch target {
        case .trackPlayer: "your song is ready to play"
        default: "your lyrics are ready for review"
        }
        let message = V2Message(
            role: .ai,
            content: "Welcome back! Resuming where you left off — \(progressLabel)."
        )
        storyEngine.messages = [message]
    }

    private func rebuildInlineSongState(trackId: String, versionNum: Int, storyId: String?, target: CreateFlowResumeTarget?) {
        didStartConversation = true
        allowsLegacyPreviewContinuation = false

        // Set track/version on coordinator for resume and downstream reads
        songFlow.currentTrackId = trackId
        songFlow.currentVersionNum = versionNum
        songFlow.currentStoryId = storyId

        // Lyrics controller
        makeLyricsController(trackId: trackId, versionNum: versionNum, storyId: storyId)

        // Initial songProgress — server fetch refines this
        switch target {
        case .trackPlayer:
            // Use a neutral render-state placeholder until the server tells us
            // whether this version is legacy preview, active full render, or ready.
            songProgress = .fullRenderActive
            Task { await resumePlayerStateFromServer(trackId: trackId, versionNum: versionNum) }
        default:
            songProgress = .trackCreated
            Task { await resumeLyricsState() }
        }
    }

    /// Wire shared render controller callbacks used by both fresh render and resume.
    private func wireRenderCallbacks() {
        playbackController.onPlaybackFinished = {
            ReviewManager.shared.recordSuccessfulPlay()
        }
        renderController.onPreviewComplete = { [self] result in
            allowsLegacyPreviewContinuation = true
            applyTrackMetadata(title: result.trackTitle, coverUrl: result.coverImageUrl)
            if !result.recipientName.isEmpty { setup.recipientName = result.recipientName }
            playbackController.trackTitle = result.trackTitle
            playbackController.artistName = setup.recipientName
            playbackController.setupPlayer(url: result.audioURL)
            playbackController.play()
            songProgress = .previewReady
        }
        renderController.onFullRenderComplete = { [self] result in
            allowsLegacyPreviewContinuation = false
            applyTrackMetadata(title: result.trackTitle, coverUrl: result.coverImageUrl)
            if !result.recipientName.isEmpty { setup.recipientName = result.recipientName }
            playbackController.trackTitle = result.trackTitle
            playbackController.artistName = setup.recipientName
            playbackController.switchAudio(url: result.audioURL)
            playbackController.play()
            songProgress = .fullRenderReady
        }
    }

    /// Fetch track from server, restore display metadata, and derive correct songProgress.
    private func resumePlayerStateFromServer(trackId: String, versionNum: Int) async {
        wireRenderCallbacks()

        do {
            let response = try await apiClient.getTrack(trackId: trackId)
            let track = response.track

            // Restore display metadata (needed by player card, share sheet, chat header)
            applyTrackMetadata(title: track.title, coverUrl: track.coverImageUrl)
            if let name = track.recipientName, !name.isEmpty {
                setup.recipientName = name
            }

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                if let url = version.fullUrl {
                    allowsLegacyPreviewContinuation = false
                    let resolved = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    playbackController.setupPlayer(url: resolved)
                    songProgress = .fullRenderReady
                } else if version.fullJobId != nil, version.status != "failed" {
                    allowsLegacyPreviewContinuation = false
                    songProgress = .fullRenderActive
                    renderController.startFullRender(trackId: trackId, versionNum: versionNum)
                } else if let url = version.previewUrl {
                    allowsLegacyPreviewContinuation = true
                    let resolved = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    playbackController.setupPlayer(url: resolved)
                    songProgress = .previewReady
                } else if version.previewJobId != nil {
                    // Legacy preview render in progress — keep continuation path available.
                    allowsLegacyPreviewContinuation = true
                    songProgress = .lyricsApproved
                    renderController.startPreviewRender(trackId: trackId, versionNum: versionNum)
                } else if version.status == "failed" {
                    if version.fullJobId != nil {
                        allowsLegacyPreviewContinuation = false
                        songProgress = .fullRenderActive
                        renderController.startFullRender(trackId: trackId, versionNum: versionNum)
                    } else if version.previewJobId != nil || version.previewUrl != nil {
                        allowsLegacyPreviewContinuation = true
                        songProgress = .lyricsApproved
                        renderController.startPreviewRender(trackId: trackId, versionNum: versionNum)
                    } else {
                        allowsLegacyPreviewContinuation = false
                        songProgress = .trackCreated
                        await resumeLyricsState()
                    }
                } else {
                    // No render exists — fall back to lyrics review
                    allowsLegacyPreviewContinuation = false
                    songProgress = .trackCreated
                    await resumeLyricsState()
                }
            }
        } catch {
            #if DEBUG
            print("[UnifiedCreateFlow] Resume player state failed: \(error.localizedDescription)")
            #endif
            allowsLegacyPreviewContinuation = false

            if case APIClientError.httpError(statusCode: 404, _) = error {
                // Track no longer exists on server — offer a fresh start
                CreateFlowStore.shared.clear()
                activeAlert = .staleResume
            } else {
                presentFlowMessage(
                    "We couldn't reconnect to your song. Your previous render may still be processing. Please retry once you're back online."
                )
                songProgress = .trackCreated
            }
        }
    }

    /// Fetch lyrics from server for resume
    private func resumeLyricsState() async {
        guard let controller = lyricsController else { return }
        controller.loadExistingLyricsOrGenerate()
        createdLyrics = controller.lyrics
    }

    /// Wire lyrics controller approval callback — called after every lyricsController creation.
    private func wireLyricsControllerCallbacks() {
        lyricsController?.onApproved = { [self] in
            allowsLegacyPreviewContinuation = false
            songProgress = .fullRenderActive
            startFullRender()
        }
    }

    // MARK: - Inline Song Actions

    /// After voice is selected, apply it and start track creation
    private func applyVoiceAndCreateTrack() async {
        // Apply voice mode to existing track if we have one
        if songFlow.currentTrackId != nil {
            let result = await songFlow.applyVoiceSelection(using: asyncService)
            if let error = result.error {
                presentFlowMessage(error)
            }
        }

        // Wire lyrics callback
        trackCreationController.onLyricsGenerated = { [self] lyrics in
            createdLyrics = lyrics
        }

        startTrackCreation()
    }

    /// Start full render directly after lyrics approval, or continue from a legacy preview.
    private func startFullRender() {
        guard !isStartingFullRender else { return }
        isStartingFullRender = true
        Task {
            do {
                let entitlements = try await apiClient.getBillingEntitlements()
                guard entitlements.songsRemaining > 0 else {
                    pendingEntitlementFlowType = .song
                    activeSheet = .upgrade
                    isStartingFullRender = false
                    return
                }

                guard let trackId = songFlow.currentTrackId,
                      let versionNum = songFlow.currentVersionNum else {
                    presentFlowMessage("Track data not available. Please try again.")
                    isStartingFullRender = false
                    return
                }

                songProgress = .fullRenderActive
                isStartingFullRender = false
                wireRenderCallbacks()
                renderController.startFullRender(trackId: trackId, versionNum: versionNum)
            } catch {
                presentFlowError(error, context: "Starting full render")
                isStartingFullRender = false
                songProgress = allowsLegacyPreviewContinuation ? .previewReady : .trackCreated
            }
        }
    }


    // MARK: - Helpers

    // moodPill, setupToggleChip, iconForBeat, isFailed → moved to extracted child views

    // MARK: - Poem Creating Phase (Phase 7)

    private var poemCreatingPhase: some View {
        PoemCreatingContentView(
            apiClient: apiClient,
            storyId: poemFlow.storyId,
            storyDraftVersion: storyEngine.narrativeVersion,
            finalNotes: storyEngine.finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : storyEngine.finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines),
            onPoemReady: { poem in
                let nextState = poemFlow.storeGeneratedPoem(poem)
                mapPoemState(nextState)
            },
            onNeedsInput: { guidance in
                applyStoryGuidanceAndReturnToConversation(guidance)
            },
            onNeedsDetails: { gaps, question in
                let nextState = poemFlow.storeGap(gaps: gaps, question: question)
                mapPoemState(nextState)
            },
            onError: { msg in
                presentFlowMessage(msg)
                phase = .chat
            },
            onCancel: {
                withAnimation { phase = .chat }
            }
        )
    }

    // MARK: - Poem Gap Phase

    private var poemGapPhase: some View {
        PoemGapContentView(
            question: poemFlow.gapQuestion,
            onSubmit: { detail in
                Task {
                    let result = await poemFlow.submitGapDetail(detail: detail, using: asyncService)
                    await MainActor.run {
                        if let nextState = result.nextState {
                            mapPoemState(nextState)
                        } else if let message = result.errorMessage {
                            presentFlowMessage(message)
                        }
                    }
                }
            },
            onCancel: {
                withAnimation { phase = .chat }
            }
        )
    }

    // MARK: - Poem Preview Phase

    private var poemPreviewPhase: some View {
        PoemPreviewContentView(
            poem: poemFlow.currentPoem,
            apiClient: apiClient,
            onRegenerate: {
                let nextState = poemFlow.regenerateState()
                mapPoemState(nextState)
            },
            onDone: { poem in
                if let onPoemComplete {
                    onPoemComplete(poem)
                } else {
                    ToastService.shared.success("Poem saved to your library!")
                    LocalCache.shared.invalidatePoems()
                }
                onCancel()
            }
        )
    }

    // MARK: - Poem State Mapper

    private func mapPoemState(_ state: CreateFlowState) {
        switch state {
        case .poemCreating:
            withAnimation { phase = .poemCreating }
        case .poemGap:
            withAnimation { phase = .poemGap }
        case .poemPreview:
            withAnimation { phase = .poemPreview }
        default:
            withAnimation { phase = .chat }
        }
    }
}
