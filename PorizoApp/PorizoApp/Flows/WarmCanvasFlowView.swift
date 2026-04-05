//
//  WarmCanvasFlowView.swift
//  PorizoApp
//
//  Warm Canvas create flow — Four User Moments: Tell → Wait → Reveal → Share.
//
//  Layered ZStack architecture: Tell stays mounted; Wait/Reveal/Share overlay on top.
//  Song-only — poems route to UnifiedCreateFlowView via MainTabView (line 159).
//
//  Controllers and coordinators are reused identically from UnifiedCreateFlowView.
//  The difference is the visual topology (overlays vs inline cards) and the state machine
//  (WarmCanvasMoment vs UnifiedPhase + SongProgress).
//

import SwiftUI

struct WarmCanvasFlowView: View {
    let apiClient: APIClient
    var storeKit: StoreKitManager
    var preselectedOccasion: Occasion?
    var preselectedType: CreateFlowKind?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    var resumeTarget: CreateFlowResumeTarget?
    var variationSourcePoem: Poem?
    var alwaysShowVoiceSelection: Bool = false
    var isGiftContext: Bool = false
    var onPoemComplete: ((Poem) -> Void)? = nil
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    // MARK: - Moment Tracking

    @State private var moment: WarmCanvasMoment = .tell(.nameEntry)
    @State private var activeError: WarmCanvasError?

    // MARK: - Environment

    @Environment(\.scenePhase) private var scenePhase
    @Environment(StyleStore.self) private var styleStore
    @Environment(STTRouter.self) private var sttRouter

    // MARK: - Engine + Coordinators

    @State private var storyEngine: V2StoryEngine
    @State private var apiWrapper: APIClientWrapper
    @State private var setup = StorySetup()
    @State private var songFlow = SongFlowCoordinator()
    @State private var selectedType: CreateFlowKind? = .song
    @State private var poemFlow = PoemFlowCoordinator()
    @State private var asyncService: CreateFlowAsyncService
    @State private var storyFlowCoordinator: StoryFlowCoordinator
    @State private var resumeCoordinator: CreateFlowResumeCoordinator

    // MARK: - Controllers

    @State private var trackCreationController: TrackCreationController
    @State private var playbackController = PlaybackController()
    @State private var renderController: RenderController
    @State private var lyricsController: LyricsReviewController?
    @State private var createdLyrics: Lyrics?
    @State private var shareController: ShareController?

    // MARK: - Track Metadata

    @State private var trackTitle: String = "Your Song"
    @State private var coverImageUrl: String?

    // MARK: - Task Handles

    @State private var creationTask: Task<Void, Never>?
    @State private var styleSyncTask: Task<Void, Never>?
    @State private var renderTimeoutTask: Task<Void, Never>?
    @State private var flowTask: Task<Void, Never>?  // Tracks unstructured Tasks (entitlements, voice, conversation)

    // MARK: - Presentation Router

    @State private var activeSheet: ActiveSheet?
    @State private var activeAlert: ActiveAlert?
    @State private var isStartingFullRender = false

    // MARK: - Lifecycle

    @State private var didInitializeFlow = false
    @State private var didStartConversation = false

    // MARK: - Flow State

    @AppStorage("hasCompletedFirstSong") private var hasCompletedFirstSong = false
    @State private var enrollmentCompletedProfile: VoiceProfile?
    @State private var pendingEntitlementFlowType: CreateFlowKind?
    @State private var myVoiceEnabled = true
    @State private var pendingSpeechText: String?
    @State private var isInputActive: Bool = false
    @State private var showOccasionPicker = false
    @State private var preSessionPrompt: String?

    // MARK: - Init

