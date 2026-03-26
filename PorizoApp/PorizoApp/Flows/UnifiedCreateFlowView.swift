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

    // Flow phase
    // MARK: - Phase Model

    /// Coarse phase for top-level routing (persisted for resume)
    enum UnifiedPhase {
        case typeSelection // Song vs Poem picker
        case setup         // Resume/variation bootstrap only
        case chat          // Main phase — inline cards accumulate here
        // Poem phases (unchanged, still full-screen)
        case poemCreating
        case poemGap
        case poemPreview
    }

    /// Song lifecycle within .chat phase (drives inline card visibility + resume)
    enum SongProgress: String, Codable {
        case conversing       // Story chat active
        case confirmed        // Story confirmed, voice selection pending
        case voiceSelected    // Voice chosen, track creation pending/active
        case trackCreated     // Track + lyrics exist, lyrics review active
        case lyricsApproved   // Legacy preview render active
        case previewReady     // Legacy-only preview rendered, player showing
        case fullRenderActive // Full render in progress
        case fullRenderReady  // Full song rendered
    }

    // MARK: - Presentation Router
    //
    // Centralizes all modal presentations to prevent simultaneous sheet collisions.
    // SwiftUI silently drops the second `.sheet` when two trigger simultaneously.
    // Sheets and fullScreenCovers share one slot; alerts get their own.

    /// Single slot for sheets and fullScreenCovers (mutually exclusive).
    enum ActiveSheet: Identifiable {
        case upgrade
        case customLyrics
        case voiceEnrollment
        case share(ShareSheetPayload)
        case editLyrics(EditingLyricsSection)
        case speechInput(SpeechInputContext)

        var id: String {
            switch self {
            case .upgrade:          return "upgrade"
            case .customLyrics:     return "customLyrics"
            case .voiceEnrollment:  return "voiceEnrollment"
            case .share:            return "share"
            case .editLyrics:       return "editLyrics"
            case .speechInput:      return "speechInput"
            }
        }
    }

    /// Single slot for alerts and confirmation dialogs (mutually exclusive,
    /// but can coexist with an active sheet).
    enum ActiveAlert: Identifiable {
        case error(String)
        case genreRequired
        case doneWarning(DoneWarningKind)
        case discardLyricsEdits
        case rerollMenu
        case staleResume

        var id: String {
            switch self {
            case .error:              return "error"
            case .genreRequired:      return "genreRequired"
            case .doneWarning:        return "doneWarning"
            case .discardLyricsEdits: return "discardLyricsEdits"
            case .rerollMenu:         return "rerollMenu"
            case .staleResume:        return "staleResume"
            }
        }
    }

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

    // Card collapse state (completed phases collapse to summaries)
    @State private var expandedPhases: Set<String> = []

    // Task handles
    @State private var creationTask: Task<Void, Never>?
    @State private var styleSyncTask: Task<Void, Never>?

    // Presentation router (replaces 11 individual @State booleans)
    @State private var activeSheet: ActiveSheet?
    @State private var activeAlert: ActiveAlert?

    // Reroll
    @State private var isRerolling = false
    @State private var isStartingFullRender = false

    struct EditingLyricsSection: Identifiable {
        let id: Int
    }

    enum DoneWarningKind: String, Identifiable {
        case previewOnly
        case fullRenderInProgress
        var id: String { rawValue }
    }

    @State private var songRerollsUsed: Int = 0

    // Lifecycle
    @State private var didInitializeFlow = false
    @State private var didStartConversation = false

    // Flow state
    @State private var enrollmentCompletedProfile: VoiceProfile?
    @State private var showOccasionPicker = false
    @State private var allowsLegacyPreviewContinuation = false
    @State private var myVoiceEnabled = true
    @State private var preSessionPrompt: String?
    @State private var showSongOptionsCard = false

    // Scroll back-off: don't auto-scroll if user scrolled up to read
    @State private var userHasScrolledUp = false

    // Share
    @State private var shareController: ShareController?

    struct ShareSheetPayload: Identifiable {
        let id = UUID()
        let controller: ShareController
        let trackId: String
        let versionNum: Int
        let trackTitle: String
        let recipientName: String
    }

    // Scroll
    @State private var scrollProxy: ScrollViewProxy?

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
                get: {
                    guard let alert = activeAlert else { return false }
                    if case .rerollMenu = alert { return false }
                    return true
                },
                set: { if !$0 { activeAlert = nil } }
            )
        ) {
            alertActions
        } message: {
            alertMessage
        }
        // Reroll uses confirmationDialog (action sheet style) — separate modifier
        .confirmationDialog(
            "Reroll",
            isPresented: Binding(
                get: { if case .rerollMenu = activeAlert { return true }; return false },
                set: { if !$0 { activeAlert = nil } }
            )
        ) {
            ForEach(allowedRerollTypes, id: \.rawValue) { type in
                Button(type.displayName) { performReroll(type: type) }
                    .disabled(!canPerformReroll || isRerolling)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            if let remaining = rerollsRemaining {
                Text("Retries left: \(remaining)")
            }
        }
        // MARK: - Sheet Router (single slot for all sheets)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .upgrade:
                SubscriptionView(apiClient: apiClient, storeKit: StoreKitManager(apiClient: apiClient))

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

    @State private var inlineNameInput: String = ""

    private var chatPhase: some View {
        VStack(spacing: 0) {
            if !didStartConversation {
                // Inline name prompt — replaces the old full-page setup form
                inlineNamePrompt
            } else {
                // Active conversation + accumulated inline cards
                chatHeader

                // Sticky progress indicator (visible once past conversing)
                if songProgress != .conversing {
                    SongProgressIndicator(currentProgress: songProgress)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 4)
                }

                // Story Elements card (collapsible, tabbed)
                if !storyEngine.currentBeats.isEmpty && storyEngine.storyId != nil {
                    storyElementsCard
                        .padding(.horizontal, 16)
                        .padding(.top, 4)
                        .padding(.bottom, 4)
                }

                // Scrollable content: messages + inline cards
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 4) {
                            // 0a. Type selection (before type is chosen)
                            if selectedType == nil && didStartConversation && storyEngine.storyId == nil {
                                TypeSelectionChips(
                                    onSelectSong: { handleTypeSelected(.song) },
                                    onSelectPoem: { handleTypeSelected(.poem) }
                                )
                                .id("type-chips")
                            }

                            if showOccasionPicker && selectedType != nil && storyEngine.storyId == nil {
                                OccasionPickerCard(
                                    onSelect: { occasion in
                                        setup.occasion = occasion
                                        showOccasionPicker = false
                                        if let selectedType {
                                            continueAfterOccasionSelection(for: selectedType)
                                        }
                                    }
                                )
                                .id("occasion-picker")
                            }

                            // 0b. Pre-session story question (after type chosen, before session)
                            if let prompt = preSessionPrompt, selectedType != nil, storyEngine.storyId == nil {
                                chatBubbleFromText(prompt)
                                    .id("pre-session-prompt")
                            }

                            // Song options card (before session starts)
                            if showSongOptionsCard && selectedType == .song && storyEngine.storyId == nil {
                                SongOptionsCard(
                                    onContinue: {
                                        showSongOptionsCard = false
                                        showPreSessionQuestion(type: .song)
                                    },
                                    onOwnLyrics: {
                                        showSongOptionsCard = false
                                        songFlow.hasOwnLyrics = true
                                        activeSheet = .customLyrics
                                    },
                                    onInstrumental: {
                                        showSongOptionsCard = false
                                        songFlow.isInstrumental = true
                                        showPreSessionQuestion(type: .song)
                                    }
                                )
                                .id("song-options")
                            }

                            // 1. Chat messages
                            ForEach(storyEngine.messages) { msg in
                                chatBubble(msg)
                                    .id(msg.id)
                            }

                            // 2. Loading indicator
                            if storyEngine.isLoading {
                                loadingIndicator
                            }

                            // 3. Confirmation card (story complete, not yet created)
                            if storyEngine.isComplete && songProgress == .conversing {
                                confirmationSection
                                    .id("confirmation")
                            }

                            // ── Transition: Confirmation → Voice ──
                            if songProgress == .confirmed {
                                PhaseTransitionDivider(icon: "mic.fill", label: "Voice")
                            }

                            // 4. Voice selection chips
                            if songProgress == .confirmed {
                                VoiceSelectionChips(
                                    onSelect: { mode, gender in
                                        songFlow.voiceMode = mode
                                        songFlow.voiceGender = gender
                                        songProgress = .voiceSelected
                                        Task { await applyVoiceAndCreateTrack() }
                                    },
                                    onMyVoice: {
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
                                    showMyVoice: myVoiceEnabled
                                )
                                .id("voice-chips")
                            }

                            // 5. Track creation progress (show immediately on voice selection,
                            //    before isCreating flips, to avoid a trust-breaking dead zone)
                            if songProgress == .voiceSelected {
                                InlineCreatingCard(
                                    progress: trackCreationController.progress,
                                    statusMessage: trackCreationController.isCreating
                                        ? trackCreationController.statusMessage
                                        : "Setting up your song..."
                                )
                                .id("creating")
                            }

                            // ── Transition: Creating → Lyrics ──
                            if lyricsController?.lyrics ?? createdLyrics != nil {
                                PhaseTransitionDivider(icon: "music.note.list")
                            }

                            // 6. Lyrics card — collapses to summary once user moves past lyrics review
                            if let lyrics = lyricsController?.lyrics ?? createdLyrics {
                                let lyricsCompleted = songProgress != .trackCreated
                                let lyricsExpanded = expandedPhases.contains("lyrics")

                                if lyricsCompleted && !lyricsExpanded {
                                    CollapsedCardSummary(
                                        icon: "music.note.list",
                                        label: "Lyrics",
                                        detail: "\(lyrics.sections.count) sections approved",
                                        onToggle: { expandedPhases.insert("lyrics") }
                                    )
                                    .padding(.horizontal, 4)
                                    .id("lyrics")
                                } else {
                                    InlineLyricsCard(
                                        lyrics: lyrics,
                                        controller: lyricsController,
                                        isInteractive: songProgress == .trackCreated,
                                        style: setup.style.map(styleStore.displayName(for:)) ?? "Custom",
                                        highlightTerms: songFlow.renderPolicyTerms,
                                        onApproved: {
                                            lyricsController?.approveLyrics()
                                        },
                                        onRegenerateLyrics: {
                                            if lyricsController?.hasUnsavedChanges == true {
                                                activeAlert = .discardLyricsEdits
                                            } else {
                                                lyricsController?.regenerateLyrics()
                                            }
                                        },
                                        onEditSection: { index in
                                            guard let ctrl = lyricsController else { return }
                                            ctrl.startEditing(section: index)
                                            activeSheet = .editLyrics(EditingLyricsSection(id: index))
                                        }
                                    )
                                    .id("lyrics")

                                    // Show collapse button when expanded and past lyrics phase
                                    if lyricsCompleted && lyricsExpanded {
                                        Button {
                                            expandedPhases.remove("lyrics")
                                        } label: {
                                            Text("Collapse")
                                                .font(DesignTokens.bodyFont(size: 12))
                                                .foregroundStyle(DesignTokens.textTertiary)
                                        }
                                        .padding(.top, 4)
                                    }
                                }
                            }

                            // ── Transition: Lyrics → Rendering ──
                            if renderController.isRendering || isFailed(renderController) {
                                PhaseTransitionDivider(icon: "waveform", label: "Rendering")
                            }

                            // 7. Rendering progress or failure
                            if renderController.isRendering || isFailed(renderController) {
                                InlineRenderingCard(
                                    renderController: renderController,
                                    isFullRender: songProgress == .fullRenderActive,
                                    onRetry: {
                                        guard let trackId = songFlow.currentTrackId, let versionNum = songFlow.currentVersionNum else { return }
                                        if songProgress == .lyricsApproved {
                                            renderController.retryPreviewRender(trackId: trackId, versionNum: versionNum)
                                        } else {
                                            renderController.retryFullRender(trackId: trackId, versionNum: versionNum)
                                        }
                                    },
                                    onEditLyrics: { terms in
                                        songFlow.renderPolicyTerms = terms
                                        lyricsController?.onAppear(
                                            initialLyrics: createdLyrics,
                                            highlightTerms: terms
                                        )
                                        songProgress = .trackCreated
                                    }
                                )
                                .id("rendering")
                            }

                            // ── Transition: Rendering → Player ──
                            if shouldShowPlayerCard {
                                PhaseTransitionDivider(icon: "play.circle.fill", topPadding: 24, bottomPadding: 12)
                            }

                            // 8. Player card (preview or full)
                            if shouldShowPlayerCard {
                                InlinePlayerCard(
                                    playbackController: playbackController,
                                    trackTitle: trackTitle,
                                    recipientName: setup.recipientName,
                                    displayMode: playerDisplayMode,
                                    coverImageUrl: coverImageUrl,
                                    isRerolling: isRerolling,
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
                                    onReroll: { handleReroll() },
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
                                .id("player")
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 200)
                    }
                    .onAppear { scrollProxy = proxy }
                    .onChange(of: storyEngine.messages.count) { _, _ in
                        guard !userHasScrolledUp else { return }
                        if let lastMsg = storyEngine.messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMsg.id, anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: songProgress) { _, newValue in
                        // Reset back-off on major transitions — user wants to see new content
                        userHasScrolledUp = false

                        // Lazy-init share controller when entering player states
                        switch newValue {
                        case .previewReady, .fullRenderReady:
                            if shareController == nil {
                                shareController = ShareController(apiClient: apiClient)
                            }
                        case .fullRenderActive:
                            if allowsLegacyPreviewContinuation, shareController == nil {
                                shareController = ShareController(apiClient: apiClient)
                            }
                        default: break
                        }

                        let scrollTarget: String? = switch newValue {
                        case .confirmed: "voice-chips"
                        case .voiceSelected: "creating"
                        case .trackCreated: "lyrics"
                        case .lyricsApproved, .fullRenderActive: "rendering"
                        case .previewReady, .fullRenderReady: "player"
                        default: nil
                        }
                        if let target = scrollTarget {
                            withAnimation {
                                proxy.scrollTo(target, anchor: .top)
                            }
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
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                // User dragging down (scrolling up to read history)
                                if value.translation.height > 20 {
                                    userHasScrolledUp = true
                                }
                                // User dragging up to bottom — reset back-off
                                if value.translation.height < -40 {
                                    userHasScrolledUp = false
                                }
                            }
                    )
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

    /// Minimal inline name prompt shown before conversation starts.
    /// Replaces the old full-page setup form — just asks for the name,
    /// then the AI handles occasion/style discovery through chat.
    private var inlineNamePrompt: some View {
        VStack(spacing: 0) {
            // Header with close button
            HStack {
                Spacer()
                Button { onCancel() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)

            Spacer()

            VStack(spacing: 20) {
                Image(systemName: "sparkles")
                    .font(.system(size: 40))
                    .foregroundStyle(DesignTokens.gold)

                Text(selectedType == nil ? "Who is this for?" : "Who is this \(selectedType == .poem ? "poem" : "song") for?")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                Text("Enter their name to get started")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)

                TextField("Their name...", text: $inlineNameInput)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.border, lineWidth: 0.5)
                    )
                    .padding(.horizontal, 32)
                    .onSubmit { startChatWithName() }

                // Optional mode toggles
                if selectedType == .song {
                    HStack(spacing: 10) {
                        setupToggleChip(
                            "I'll write my own lyrics",
                            icon: "text.quote",
                            isOn: songFlow.hasOwnLyrics
                        ) {
                            songFlow.hasOwnLyrics.toggle()
                            if songFlow.hasOwnLyrics { songFlow.isInstrumental = false }
                        }
                        setupToggleChip(
                            "Instrumental",
                            icon: "waveform",
                            isOn: songFlow.isInstrumental
                        ) {
                            songFlow.isInstrumental.toggle()
                            if songFlow.isInstrumental { songFlow.hasOwnLyrics = false }
                        }
                    }
                    .padding(.horizontal, 32)
                }

                Button {
                    startChatWithName()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.right")
                        Text("Start")
                    }
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .disabled(inlineNameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(inlineNameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1.0)
                .padding(.horizontal, 32)
            }

            Spacer()
        }
    }

    private func startChatWithName() {
        let name = inlineNameInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        setup.recipientName = name
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

    // MARK: - Chat Header

    private var chatHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(chatHeaderTitle)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                if storyEngine.storyId != nil {
                    Text("\((setup.occasion ?? .custom).displayName)  ·  \(storyEngine.isComplete ? "Ready" : "\(storyEngine.completionScore)%")")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.gold)
                }
            }

            Spacer()

            // Completion badge (only when session active)
            if storyEngine.storyId != nil {
                HStack(spacing: 4) {
                    Image(systemName: "sparkle")
                        .font(.system(size: 9))
                    Text("\(storyEngine.completionScore)%")
                        .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                }
                .foregroundStyle(DesignTokens.gold)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.gold.opacity(0.12))
                .clipShape(Capsule())
            }

            Button { onCancel() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var chatHeaderTitle: String {
        let name = setup.recipientName
        switch selectedType {
        case .song: return "Song for \(name)"
        case .poem: return "Poem for \(name)"
        case nil: return "Create for \(name)"
        }
    }

    // MARK: - Alert Router Helpers

    /// Title for the currently active alert.
    private var alertTitle: String {
        switch activeAlert {
        case .error:              return "Error"
        case .genreRequired:      return "Pick a genre"
        case .doneWarning:        return "Leave?"
        case .discardLyricsEdits: return "Discard edits?"
        case .staleResume:        return "Song Unavailable"
        case .rerollMenu, nil:    return ""
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
        case .rerollMenu, nil:
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
        case .rerollMenu, nil:
            Text("")
        }
    }

    /// Renders text as an AI-style bubble for pre-session content.
    private func chatBubbleFromText(_ text: String) -> some View {
        Text(text)
            .aiBubbleStyle()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
    }

    // MARK: - Player Display Mode

    private var playerDisplayMode: InlinePlayerCard.PlayerDisplayMode {
        if songProgress == .previewReady {
            return .preview
        } else if isStartingFullRender || songProgress == .fullRenderActive {
            return .fullRenderInProgress
        } else if songProgress == .fullRenderReady {
            return .fullSong
        } else {
            return .preview
        }
    }

    private var shouldShowPlayerCard: Bool {
        switch songProgress {
        case .previewReady, .fullRenderReady:
            return true
        case .fullRenderActive:
            return allowsLegacyPreviewContinuation
        default:
            return false
        }
    }

    // MARK: - Story Elements Card

    @State private var isCardExpanded = false
    @State private var selectedCardTab: CardTab = .elements

    enum CardTab: String, CaseIterable {
        case elements = "Story Elements"
        case strength = "Story Strength"
    }

    private var storyElementsCard: some View {
        VStack(spacing: 0) {
            // Tab header
            HStack(spacing: 0) {
                ForEach(CardTab.allCases, id: \.self) { tab in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedCardTab = tab
                            if !isCardExpanded { isCardExpanded = true }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: tab == .elements ? "doc.text.fill" : "chart.bar.fill")
                                .font(.system(size: 11))
                            Text(tab.rawValue)
                                .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(selectedCardTab == tab ? DesignTokens.textPrimary : DesignTokens.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selectedCardTab == tab ? DesignTokens.gold.opacity(0.1) : .clear)
                    }
                }

                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { isCardExpanded.toggle() }
                } label: {
                    Image(systemName: isCardExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .frame(width: 40)
                        .padding(.vertical, 10)
                }
            }

            if isCardExpanded {
                Divider().background(DesignTokens.border.opacity(0.5))

                if selectedCardTab == .elements {
                    elementsTabContent
                } else {
                    strengthTabContent
                }
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
    }

    // Elements tab: factInventory (real data)
    private var elementsTabContent: some View {
        VStack(spacing: 0) {
            if storyEngine.factInventory.isEmpty {
                Text("Share your story to see elements appear here")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .padding(14)
            } else {
                ForEach(Array(storyEngine.factInventory.enumerated()), id: \.offset) { index, fact in
                    if index > 0 {
                        Divider().background(DesignTokens.border.opacity(0.5)).padding(.leading, 38)
                    }
                    HStack(spacing: 10) {
                        Image(systemName: iconForBeat(fact.beat))
                            .font(.system(size: 11))
                            .foregroundStyle(DesignTokens.gold)
                            .frame(width: 20)
                        Text(fact.beat ?? "Detail")
                            .font(DesignTokens.bodyFont(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .frame(width: 65, alignment: .leading)
                        Text(fact.text)
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineLimit(2)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                }
            }
        }
    }

    // Strength tab: currentBeats (real data)
    private var strengthTabContent: some View {
        let focusedElementId = storyEngine.readiness?.primaryGap?.elementId

        return VStack(spacing: 4) {
            ForEach(storyEngine.currentBeats) { beat in
                let isFocusedBeat = focusedElementId == beat.id

                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Circle()
                            .fill(!beat.isFilled ? DesignTokens.gold : DesignTokens.success)
                            .frame(width: 7, height: 7)
                        Text(beat.displayName)
                            .font(DesignTokens.bodyFont(size: 13, weight: !beat.isFilled ? .bold : .regular))
                            .foregroundStyle(!beat.isFilled ? DesignTokens.textPrimary : DesignTokens.textSecondary)
                        if isFocusedBeat {
                            Text("Current focus")
                                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                                .foregroundStyle(DesignTokens.gold.opacity(0.85))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(DesignTokens.gold.opacity(0.14), in: Capsule())
                        }
                        Spacer()
                        if beat.isFilled {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(DesignTokens.success.opacity(0.7))
                        }
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill((!beat.isFilled ? DesignTokens.gold : DesignTokens.success).opacity(0.2))
                                .frame(height: 4)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(!beat.isFilled ? DesignTokens.gold : DesignTokens.success)
                                .frame(width: geo.size.width * beat.strength, height: 4)
                        }
                    }
                    .frame(height: 4)
                }
                .padding(.horizontal, isFocusedBeat ? 10 : 0)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isFocusedBeat ? DesignTokens.gold.opacity(0.08) : .clear)
                )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    // MARK: - Chat Bubble

    private func chatBubble(_ msg: V2Message) -> some View {
        VStack(alignment: msg.role == .user ? .trailing : .leading, spacing: 4) {
            HStack {
                if msg.role == .user { Spacer(minLength: 60) }

                if msg.role == .user {
                    Text(msg.content).userBubbleStyle()
                } else {
                    Text(msg.content).aiBubbleStyle()
                }

                if msg.role == .ai { Spacer(minLength: 50) }
            }

            // Suggestion chips (if AI message has them)
            if msg.role == .ai, let suggestions = msg.suggestions, !suggestions.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(suggestions, id: \.self) { suggestion in
                            Button {
                                submitAndScroll(suggestion)
                            } label: {
                                Text(suggestion)
                                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .boldChipStyle()
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: msg.role == .user ? .trailing : .leading)
        .padding(.vertical, 4)
    }

    // MARK: - Loading Indicator

    private var loadingIndicator: some View {
        TypingIndicator()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
    }

    // MARK: - Confirmation

    private var confirmationSection: some View {
        VStack(spacing: 14) {
            // Divider
            HStack(spacing: 10) {
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("READY")
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold.opacity(0.7))
                    .tracking(1.5)
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
            }

            // Narrative summary
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("\(setup.recipientName)'s Story")
                        .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)

                    Spacer()

                    Button {
                        storyEngine.enterReviewEditMode()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil")
                                .font(.system(size: 12))
                            Text("Edit")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        }
                        .foregroundStyle(DesignTokens.gold)
                    }
                }

                Text(storyEngine.draft.displayNarrative)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(4)

                // Mood pills
                HStack(spacing: 8) {
                    moodPill(icon: "heart.fill", label: "Warm")
                    moodPill(icon: "face.smiling", label: "Playful")
                    moodPill(icon: "mountain.2.fill", label: "Adventurous")
                }

                // Style picker + Create button moved to CollapsibleStylePicker in bottom bar
            }
            .padding(16)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
            )
        }
        .padding(.top, 12)
        .id("confirmation")
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
                let result = try await trackCreationController.createTrack(
                    storyContext: context,
                    voiceMode: songFlow.voiceMode,
                    voiceGender: songFlow.voiceGender
                )
                try Task.checkCancellation()

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
            } catch is CancellationError {
                // User cancelled — already returned to chat
            } catch {
                guard !Task.isCancelled else { return }
                presentFlowError(error, context: "Starting track creation")
                songProgress = .confirmed // Return to voice chips so user can retry
            }
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
            withAnimation { phase = .poemCreating }
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
                activeSheet = .upgrade
            }
        } catch {
            #if DEBUG
            print("[UnifiedCreateFlow] Entitlement check failed, proceeding: \(error.localizedDescription)")
            #endif
            advanceAfterEntitlementCheck()
        }
    }

    /// After entitlements pass, advance to voice selection or skip if instrumental.
    private func advanceAfterEntitlementCheck() {
        if songFlow.isInstrumental {
            // Instrumental: skip voice selection, go straight to track creation
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

    /// Show reroll type picker
    private func handleReroll() {
        activeAlert = .rerollMenu
    }

    /// Execute a reroll with the selected type — full guardrails from TrackPlayerFullView
    private func performReroll(type: RerollType) {
        guard !isRerolling else { return }
        guard allowedRerollTypes.contains(type) else { return }
        guard let trackId = songFlow.currentTrackId, let versionNum = songFlow.currentVersionNum else { return }
        if let limit = maxSongRerolls, songRerollsUsed >= limit { return }

        isRerolling = true
        playbackController.cleanup()
        renderController.cancelAll()
        shareController?.reset()

        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "reroll") {
                    try await self.apiClient.reroll(
                        trackId: trackId,
                        versionNum: versionNum,
                        rerollType: type
                    )
                }
                songRerollsUsed += 1
                onSongRerollUsed?(songRerollsUsed)

                songFlow.currentVersionNum = response.newVersionNum

                // Clear render/player/share state
                createdLyrics = nil

                // New lyrics controller for new version
                makeLyricsController(trackId: trackId, versionNum: response.newVersionNum)
                songProgress = .trackCreated
                await resumeLyricsState()

                ToastService.shared.success("New version created!")
            } catch {
                presentFlowError(error, context: "Rerolling song")
            }
            isRerolling = false
        }
    }

    private var canPerformReroll: Bool {
        guard let rerollLimit = maxSongRerolls else { return true }
        return songRerollsUsed < rerollLimit
    }

    private var rerollsRemaining: Int? {
        guard let rerollLimit = maxSongRerolls else { return nil }
        return max(rerollLimit - songRerollsUsed, 0)
    }

    // MARK: - Helpers

    private func moodPill(icon: String, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9))
            Text(label)
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
        }
        .foregroundStyle(DesignTokens.gold)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(DesignTokens.gold.opacity(0.1))
        .clipShape(Capsule())
    }

    private func setupToggleChip(_ label: String, icon: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isOn ? DesignTokens.gold.opacity(0.15) : DesignTokens.surface)
            .foregroundStyle(isOn ? DesignTokens.gold : DesignTokens.textTertiary)
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(isOn ? DesignTokens.gold.opacity(0.3) : DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }

    private func isFailed(_ controller: RenderController) -> Bool {
        if case .failed = controller.renderPhase { return true }
        if case .failed = controller.fullRenderPhase { return true }
        return false
    }

    private func iconForBeat(_ beat: String?) -> String {
        switch beat?.lowercased() {
        case "setting": return "mountain.2.fill"
        case "feeling": return "heart.fill"
        case "bond": return "person.2.fill"
        case "moment": return "camera.fill"
        case "details": return "sparkle"
        case "relationship": return "heart.circle.fill"
        default: return "circle.fill"
        }
    }

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
