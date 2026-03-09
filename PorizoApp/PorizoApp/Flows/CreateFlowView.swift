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
    private let asyncService: CreateFlowAsyncService
    private let resumeCoordinator: CreateFlowResumeCoordinator
    private let storyFlowCoordinator: StoryFlowCoordinator
    private let lifecycleCoordinator: CreateFlowLifecycleCoordinator
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
    @State private var apiWrapper: APIClientWrapper

    // UI state
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""
    @State private var showSpeechInput: Bool = false

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
        self.asyncService = CreateFlowAsyncService(apiClient: apiClient)
        self.resumeCoordinator = CreateFlowResumeCoordinator()
        self.storyFlowCoordinator = StoryFlowCoordinator()
        self.lifecycleCoordinator = CreateFlowLifecycleCoordinator()
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
        _apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
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
                flowState = lifecycleCoordinator.retryState(for: selectedType)
            }
            Button("Start Over") {
                restartAtTypeSelection()
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
            .environment(apiWrapper)
        }
        .onAppear(perform: initializeFlow)
        .onChange(of: preselectedType) { _, _ in
            guard flowState == .typeSelection, let forcedType = preselectedType else { return }
            applyPreselectedType(forcedType)
        }
        .onChange(of: flowState) { oldValue, newValue in
            #if DEBUG
            print("[CreateFlowView] Flow state changed: \(oldValue) → \(newValue)")
            #endif
            resumeCoordinator.persistResumeState(
                flowState: flowState,
                selectedType: selectedType,
                songFlow: songFlow,
                poemFlow: poemFlow,
                storyId: storyEngine.storyId
            )
        }
        .onChange(of: songFlow.currentTrackId) { _, _ in
            resumeCoordinator.persistResumeState(
                flowState: flowState,
                selectedType: selectedType,
                songFlow: songFlow,
                poemFlow: poemFlow,
                storyId: storyEngine.storyId
            )
        }
        .onChange(of: songFlow.currentVersionNum) { _, _ in
            resumeCoordinator.persistResumeState(
                flowState: flowState,
                selectedType: selectedType,
                songFlow: songFlow,
                poemFlow: poemFlow,
                storyId: storyEngine.storyId
            )
        }
        .onChange(of: poemFlow.storyId) { _, _ in
            resumeCoordinator.persistResumeState(
                flowState: flowState,
                selectedType: selectedType,
                songFlow: songFlow,
                poemFlow: poemFlow,
                storyId: storyEngine.storyId
            )
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
                    Task { await beginStoryConversation() }
                },
                onBack: {
                    flowState = .createMerged
                },
                onCancel: {
                    dismissCreateFlow()
                },
                contentKind: selectedType == .poem ? .poem : .song
            )
            .environment(apiWrapper)

        case .voice:
            VoiceModeSelectionView(
                apiClient: apiClient,
                onSelect: { mode in
                    songFlow.voiceMode = mode
                    Task {
                        let result = await songFlow.applyVoiceSelection(using: asyncService)
                        await MainActor.run {
                            flowState = result.state
                            if let errorMsg = result.error { presentError(errorMsg) }
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
                    Task { await beginStoryConversation() }
                },
                onCancel: {
                    flowState = songFlow.customCreateCancelState()
                },
                contentKind: selectedType == .poem ? .poem : .song,
                primaryCtaTitle: createCtaTitle,
                primaryCtaIcon: createCtaIcon
            )
            .environment(apiWrapper)

        case .storyConversation:
            StoryConversationContentView(
                engine: storyEngine,
                apiWrapper: apiWrapper,
                creationNoun: creationNoun,
                onContinue: finishStoryConversation,
                onDismiss: dismissCreateFlow
            )

        case .creatingTrack:
            CreatingTrackContentView(
                apiClient: apiClient,
                context: songFlow.storyContext,
                voiceMode: songFlow.voiceMode,
                onTrackCreated: { trackId, versionNum, lyrics in
                    flowState = songFlow.storeCreatedTrackAndAdvance(
                        trackId: trackId,
                        versionNum: versionNum,
                        storyId: songFlow.storyContext?.storyId,
                        lyrics: lyrics,
                        originState: .storyConversation
                    )
                },
                onError: presentError,
                onCancel: {
                    flowState = songFlow.cancelTrackCreationState()
                }
            )

        case .lyricsReview:
            LyricsReviewContentView(
                apiClient: apiClient,
                trackId: songFlow.currentTrackId,
                versionNum: songFlow.currentVersionNum,
                storyId: songFlow.activeStoryId,
                initialLyrics: songFlow.initialLyrics,
                highlightTerms: songFlow.renderPolicyTerms,
                onApproved: { trackId, versionNum in
                    let nextState = songFlow.approveLyrics(for: selectedType)
                    #if DEBUG
                    print("[CreateFlowView] Lyrics approved! Transitioning to \(nextState.rawValue). trackId=\(trackId), versionNum=\(versionNum)")
                    #endif
                    flowState = nextState
                },
                onBack: {
                    flowState = songFlow.lyricsReviewBackState()
                },
                onError: presentError
            )

        case .trackPlayer:
            TrackPlayerContentView(
                apiClient: apiClient,
                trackId: songFlow.currentTrackId,
                versionNum: songFlow.currentVersionNum,
                allowedRerollTypes: allowedRerollTypes,
                rerollLimit: maxSongRerolls,
                rerollsUsed: songRerollsUsed,
                onDone: { trackId, versionNum in
                    clearAllState()
                    onComplete(trackId, versionNum)
                },
                onNewSong: restartAtTypeSelection,
                onRerollComplete: { newVersionNum in
                    songFlow.updateCurrentVersion(newVersionNum)
                },
                onEditLyricsRequested: { terms in
                    flowState = songFlow.prepareLyricsEdit(terms: terms)
                },
                onRerollUsed: {
                    let updatedRerolls = songRerollsUsed + 1
                    songRerollsUsed = updatedRerolls
                    onSongRerollUsed?(updatedRerolls)
                }
            )

        case .poemCreating:
            PoemCreatingContentView(
                apiClient: apiClient,
                storyId: poemFlow.storyId,
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
                onError: presentError,
                onCancel: cancelPoemFlow
            )

        case .poemGap:
            PoemGapContentView(
                question: poemFlow.gapQuestion,
                onSubmit: { detail in
                    Task {
                        let result = await poemFlow.submitGapDetail(detail: detail, using: asyncService)
                        if let nextState = result.nextState {
                            await MainActor.run {
                                flowState = nextState
                            }
                        } else if let message = result.errorMessage {
                            await MainActor.run {
                                presentError(message)
                            }
                        }
                    }
                },
                onCancel: cancelPoemFlow
            )

        case .poemPreview:
            PoemPreviewContentView(
                poem: poemFlow.currentPoem,
                apiClient: apiClient,
                onRegenerate: {
                    flowState = poemFlow.regenerateState()
                },
                onDone: { poem in
                    if let onPoemComplete {
                        onPoemComplete(poem)
                    } else {
                        ToastService.shared.success("Poem saved to your library!")
                        LocalCache.shared.invalidatePoems()
                    }
                    finishPoemFlow()
                    onCancel()
                }
            )
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
        CreateFlowHeaderView(
            currentStepIndex: currentStepIndex,
            totalStepCount: totalStepCount,
            onClose: dismissCreateFlow
        )
    }

    // MARK: - Type Selection (v1.pen style)

    private var typeSelectionView: some View {
        CreateFlowTypeSelectionView(
            onSelectSong: { startFlow(.song) },
            onSelectPoem: { startFlow(.poem) }
        )
    }

    // MARK: - Merged Create View (07 - Create Merged)

    private var createMergedView: some View {
        CreateFlowMergedSetupView(
            selectedType: selectedType,
            setup: $setup,
            isInstrumental: $songFlow.isInstrumental,
            hasOwnLyrics: $songFlow.hasOwnLyrics,
            canContinue: canContinueFromMerged,
            onBack: { flowState = .typeSelection },
            onContinue: { flowState = songFlow.mergedContinueState() }
        )
    }

    private var canContinueFromMerged: Bool {
        !setup.recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
        lifecycleCoordinator.startFlow(
            type: type,
            selectedType: &selectedType,
            flowState: &flowState,
            songFlow: &songFlow,
            engine: storyEngine
        )
    }

    private func beginStoryConversation() async {
        clearError()
        flowState = storyFlowCoordinator.conversationEntryState()

        let result = await storyFlowCoordinator.startConversation(
            setup: setup,
            songFlow: songFlow,
            engine: storyEngine,
            asyncService: asyncService
        )

        if let message = result.errorMessage {
            presentError(message)
            flowState = result.nextState
        }
    }

    private func finishStoryConversation() {
        let result = storyFlowCoordinator.completeFlow(
            selectedType: selectedType,
            setup: setup,
            songFlow: songFlow,
            poemFlow: poemFlow,
            engine: storyEngine
        )
        songFlow = result.songFlow
        poemFlow = result.poemFlow
        flowState = result.nextState
        if let message = result.errorMessage {
            presentError(message)
        }
    }

    private func presentError(_ message: String) {
        lifecycleCoordinator.presentError(
            message,
            errorMessage: &errorMessage,
            showError: &showError
        )
    }

    private func clearError() {
        lifecycleCoordinator.clearError(
            errorMessage: &errorMessage,
            showError: &showError
        )
    }

    private func dismissCreateFlow() {
        clearAllState()
        onCancel()
    }

    private func clearAllState() {
        lifecycleCoordinator.clearAll(
            preselectedOccasion: preselectedOccasion,
            selectedType: &selectedType,
            setup: &setup,
            songFlow: &songFlow,
            poemFlow: &poemFlow,
            errorMessage: &errorMessage,
            showError: &showError,
            engine: storyEngine
        )
    }

    private func restartAtTypeSelection() {
        lifecycleCoordinator.restartAtTypeSelection(
            preselectedOccasion: preselectedOccasion,
            flowState: &flowState,
            selectedType: &selectedType,
            setup: &setup,
            songFlow: &songFlow,
            poemFlow: &poemFlow,
            errorMessage: &errorMessage,
            showError: &showError,
            engine: storyEngine
        )
    }

    private func cancelPoemFlow() {
        lifecycleCoordinator.cancelPoemFlow(
            flowState: &flowState,
            songFlow: &songFlow,
            poemFlow: &poemFlow,
            errorMessage: &errorMessage,
            showError: &showError,
            engine: storyEngine
        )
    }

    private func finishPoemFlow() {
        lifecycleCoordinator.finishPoemFlow(
            songFlow: &songFlow,
            poemFlow: &poemFlow,
            errorMessage: &errorMessage,
            showError: &showError,
            engine: storyEngine
        )
    }

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
            flowState = songFlow.resume(
                trackId: trackId,
                versionNum: versionNum,
                storyId: storyId,
                target: target
            )

        case let .variationSourcePoem(variationSetup):
            selectedType = .poem
            setup = variationSetup
            flowState = .createMode

        case let .restoredStory(kind, session):
            let restored = resumeCoordinator.restoreStorySession(
                kind: kind,
                session: session,
                engine: storyEngine
            )
            selectedType = restored.kind
            setup = restored.setup
            songFlow = restored.songFlow
            flowState = .storyConversation
            Task {
                await refreshRestoredStorySession()
            }

        case let .restoredPoem(storyId):
            selectedType = .poem
            flowState = poemFlow.restoreResume(storyId: storyId)

        case let .freshStart(initialSetup, forcedType):
            clearAllState()
            setup = initialSetup
            flowState = .typeSelection
            if let forcedType {
                applyPreselectedType(forcedType)
            }
        }
    }

    private func applyPreselectedType(_ forcedType: CreateFlowKind) {
        lifecycleCoordinator.applyPreselectedType(
            forcedType,
            selectedType: &selectedType,
            flowState: &flowState,
            songFlow: &songFlow,
            engine: storyEngine
        )
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
}

#Preview {
    CreateFlowView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onComplete: { _, _ in },
        onCancel: { }
    )
}