    init(
        apiClient: APIClient,
        storeKit: StoreKitManager,
        preselectedOccasion: Occasion? = nil,
        preselectedType: CreateFlowKind? = nil,
        resumeTrackId: String? = nil,
        resumeVersionNum: Int? = nil,
        resumeTarget: CreateFlowResumeTarget? = nil,
        variationSourcePoem: Poem? = nil,
        alwaysShowVoiceSelection: Bool = false,
        isGiftContext: Bool = false,
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
        self.alwaysShowVoiceSelection = alwaysShowVoiceSelection
        self.isGiftContext = isGiftContext
        self.onPoemComplete = onPoemComplete
        self.onComplete = onComplete
        self.onCancel = onCancel
        _asyncService = State(initialValue: CreateFlowAsyncService(apiClient: apiClient))
        _storyFlowCoordinator = State(initialValue: StoryFlowCoordinator())
        _resumeCoordinator = State(initialValue: CreateFlowResumeCoordinator())
        _storyEngine = State(initialValue: V2StoryEngine(apiClient: apiClient))
        _apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
        _selectedType = State(initialValue: .song)
        _trackCreationController = State(initialValue: TrackCreationController(apiClient: apiClient))
        _renderController = State(initialValue: RenderController(apiClient: apiClient))
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            // Layer 0: Tell phase (stays mounted during all .tell sub-phases)
            if case .tell = moment {
                tellPhase()
            }

            // Layer 1: Full-screen overlays (animation scoped per-view, not on ZStack)
            if moment == .wait {
                WaitPulseView(recipientName: setup.recipientName, occasion: setup.occasion?.rawValue)
                    .transition(.opacity)
                    .animation(.easeInOut(duration: 0.35), value: momentKey)
                    .accessibilityLabel("Creating your song for \(setup.recipientName). Please wait.")
            }
            if moment == .reveal {
                revealPhase()
                    .transition(.opacity)
                    .animation(.easeInOut(duration: 0.35), value: momentKey)
                    .accessibilityLabel("Your song for \(setup.recipientName) is ready")
            }
            if moment == .share {
                sharePhase()
                    .transition(.opacity)
                    .animation(.easeInOut(duration: 0.35), value: momentKey)
                    .accessibilityLabel("Share your song for \(setup.recipientName)")
            }

            // Layer 2: Error overlays — partial overlay so conversation context stays visible
            if let error = activeError {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .onTapGesture { } // absorb taps on backdrop
                    .zIndex(99)

                VStack {
                    Spacer()
                    errorOverlay(for: error)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .zIndex(100)
            }
        }
        .onDisappear {
            creationTask?.cancel()
            styleSyncTask?.cancel()
            renderTimeoutTask?.cancel()
            flowTask?.cancel()
            playbackController.cleanup()
            // Release callback closures to break retain cycles with @Observable controllers
            renderController.onPreviewComplete = nil
            renderController.onFullRenderComplete = nil
            renderController.onFullRenderFailed = nil
            trackCreationController.onLyricsGenerated = nil
        }
        // Sheet router
        .sheet(item: $activeSheet) { sheet in
            sheetContent(for: sheet)
        }
        // Alert router
        .alert(
            alertTitle,
            isPresented: isAlertPresented
        ) {
            alertActions
        } message: {
            alertMessage
        }
        // Lifecycle
        .task {
            guard !didInitializeFlow else { return }
            didInitializeFlow = true
            initializeFlow()
            await loadMyVoiceFlag()
        }
        .onChange(of: scenePhase) { oldPhase, newPhase in
            guard newPhase == .active, oldPhase == .background else { return }
            guard let trackId = songFlow.currentTrackId,
                  let versionNum = songFlow.currentVersionNum else { return }
            if moment == .wait {
                wireRenderCallbacks()
                let mode: RenderController.RecoveryMode = renderController.isFullRendering ? .fullRender : .preview
                renderController.recoverAfterForeground(trackId: trackId, versionNum: versionNum, mode: mode)
            }
        }
        .onChange(of: activeSheet?.id) { oldValue, _ in
            // Voice enrollment dismissal
            if oldValue == "voiceEnrollment" && activeSheet?.id != "voiceEnrollment" {
                handleVoiceEnrollmentDismissal()
            }
            // Upgrade sheet dismissed — re-check entitlements
            if oldValue == "upgrade" && activeSheet?.id != "upgrade" {
                let flowType = pendingEntitlementFlowType
                pendingEntitlementFlowType = nil
                guard flowType == .song else { return }
                Task { @MainActor in await checkEntitlementsForSong() }
            }
        }
        .onChange(of: setup.style) { _, newStyle in
            guard let newStyle, newStyle != storyEngine.style else { return }
            storyEngine.updateBasics(
                recipientName: storyEngine.recipientName,
                occasion: storyEngine.occasion,
                style: newStyle
            )
            guard storyEngine.storyId != nil,
                  case .tell(.conversing) = moment else { return }

            styleSyncTask?.cancel()
            styleSyncTask = Task { @MainActor in
                do {
                    let syncedStyle = try await storyEngine.syncStoryStyle(newStyle)
                    if setup.style != syncedStyle {
                        setup.style = syncedStyle
                    }
                } catch {
                    guard !Task.isCancelled else { return }
                    ToastService.shared.show("Couldn't sync that genre yet.", type: .warning)
                }
            }
        }
        .onChange(of: momentKey) { _, newKey in
            guard songFlow.currentTrackId != nil else { return }
            let flowState: CreateFlowState?
            if newKey.hasPrefix("tell-trackCreated") {
                flowState = .lyricsReview
            } else if newKey == "wait" {
                flowState = .waitPulse
            } else if newKey == "reveal" {
                flowState = .revealBloom
            } else if newKey == "share" {
                flowState = .sharePostcard
            } else {
                flowState = nil
            }
            if let flowState {
                resumeCoordinator.persistResumeState(
                    flowState: flowState,
                    selectedType: .song,
                    songFlow: songFlow,
                    poemFlow: PoemFlowCoordinator(),
                    storyId: storyEngine.storyId
                )
            }
        }
    }

    /// Stable string key for animation and persistence (WarmCanvasMoment has associated values).
    private var momentKey: String {
        switch moment {
        case .tell(let sub): "tell-\(sub)"
        case .wait: "wait"
        case .reveal: "reveal"
        case .share: "share"
        }
    }

    /// Extracted binding for the alert presentation state.
    private var isAlertPresented: Binding<Bool> {
        Binding(
            get: { activeAlert != nil },
            set: { if !$0 { activeAlert = nil } }
        )
    }

    // MARK: - Tell Phase

    @ViewBuilder
    private func tellPhase() -> some View {
        VStack(spacing: 0) {
            if !didStartConversation {
                InlineNamePromptView(
                    selectedType: .song,
                    preselectedOccasion: preselectedOccasion?.displayName,
                    hasOwnLyrics: .constant(false),
                    isInstrumental: .constant(false),
                    onStart: { name, occasion in
                        if let occasion { setup.occasion = occasion }
                        startChatWithName(name)
                    },
                    onCancel: onCancel
                )
            } else {
                ChatHeaderView(
                    recipientName: setup.recipientName,
                    selectedType: .song,
                    storyId: storyEngine.storyId,
                    completionScore: storyEngine.completionScore,
                    occasion: setup.occasion,
                    isComplete: storyEngine.isComplete,
                    styleName: setup.style.map(styleStore.displayName(for:)),
                    onCancel: onCancel
                )

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            // Occasion picker (shown when needed)
                            if showOccasionPicker {
                                OccasionPickerCard(onSelect: { occasion in
                                    setup.occasion = occasion
                                    showOccasionPicker = false
                                    continueAfterOccasionSelection()
                                })
                                .id("occasion-picker")
                            }

                            // Pre-session prompt (before storyId exists)
                            if let prompt = preSessionPrompt, storyEngine.storyId == nil {
                                ChatMessageBubble(message: V2Message(role: .ai, content: prompt))
                                    .id("pre-session-prompt")
                            }

                            // Chat messages
                            ForEach(storyEngine.messages) { msg in
                                ChatMessageBubble(message: msg)
                                    .id(msg.id)
                            }

                            // Sub-phase inline cards
                            tellInlineCards
                                .id("inline-cards")

                            // Bottom padding so content isn't obscured by
                            // the Style picker + InputBar pinned below the scroll area.
                            Spacer().frame(height: 140)
                        }
                    }
                    .scrollIndicators(.hidden)
                    .onChange(of: momentKey) { _, _ in
                        // Auto-scroll to inline cards when moment changes (voice selection, lyrics, etc.)
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(100))
                            withAnimation(.easeInOut(duration: 0.3)) {
                                proxy.scrollTo("inline-cards", anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: storyEngine.messages.count) { _, _ in
                        // Auto-scroll to latest message after layout settles
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(100))
                            if let lastId = storyEngine.messages.last?.id {
                                withAnimation(.easeInOut(duration: 0.3)) {
                                    proxy.scrollTo(lastId, anchor: .bottom)
                                }
                            }
                        }
                    }
                }

                // Genre picker (during active conversation)
                if case .tell(.conversing) = moment, storyEngine.storyId != nil {
                    CollapsibleStylePicker(
                        selectedStyle: $setup.style,
                        styleStore: styleStore,
                        onCreate: storyEngine.isComplete ? {
                            guard setup.occasion != nil else {
                                showOccasionPicker = true
                                return
                            }
                            guard setup.style != nil else {
                                activeAlert = .genreRequired
                                return
                            }
                            finishConversation()
                        } : nil,
                        createEnabled: storyEngine.isComplete && !storyEngine.isLoading
                            && storyEngine.draft.pendingRevision == nil,
                        autoExpand: storyEngine.isComplete && setup.style == nil
                    )
                }

                // Input bar
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

    @ViewBuilder
    private var tellInlineCards: some View {
        switch moment {
        case .tell(.confirmed):
            VoiceSelectionChips(
                onSelect: { mode, gender in
                    songFlow.voiceMode = mode
                    songFlow.voiceGender = gender
                    withAnimation { moment = .tell(.voiceSelected) }
                    Task { @MainActor in await applyVoiceAndCreateTrack() }
                },
                onMyVoice: { handleMyVoiceRequested() },
                showMyVoice: myVoiceEnabled
            )

        case .tell(.voiceSelected):
            InlineCreatingCard(
                progress: trackCreationController.progress,
                statusMessage: trackCreationController.statusMessage
            )

        case .tell(.trackCreated):
            if let lyrics = createdLyrics {
                InlineLyricsCard(
                    lyrics: lyrics,
                    controller: lyricsController,
                    isInteractive: true,
                    style: setup.style.map(styleStore.displayName(for:)) ?? "Custom",
                    highlightTerms: songFlow.renderPolicyTerms,
                    onApproved: { startFullRender() },
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
            }

        default:
            EmptyView()
        }
    }

    // MARK: - Reveal Phase

    @ViewBuilder
    private func revealPhase() -> some View {
        RevealBloomView(
            recipientName: setup.recipientName,
            occasion: setup.occasion?.rawValue,
            isPlaying: playbackController.isPlaying,
            onPlay: { playbackController.togglePlayPause() },
            onShare: { withAnimation { moment = .share } },
            onEditLyrics: {
                activeSheet = .lyricsReview
            },
            onSaveToLibrary: {
                guard let trackId = songFlow.currentTrackId,
                      let versionNum = songFlow.currentVersionNum else { return }
                onComplete(trackId, versionNum)
            },
            onListenFully: {
                // Save to library and transition to main tabs where NowPlayingView
                // is accessible via MiniPlayer tap
                guard let trackId = songFlow.currentTrackId,
                      let versionNum = songFlow.currentVersionNum else { return }
                onComplete(trackId, versionNum)
            }
        )
    }

    // MARK: - Share Phase

    @ViewBuilder
    private func sharePhase() -> some View {
        SharePostcardView(
            recipientName: setup.recipientName,
            occasion: setup.occasion?.rawValue,
            onSend: {
                guard let (trackId, versionNum) = ensureShareControllerAndTrackIds() else { return }
                shareController?.generateShareLink(trackId: trackId, versionNum: versionNum)
                // Wait for URL then present system share sheet
                flowTask?.cancel()
                flowTask = Task { @MainActor in
                    // Poll for the share URL (generated async)
                    var shareURL: String?
                    for _ in 0..<40 {
                        try? await Task.sleep(for: .milliseconds(250))
                        if Task.isCancelled { return }
                        if let url = shareController?.shareURLString {
                            shareURL = url
                            break
                        }
                    }
                    guard let urlString = shareURL, let url = URL(string: urlString) else {
                        ToastService.shared.show("Could not generate share link", type: .error)
                        return
                    }
                    // Present native share sheet
                    let message = "I made a song for \(setup.recipientName) — listen here!"
                    let activityVC = UIActivityViewController(activityItems: [message, url], applicationActivities: nil)
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let root = windowScene.windows.first?.rootViewController {
                        // Find topmost presented VC
                        var topVC = root
                        while let presented = topVC.presentedViewController { topVC = presented }
                        activityVC.popoverPresentationController?.sourceView = topVC.view
                        topVC.present(activityVC, animated: true)
                    }
                }
            },
            onSaveToPhotos: {
                ToastService.shared.show("Save to Photos coming soon", type: .info)
            },
            onCopyLink: {
                guard let (trackId, versionNum) = ensureShareControllerAndTrackIds() else { return }
                // Check if URL already exists from a previous generation
                if let url = shareController?.shareURLString {
                    UIPasteboard.general.string = url
                    ToastService.shared.success("Link copied!")
                } else {
                    // Generate then copy once ready
                    ToastService.shared.show("Generating link...", type: .info)
                    shareController?.generateShareLink(trackId: trackId, versionNum: versionNum)
                    // Poll briefly for the async result (tracked for cancellation on dismiss)
                    flowTask?.cancel()
                    flowTask = Task { @MainActor in
                        for _ in 0..<20 {
                            try? await Task.sleep(for: .milliseconds(250))
                            if Task.isCancelled { return }
                            if let url = shareController?.shareURLString {
                                UIPasteboard.general.string = url
                                ToastService.shared.success("Link copied!")
                                return
                            }
                        }
                        ToastService.shared.show("Couldn't generate link. Try again.", type: .warning)
                    }
                }
            },
            onSkip: {
                if let trackId = songFlow.currentTrackId,
                   let versionNum = songFlow.currentVersionNum {
                    onComplete(trackId, versionNum)
                } else {
                    withAnimation { moment = .reveal }
                }
            }
        )
    }

    /// Lazily create the share controller and return current track IDs, or nil if unavailable.
    private func ensureShareControllerAndTrackIds() -> (trackId: String, versionNum: Int)? {
        if shareController == nil { shareController = ShareController(apiClient: apiClient) }
        guard let trackId = songFlow.currentTrackId,
              let versionNum = songFlow.currentVersionNum else { return nil }
        return (trackId, versionNum)
    }

    // MARK: - Error Overlays

    @ViewBuilder
    private func errorOverlay(for error: WarmCanvasError) -> some View {
        switch error {
        case .connectionError:
            TellConnectionErrorView(
                onPrimaryAction: { activeError = nil },
                onSecondaryAction: { onCancel() }
            )
        case .moderationError:
            TellModerationErrorView(
                onPrimaryAction: { activeError = nil },
                onSecondaryAction: { resetToFreshFlow() }
            )
        case .waitTimeout:
            WaitTimeoutErrorView(
                title: isGiftContext
                    ? "Your gift is taking longer than usual"
                    : "This is taking longer than usual",
                bodyLine: isGiftContext
                    ? "We'll notify you when your gift song is ready."
                    : "We'll notify you when it's ready.",
                onPrimaryAction: {
                    // Notify me → exit to home
                    activeError = nil
                    onCancel()
                },
                onSecondaryAction: {
                    activeError = nil
                    // Restart timeout so user isn't stuck forever if render also fails
                    startRenderTimeoutWatch()
                }
            )
        case .waitFailure(let name):
            WaitFailureErrorView(
                recipientName: name,
                onPrimaryAction: {
                    activeError = nil
                    startFullRender()
                },
                onSecondaryAction: {
                    activeError = nil
                    withAnimation { moment = .tell(.trackCreated) }
                }
            )
        case .revealPartial:
            RevealPartialErrorView(
                onListenToPreview: {
                    playbackController.play()
                    activeError = nil
                },
                onTryFullSong: {
                    activeError = nil
                    startFullRender()
                },
                onContactSupport: {
                    if let url = URL(string: "mailto:support@porizo.com") {
                        UIApplication.shared.open(url)
                    }
                }
            )
        case .shareFailure:
            ShareFailureView(
                onTryAgain: { activeError = nil },
                onCopyLink: {
                    if let url = shareController?.shareURLString {
                        UIPasteboard.general.string = url
                        ToastService.shared.success("Link copied!")
                    }
                    activeError = nil
                }
            )
        case .noCredits:
            NoCreditsView(
                onUpgrade: {
                    activeError = nil
                    pendingEntitlementFlowType = .song
                    activeSheet = .upgrade
                },
                onRestore: {
                    Task { @MainActor in
                        await storeKit.restore()
                        activeError = nil
                    }
                },
                onDismiss: { activeError = nil }
            )
        }
    }

    // MARK: - Alert Router

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

    // MARK: - Sheet Router

    @ViewBuilder
    private func sheetContent(for sheet: ActiveSheet) -> some View {
        switch sheet {
        case .upgrade:
            SubscriptionView(apiClient: apiClient, storeKit: storeKit)

        case .voiceEnrollment:
            VoiceEnrollmentView(completedProfile: $enrollmentCompletedProfile)
                .environment(apiWrapper)

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
                onCancel: { activeSheet = nil }
            )
            .environment(sttRouter)

        case .lyricsReview:
            if let lyrics = createdLyrics {
                NavigationStack {
                    ScrollView {
                        InlineLyricsCard(
                            lyrics: lyrics,
                            controller: lyricsController,
                            isInteractive: true,
                            style: setup.style.map(styleStore.displayName(for:)) ?? "Custom",
                            highlightTerms: songFlow.renderPolicyTerms,
                            onApproved: {
                                activeSheet = nil
                                startFullRender()
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
                        .padding(.horizontal, 16)
                        .padding(.vertical, 20)
                    }
                    .background(DesignTokens.background)
                    .navigationTitle("Edit Lyrics")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { activeSheet = nil }
                        }
                    }
                }
            }

        case .customLyrics, .share:
            EmptyView()
        }
    }

    // MARK: - Controller Wiring

    private func wireRenderCallbacks() {
        playbackController.onPlaybackFinished = {
            ReviewManager.shared.recordSuccessfulPlay()
        }

        renderController.onPreviewComplete = { [self] result in
            renderTimeoutTask?.cancel()
            guard moment == .wait else { return }
            applyRenderResult(result)
            transitionToReveal(audioURL: result.audioURL)
        }

        renderController.onFullRenderComplete = { [self] result in
            renderTimeoutTask?.cancel()
            activeError = nil  // Clear any timeout overlay that raced with completion

            switch moment {
            case .wait:
                // Warm Canvas goes straight to full render (no preview).
                applyRenderResult(result)
                transitionToReveal(audioURL: result.audioURL)
            case .reveal, .share:
                // Already on reveal/share — just swap to the higher-quality audio.
                applyRenderResult(result)
                playbackController.switchAudio(url: result.audioURL)
            case .tell:
                // View reset or user left — ignore late callback
                break
            }
        }

        renderController.onFullRenderFailed = { [self] _ in
            renderTimeoutTask?.cancel()
            guard moment == .wait else { return }
            activeError = .waitFailure(recipientName: setup.recipientName)
        }
    }

    /// Apply track metadata and playback info from a render result.
    private func applyRenderResult(_ result: RenderResult) {
        applyTrackMetadata(title: result.trackTitle, coverUrl: result.coverImageUrl)
        if !result.recipientName.isEmpty { setup.recipientName = result.recipientName }
        playbackController.trackTitle = result.trackTitle
        playbackController.artistName = setup.recipientName
    }

    /// Set up the player with the given audio and transition to the reveal moment.
    private func transitionToReveal(audioURL: String) {
        playbackController.setupPlayer(url: audioURL)
        playbackController.play()
        if shareController == nil {
            shareController = ShareController(apiClient: apiClient)
        }
        // Pre-generate share link so it's ready before the user taps Send (P0-3)
        if let trackId = songFlow.currentTrackId,
           let versionNum = songFlow.currentVersionNum {
            shareController?.generateShareLink(trackId: trackId, versionNum: versionNum)
        }
        if !hasCompletedFirstSong { hasCompletedFirstSong = true }
        withAnimation { moment = .reveal }
    }

    // Note: InlineLyricsCard.onApproved calls startFullRender() directly.
    // Do NOT wire lyricsController.onApproved — that would double-call and 409.

    // MARK: - Render

    private func startFullRender() {
        guard !isStartingFullRender else { return }
        isStartingFullRender = true
        flowTask?.cancel()
        flowTask = Task { @MainActor in
            defer { isStartingFullRender = false }
            do {
                let entitlements = try await apiClient.getBillingEntitlements()
                guard entitlements.songsRemaining > 0 else {
                    activeError = .noCredits
                    return
                }

                guard let trackId = songFlow.currentTrackId,
                      let versionNum = songFlow.currentVersionNum else {
                    presentFlowMessage("Track data not available. Please try again.")
                    return
                }

                // Approve lyrics on the server before rendering.
                // The backend requires lyrics_status = 'approved' for both
                // render_preview and render_full endpoints (409 otherwise).
                _ = try await apiClient.approveLyrics(trackId: trackId, versionNum: versionNum)

                wireRenderCallbacks()
                withAnimation { moment = .wait }
                startRenderTimeoutWatch()
                renderController.startFullRender(trackId: trackId, versionNum: versionNum)
            } catch {
                // Route moderation blocks to the dedicated error overlay
                if isModerationError(error) {
                    activeError = .moderationError
                } else {
                    presentFlowError(error, context: "Starting render")
                }
            }
        }
    }

    /// Check if an API error is a moderation block (403 MODERATION_BLOCKED).
    private func isModerationError(_ error: Error) -> Bool {
        if case APIClientError.httpError(statusCode: 403, let body) = error,
           body.contains("MODERATION_BLOCKED") {
            return true
        }
        if case APIClientError.serverError(_, let code, _) = error,
           code == "MODERATION_BLOCKED" {
            return true
        }
        return false
    }

    private func startRenderTimeoutWatch() {
        renderTimeoutTask?.cancel()
        renderTimeoutTask = Task {
            try? await Task.sleep(for: .seconds(240))
            guard !Task.isCancelled, moment == .wait else { return }
            activeError = .waitTimeout
        }
    }

    // MARK: - Track Creation

    private func startTrackCreation() {
        guard let styleKey = setup.style else {
            activeAlert = .genreRequired
            return
        }

        // BUG-1 fix: Ensure storyId exists before attempting track creation
        guard storyEngine.storyId != nil else {
            presentFlowMessage("Your story session isn't ready yet. Please try again.")
            withAnimation { moment = .tell(.conversing) }
            return
        }

        guard let context = storyEngine.buildStoryContext(styleKey: styleKey) else {
            presentFlowMessage("Could not build story context. Please add a bit more to your story.")
            withAnimation { moment = .tell(.conversing) }
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
                case .created(let result):
                    guard case .tell = moment else { return }
                    createdLyrics = result.lyrics
                    songFlow.currentTrackId = result.trackId
                    songFlow.currentVersionNum = result.versionNum

                    makeLyricsController(trackId: result.trackId, versionNum: result.versionNum)
                    lyricsController?.onAppear(
                        initialLyrics: result.lyrics,
                        highlightTerms: songFlow.renderPolicyTerms
                    )

                    resumeCoordinator.persistResumeState(
                        flowState: .lyricsReview,
                        selectedType: .song,
                        songFlow: songFlow,
                        poemFlow: PoemFlowCoordinator(),
                        storyId: storyEngine.storyId
                    )

                    // Set early so future flows skip voice selection (P1-6)
                    if !hasCompletedFirstSong { hasCompletedFirstSong = true }

                    withAnimation { moment = .tell(.trackCreated) }
                }
            } catch is CancellationError {
                // User cancelled
            } catch {
                guard !Task.isCancelled else { return }
                presentFlowError(error, context: "Starting track creation")
                withAnimation { moment = .tell(.confirmed) }
            }
        }
    }

    private func applyStoryGuidanceAndReturnToConversation(_ guidance: StoryGuidanceResponse) {
        storyEngine.applyConfirmGuidance(guidance)
        createdLyrics = nil
        creationTask = nil
        withAnimation { moment = .tell(.conversing) }
    }

    private func cancelCreation() {
        creationTask?.cancel()
        creationTask = nil
        withAnimation { moment = .tell(.confirmed) }
    }

    // MARK: - Conversation Actions

    private func startChatWithName(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        setup.recipientName = trimmed
        // Only apply preselected occasion if user didn't pick one from the chips
        if setup.occasion == nil {
            setup.applyPreselectedOccasion(preselectedOccasion)
        }
        didStartConversation = true
        handleTypeSelected()
    }

    private func handleTypeSelected() {
        selectedType = .song
        preSessionPrompt = nil

        // Occasion is required — it drives beats, questions, and song structure.
        // If user skipped the chips in InlineNamePromptView, show the picker.
        if setup.occasion == nil {
            showOccasionPicker = true
        } else {
            continueAfterOccasionSelection()
        }
    }

    private func continueAfterOccasionSelection() {
        showOccasionPicker = false
        moment = .tell(.conversing)
        showPreSessionQuestion()
    }

    private func showPreSessionQuestion() {
        preSessionPrompt = "Tell me about the story with \(setup.recipientName) that you want to turn into a song. What's a moment or memory that stands out?"
    }

    private func beginConversation(initialPromptOverride: String? = nil) async {
        let result = await storyFlowCoordinator.startConversation(
            setup: setup,
            songFlow: songFlow,
            engine: storyEngine,
            asyncService: asyncService,
            initialPromptOverride: initialPromptOverride
        )

        if let message = result.errorMessage {
            presentFlowMessage(message)
            if storyEngine.storyId == nil {
                showPreSessionQuestion()
                storyEngine.removeLastLocalUserMessage()
            }
        }

        resumeCoordinator.persistResumeState(
            flowState: .storyConversation,
            selectedType: .song,
            songFlow: songFlow,
            poemFlow: PoemFlowCoordinator(),
            storyId: storyEngine.storyId
        )
    }

    private func finishConversation() {
        guard creationTask == nil else { return }
        guard !storyEngine.isLoading else {
            ToastService.shared.show("Still processing — please wait a moment", type: .info)
            return
        }

        if setup.occasion == nil {
            showOccasionPicker = true
            return
        }

        if setup.style == nil {
            activeAlert = .genreRequired
            return
        }

        let result = storyFlowCoordinator.completeFlow(
            selectedType: .song,
            setup: setup,
            songFlow: songFlow,
            poemFlow: poemFlow,
            engine: storyEngine
        )
        songFlow = result.songFlow

        if let message = result.errorMessage {
            activeAlert = .error(message)
            return
        }

        flowTask?.cancel()
        flowTask = Task { @MainActor in await checkEntitlementsForSong() }
    }

    private func submitPreSessionAnswer(_ answer: String) {
        let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        preSessionPrompt = nil
        storyEngine.addLocalUserMessage(trimmed)
        flowTask?.cancel()
        flowTask = Task { @MainActor in await beginConversation(initialPromptOverride: trimmed) }
    }

    private func submitAndScroll(_ answer: String) {
        flowTask?.cancel()
        flowTask = Task { @MainActor in
            do {
                try await storyEngine.submitAnswer(answer)
            } catch {
                presentFlowError(error, context: "Submitting story answer")
            }
        }
    }

    private var currentInputCallbacks: InputBarCallbacks? {
        // Only show input bar during name entry and active conversation — NOT during
        // voice selection (.confirmed), track creation (.voiceSelected), or lyrics review (.trackCreated)
        switch moment {
        case .tell(.nameEntry), .tell(.conversing): break
        default: return nil
        }

        // Pre-session (before storyId exists)
        if storyEngine.storyId == nil {
            return InputBarCallbacks(
                onSubmit: { submitPreSessionAnswer($0) },
                onSpeechInput: { activeSheet = .speechInput(SpeechInputContext(storyId: nil)) },
                onFinishEarly: { },
                onExitReviewEdit: { }
            )
        }

        // Active session (always show input bar — including when story is complete)
        return InputBarCallbacks(
            onSubmit: { submitAndScroll($0) },
            onSpeechInput: {
                guard let sid = storyEngine.storyId else { return }
                activeSheet = .speechInput(SpeechInputContext(storyId: sid))
            },
            onFinishEarly: { finishConversation() },
            onExitReviewEdit: {
                storyEngine.exitReviewEditMode()
                moment = .tell(.conversing)
            }
        )
    }

    // MARK: - Entitlements

    private func checkEntitlementsForSong() async {
        do {
            let entitlements = try await apiClient.getBillingEntitlements()
            if entitlements.songsRemaining > 0 {
                advanceAfterEntitlementCheck()
            } else {
                activeError = .noCredits
            }
        } catch {
            presentFlowMessage("Unable to verify your account. Please check your connection and try again.")
        }
    }

    private func advanceAfterEntitlementCheck() {
        if !hasCompletedFirstSong && !alwaysShowVoiceSelection {
            songFlow.voiceMode = .aiVoice
            songFlow.voiceGender = .female
            withAnimation { moment = .tell(.voiceSelected) }
            Task { @MainActor in await applyVoiceAndCreateTrack() }
        } else {
            withAnimation { moment = .tell(.confirmed) }
        }
    }

    // MARK: - Voice

    private func applyVoiceAndCreateTrack() async {
        trackCreationController.onLyricsGenerated = { [self] lyrics in
            createdLyrics = lyrics
        }

        startTrackCreation()
    }

    private func handleMyVoiceRequested() {
        flowTask?.cancel()
        flowTask = Task { @MainActor in
            let profile = try? await apiClient.getVoiceProfile()
            if profile?.hasProfile == true {
                songFlow.voiceMode = .myVoice
                withAnimation { moment = .tell(.voiceSelected) }
                await applyVoiceAndCreateTrack()
            } else {
                activeSheet = .voiceEnrollment
            }
        }
    }

    private func handleVoiceEnrollmentDismissal() {
        guard enrollmentCompletedProfile != nil else { return }
        enrollmentCompletedProfile = nil

        flowTask?.cancel()
        flowTask = Task { @MainActor in
            do {
                let profile = try await apiClient.getVoiceProfile()
                guard profile.hasProfile else {
                    activeAlert = .error("Voice setup finished, but your voice profile is not ready yet. Try My Voice again in a moment.")
                    return
                }
                songFlow.voiceMode = .myVoice
                withAnimation { moment = .tell(.voiceSelected) }
                await applyVoiceAndCreateTrack()
            } catch {
                activeAlert = .error("Voice setup finished, but we couldn't verify your profile. Try My Voice again.")
            }
        }
    }

    // MARK: - Helpers

    private func makeLyricsController(trackId: String, versionNum: Int, storyId: String? = nil) {
        lyricsController = LyricsReviewController(
            apiClient: apiClient,
            trackId: trackId,
            versionNum: versionNum,
            storyId: storyId ?? storyEngine.storyId
        )
        // Note: InlineLyricsCard.onApproved calls startFullRender() directly — no callback wiring needed.
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

    private func resetToFreshFlow() {
        // Cancel ALL running tasks
        creationTask?.cancel()
        creationTask = nil
        styleSyncTask?.cancel()
        styleSyncTask = nil
        renderTimeoutTask?.cancel()
        renderTimeoutTask = nil
        flowTask?.cancel()
        flowTask = nil

        // Clear persisted state
        CreateFlowStore.shared.clear()

        // Reset all coordinators and controllers
        songFlow = SongFlowCoordinator()
        lyricsController = nil
        createdLyrics = nil
        shareController = nil
        trackCreationController = TrackCreationController(apiClient: apiClient)
        renderController.cancelAll()
        renderController = RenderController(apiClient: apiClient)
        playbackController.cleanup()
        storyEngine.reset()

        // Reset UI state
        setup = StorySetup()
        didStartConversation = false
        showOccasionPicker = false
        preSessionPrompt = nil
        activeError = nil
        activeSheet = nil
        activeAlert = nil
        isStartingFullRender = false

        withAnimation { moment = .tell(.nameEntry) }
    }

    private func loadMyVoiceFlag() async {
        do {
            let appConfig = try await apiClient.getAppConfig()
            myVoiceEnabled = appConfig.flags?.myVoiceEnabled ?? true
        } catch {
            myVoiceEnabled = true
        }
    }

    // MARK: - Resume / Bootstrap

    private func initializeFlow() {
        let persisted = CreateFlowStore.shared.load()
        let persistedSession = storyEngine.loadPersistedSession()
        let bootstrap = CreateFlowBootstrapAction.resolve(
            preselectedOccasion: preselectedOccasion,
            preselectedType: .song,
            resumeTrackId: resumeTrackId,
            resumeVersionNum: resumeVersionNum,
            resumeTarget: resumeTarget,
            variationSourcePoem: nil,
            persisted: persisted,
            persistedSession: persistedSession
        )

        switch bootstrap {
        case let .resumeTrack(trackId, versionNum, storyId, target):
            _ = songFlow.resume(trackId: trackId, versionNum: versionNum, storyId: storyId, target: target)
            selectedType = .song

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

            rebuildWarmCanvasState(trackId: trackId, versionNum: versionNum, storyId: storyId, target: target)

        case let .restoredStory(kind, session):
            let restored = resumeCoordinator.restoreStorySession(kind: kind, session: session, engine: storyEngine)
            selectedType = .song
            setup = restored.setup
            songFlow = restored.songFlow
            didStartConversation = true
            moment = .tell(.conversing)
            Task { @MainActor in await refreshRestoredStorySession() }

        case let .freshStart(initialSetup, _):
            setup = initialSetup
            moment = .tell(.nameEntry)

        default:
            moment = .tell(.nameEntry)
        }
    }

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

    private func rebuildWarmCanvasState(trackId: String, versionNum: Int, storyId: String?, target: CreateFlowResumeTarget?) {
        didStartConversation = true
        songFlow.currentTrackId = trackId
        songFlow.currentVersionNum = versionNum
        songFlow.currentStoryId = storyId
        makeLyricsController(trackId: trackId, versionNum: versionNum, storyId: storyId)

        switch target {
        case .trackPlayer:
            moment = .wait
            Task { @MainActor in await resumePlayerStateFromServer(trackId: trackId, versionNum: versionNum) }
        default:
            moment = .tell(.trackCreated)
            Task { @MainActor in await resumeLyricsState() }
        }
    }

    private func resumePlayerStateFromServer(trackId: String, versionNum: Int) async {
        wireRenderCallbacks()

        do {
            let response = try await apiClient.getTrack(trackId: trackId)
            let track = response.track

            applyTrackMetadata(title: track.title, coverUrl: track.coverImageUrl)
            if let name = track.recipientName, !name.isEmpty {
                setup.recipientName = name
            }

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                if let url = version.fullUrl {
                    let resolved = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    playbackController.setupPlayer(url: resolved)
                    if shareController == nil { shareController = ShareController(apiClient: apiClient) }
                    moment = .reveal
                } else if version.fullJobId != nil, version.status != "failed" {
                    moment = .wait
                    startRenderTimeoutWatch()
                    renderController.startFullRender(trackId: trackId, versionNum: versionNum)
                } else if let url = version.previewUrl {
                    let resolved = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    playbackController.setupPlayer(url: resolved)
                    if shareController == nil { shareController = ShareController(apiClient: apiClient) }
                    moment = .reveal
                } else if version.previewJobId != nil {
                    moment = .wait
                    startRenderTimeoutWatch()
                    renderController.startPreviewRender(trackId: trackId, versionNum: versionNum)
                } else if version.status == "failed" {
                    if version.fullJobId != nil {
                        moment = .wait
                        startRenderTimeoutWatch()
                        renderController.startFullRender(trackId: trackId, versionNum: versionNum)
                    } else {
                        moment = .tell(.trackCreated)
                        await resumeLyricsState()
                    }
                } else {
                    moment = .tell(.trackCreated)
                    await resumeLyricsState()
                }
            }
        } catch {
            if case APIClientError.httpError(statusCode: 404, _) = error {
                CreateFlowStore.shared.clear()
                activeAlert = .staleResume
            } else {
                presentFlowMessage(
                    "We couldn't reconnect to your song. Your previous render may still be processing. Please retry once you're back online."
                )
                moment = .tell(.trackCreated)
            }
        }
    }

    private func resumeLyricsState() async {
        guard let controller = lyricsController else { return }
        controller.loadExistingLyricsOrGenerate()
        // Poll for async lyrics load — 30s window (server may regenerate on resume)
        for _ in 0..<60 {
            if let lyrics = controller.lyrics {
                createdLyrics = lyrics
                return
            }
            do {
                try await Task.sleep(for: .milliseconds(250))
            } catch {
                return // Cancelled — don't touch state
            }
        }
        // Final check — if still nil, show error so user isn't stuck
        if let lyrics = controller.lyrics {
            createdLyrics = lyrics
        } else {
            presentFlowMessage("Couldn't load lyrics. Please try again.")
            withAnimation { moment = .tell(.conversing) }
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
}
