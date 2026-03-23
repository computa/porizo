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
        case lyricsApproved   // Lyrics approved, preview render active
        case previewReady     // Preview rendered, player showing
        case fullRenderActive // Full render in progress
        case fullRenderReady  // Full song rendered
    }

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
    @State private var speechInputContext: SpeechInputContext?

    // Story flow coordinators
    private let asyncService: CreateFlowAsyncService
    private let storyFlowCoordinator: StoryFlowCoordinator
    private let resumeCoordinator: CreateFlowResumeCoordinator

    // Controllers (owned by this view, shared with inline cards)
    @State private var trackCreationController: TrackCreationController
    @State private var playbackController = PlaybackController()
    @State private var renderController: RenderController
    @State private var lyricsController: LyricsReviewController?
    @State private var createdTrackId: String?
    @State private var createdVersionNum: Int?
    @State private var createdLyrics: Lyrics?

    // Track metadata (populated from render callbacks)
    @State private var trackTitle: String = "Your Song"
    @State private var coverImageUrl: String?
    @State private var previewUrl: String?
    @State private var fullUrl: String?

    // Task handles
    @State private var creationTask: Task<Void, Never>?

    // Lifecycle
    @State private var didInitializeFlow = false
    @State private var didStartConversation = false

    // Error
    @State private var showError = false
    @State private var errorMessage = ""

    // Sheets
    @State private var showUpgradePrompt = false
    @State private var showVoiceEnrollment = false
    @State private var showingShareSheet = false

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
        .alert("Error", isPresented: $showError) {
            Button("OK") {}
        } message: {
            Text(errorMessage)
        }
        .sheet(isPresented: $showUpgradePrompt) {
            SubscriptionView(apiClient: apiClient, storeKit: StoreKitManager(apiClient: apiClient))
        }
        .fullScreenCover(item: $speechInputContext) { context in
            SpeechInputView(
                storyId: context.storyId,
                onTranscription: { text in
                    speechInputContext = nil
                    pendingSpeechText = text
                },
                onCancel: {
                    speechInputContext = nil
                }
            )
        }
        .task {
            guard !didInitializeFlow else { return }
            didInitializeFlow = true
            initializeFlow()
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

                // Story Elements card (collapsible, tabbed)
                if !storyEngine.currentBeats.isEmpty {
                    storyElementsCard
                        .padding(.horizontal, 16)
                        .padding(.top, 4)
                        .padding(.bottom, 4)
                }

                // Scrollable content: messages + inline cards
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 4) {
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
                                        showVoiceEnrollment = true
                                    }
                                )
                                .id("voice-chips")
                            }

                            // 5. Track creation progress
                            if songProgress == .voiceSelected && trackCreationController.isCreating {
                                InlineCreatingCard(
                                    progress: trackCreationController.progress,
                                    statusMessage: trackCreationController.statusMessage
                                )
                                .id("creating")
                            }

                            // 6. Lyrics card (read-only until track exists, then interactive)
                            if let lyrics = createdLyrics {
                                InlineLyricsCard(
                                    lyrics: lyrics,
                                    controller: lyricsController,
                                    isInteractive: songProgress == .trackCreated,
                                    style: setup.style,
                                    highlightTerms: songFlow.renderPolicyTerms,
                                    onApproved: {
                                        songProgress = .lyricsApproved
                                        startPreviewRender()
                                    },
                                    onRegenerateLyrics: {
                                        regenerateLyrics()
                                    }
                                )
                                .id("lyrics")
                            }

                            // 7. Rendering progress (preview or full)
                            if renderController.isRendering {
                                InlineRenderingCard(
                                    renderController: renderController,
                                    isFullRender: songProgress == .fullRenderActive
                                )
                                .id("rendering")
                            }

                            // 8. Player card (preview or full)
                            if songProgress == .previewReady || songProgress == .fullRenderActive || songProgress == .fullRenderReady {
                                InlinePlayerCard(
                                    playbackController: playbackController,
                                    trackTitle: trackTitle,
                                    recipientName: setup.recipientName,
                                    isPreview: songProgress != .fullRenderReady,
                                    coverImageUrl: coverImageUrl,
                                    onGetFullSong: { startFullRender() },
                                    onShare: { showingShareSheet = true },
                                    onReroll: { handleReroll() },
                                    onDone: {
                                        if let trackId = songFlow.currentTrackId,
                                           let versionNum = songFlow.currentVersionNum {
                                            onComplete(trackId, versionNum)
                                        }
                                    }
                                )
                                .id("player")
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 16)
                    }
                    .onAppear { scrollProxy = proxy }
                    .onChange(of: storyEngine.messages.count) { _, _ in
                        if let lastMsg = storyEngine.messages.last {
                            withAnimation {
                                proxy.scrollTo(lastMsg.id, anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: songProgress) { _, newValue in
                        // Auto-scroll to new inline cards
                        let scrollTarget: String? = switch newValue {
                        case .confirmed: "voice-chips"
                        case .voiceSelected: "creating"
                        case .trackCreated: "lyrics"
                        case .lyricsApproved: "rendering"
                        case .previewReady, .fullRenderReady: "player"
                        default: nil
                        }
                        if let target = scrollTarget {
                            withAnimation {
                                proxy.scrollTo(target, anchor: .top)
                            }
                        }
                    }
                }

                // Input bar: only during conversation phase
                if songProgress == .conversing && !storyEngine.isComplete {
                    InputBarView(
                        engine: storyEngine,
                        onSubmit: { answer in
                            submitAndScroll(answer)
                        },
                        onSpeechInput: {
                            speechInputContext = SpeechInputContext(storyId: storyEngine.storyId)
                        },
                        onFinishEarly: {
                            finishConversation()
                        },
                        onExitReviewEdit: {
                            storyEngine.exitReviewEditMode()
                            songProgress = .conversing
                        },
                        pendingSpeechText: $pendingSpeechText,
                        isInputActive: $isInputActive
                    )
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

                Text("Who is this \(selectedType == .poem ? "poem" : "song") for?")
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
        Task { await beginConversation() }
    }

    // MARK: - Chat Header

    private var chatHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text("Song for \(setup.recipientName)")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("\(setup.occasion.displayName)  ·  \(storyEngine.isComplete ? "Ready" : "\(storyEngine.completionScore)%")")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.gold)
            }

            Spacer()

            // Completion badge
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
        VStack(spacing: 4) {
            ForEach(storyEngine.currentBeats) { beat in
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Circle()
                            .fill(!beat.isFilled ? DesignTokens.gold : DesignTokens.success)
                            .frame(width: 7, height: 7)
                        Text(beat.displayName)
                            .font(DesignTokens.bodyFont(size: 13, weight: !beat.isFilled ? .bold : .regular))
                            .foregroundStyle(!beat.isFilled ? DesignTokens.textPrimary : DesignTokens.textSecondary)
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
                .padding(.vertical, 6)
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
                    Text(msg.content)
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(.black)
                        .lineSpacing(2)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                } else {
                    HStack(alignment: .top, spacing: 10) {
                        Rectangle()
                            .fill(DesignTokens.gold.opacity(0.3))
                            .frame(width: 2)
                            .clipShape(Capsule())
                        Text(msg.content)
                            .font(DesignTokens.bodyFont(size: 15))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(3)
                    }
                }

                if msg.role == .ai { Spacer(minLength: 50) }
            }

            // Suggestion chips (if AI message has them)
            if msg.role == .ai, let suggestions = msg.suggestions, !suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(suggestions, id: \.self) { suggestion in
                            Button {
                                submitAndScroll(suggestion)
                            } label: {
                                Text(suggestion)
                                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(DesignTokens.surface)
                                    .foregroundStyle(DesignTokens.textSecondary)
                                    .clipShape(Capsule())
                                    .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                            }
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: msg.role == .user ? .trailing : .leading)
        .padding(.vertical, 4)
    }

    // MARK: - Loading Indicator

    private var loadingIndicator: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(DesignTokens.gold.opacity(0.3))
                .frame(width: 2, height: 20)
                .clipShape(Capsule())
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle()
                        .fill(DesignTokens.gold.opacity(0.5))
                        .frame(width: 6, height: 6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 8)
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

                // Continue to create
                Button {
                    finishConversation()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles")
                        Text("Continue to Create")
                    }
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .disabled(storyEngine.isLoading || storyEngine.draft.pendingRevision != nil)
                .opacity(storyEngine.isLoading || storyEngine.draft.pendingRevision != nil ? 0.6 : 1.0)
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

    // MARK: - Creating Phase (Phase 3) — legacy, kept for reference

    private var creatingPhase: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 32) {
                // Header
                HStack {
                    Button { cancelCreation() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .frame(width: 44, height: 44)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                    }
                    Spacer()
                    Text("Creating Song")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textTertiary)
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 20)

                Spacer()

                // Progress ring
                ZStack {
                    Circle()
                        .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 8)
                        .frame(width: 160, height: 160)
                    Circle()
                        .trim(from: 0, to: CGFloat(trackCreationController.progress) / 100)
                        .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 160, height: 160)
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.3), value: trackCreationController.progress)
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 50))
                        .foregroundStyle(DesignTokens.gold)
                }

                VStack(spacing: 12) {
                    Text(trackCreationController.statusMessage)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text("For \(setup.recipientName)")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer()
            }
        }
        .onAppear { startTrackCreation() }
    }

    private func startTrackCreation() {
        guard let context = storyEngine.buildStoryContext(styleKey: setup.style) else {
            errorMessage = "Could not build story context"
            showError = true
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

                createdTrackId = result.trackId
                createdVersionNum = result.versionNum
                createdLyrics = result.lyrics

                songFlow.currentTrackId = result.trackId
                songFlow.currentVersionNum = result.versionNum

                // Initialize lyrics controller now that trackId exists
                lyricsController = LyricsReviewController(
                    apiClient: apiClient,
                    trackId: result.trackId,
                    versionNum: result.versionNum,
                    storyId: storyEngine.storyId ?? ""
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
                errorMessage = error.localizedDescription
                showError = true
                songProgress = .voiceSelected // Stay at creating, show error
            }
        }
    }

    private func cancelCreation() {
        creationTask?.cancel()
        creationTask = nil
        // Return to voice selection (conversation still visible above)
        withAnimation { songProgress = .confirmed }
    }

    // MARK: - Lyrics Phase (Phase 3 continued) — legacy

    private var lyricsPlaceholder: some View {
        Group {
            if let trackId = createdTrackId, let versionNum = createdVersionNum {
                LyricsReviewView(
                    apiClient: apiClient,
                    trackId: trackId,
                    versionNum: versionNum,
                    storyId: storyEngine.storyId ?? "",
                    initialLyrics: createdLyrics,
                    highlightTerms: songFlow.renderPolicyTerms,
                    onApproved: {
                        // Voice selection is MANDATORY for songs (per plan)
                        if selectedType == .song && !songFlow.isInstrumental {
                            withAnimation { phase = .chat }
                        } else {
                            // Instrumental: skip voice, go to player
                            withAnimation { phase = .chat }
                        }
                    },
                    onBack: {
                        // Return to chat
                        withAnimation { phase = .chat }
                    }
                )
            } else {
                VStack {
                    Text("Error: No track created")
                        .foregroundStyle(DesignTokens.error)
                    Button("Back to Chat") { phase = .chat }
                }
            }
        }
    }

    // MARK: - Voice Phase (Phase 4)

    private var voicePlaceholder: some View {
        VoiceModeSelectionView(
            apiClient: apiClient,
            onSelect: { mode, gender in
                songFlow.voiceMode = mode
                songFlow.voiceGender = gender
                Task {
                    let result = await songFlow.applyVoiceSelection(using: asyncService)
                    if let error = result.error {
                        errorMessage = error
                        showError = true
                    }
                    // Persist and advance to player/render
                    resumeCoordinator.persistResumeState(
                        flowState: .trackPlayer,
                        selectedType: selectedType,
                        songFlow: songFlow,
                        poemFlow: PoemFlowCoordinator(),
                        storyId: storyEngine.storyId
                    )
                    withAnimation { phase = .chat }
                }
            },
            onBack: {
                withAnimation { phase = .chat }
            }
        )
    }

    // MARK: - Rendering Phase (Phase 4 continued)
    // Note: In the current app, rendering is triggered automatically by TrackPlayerFullView.
    // The unified flow reuses the same TrackPlayerFullView which handles render + play.

    private var renderingPlaceholder: some View {
        // Rendering is handled inside TrackPlayerFullView
        playerPlaceholder
    }

    // MARK: - Player Phase (Phase 5)

    @State private var songRerollsUsed: Int = 0

    private var playerPlaceholder: some View {
        Group {
            if let trackId = songFlow.currentTrackId, let versionNum = songFlow.currentVersionNum {
                TrackPlayerContentView(
                    apiClient: apiClient,
                    trackId: trackId,
                    versionNum: versionNum,
                    allowedRerollTypes: allowedRerollTypes,
                    rerollLimit: maxSongRerolls,
                    rerollsUsed: songRerollsUsed,
                    onDone: { doneTrackId, doneVersion in
                        onComplete(doneTrackId, doneVersion)
                    },
                    onNewSong: {
                        // Reset and start over
                        phase = .setup
                        setup = StorySetup()
                        songFlow = SongFlowCoordinator()
                    },
                    onRerollComplete: { newVersion in
                        songFlow.currentVersionNum = newVersion
                    },
                    onEditLyricsRequested: { terms in
                        songFlow.renderPolicyTerms = terms
                        createdLyrics = nil // Force reload
                        withAnimation { phase = .chat }
                    },
                    onRerollUsed: {
                        songRerollsUsed += 1
                        onSongRerollUsed?(songRerollsUsed)
                    }
                )
            } else {
                VStack {
                    Text("Error: No track available")
                        .foregroundStyle(DesignTokens.error)
                    Button("Back to Chat") { phase = .chat }
                }
            }
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
            let flowState = songFlow.resume(
                trackId: trackId,
                versionNum: versionNum,
                storyId: storyId,
                target: target
            )
            createdTrackId = trackId
            createdVersionNum = versionNum
            selectedType = .song
            // Map CreateFlowState to UnifiedPhase
            switch flowState {
            case .trackPlayer:
                phase = .chat
            case .lyricsReview:
                phase = .chat
            default:
                phase = .chat
            }

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
            let resolvedType = forcedType ?? preselectedType
            selectedType = resolvedType
            if resolvedType != nil {
                // Type known — go to chat (inline name prompt handles the rest)
                phase = .chat
            } else {
                phase = .typeSelection
            }
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

    private func beginConversation() async {
        withAnimation { phase = .chat }

        let result = await storyFlowCoordinator.startConversation(
            setup: setup,
            songFlow: songFlow,
            engine: storyEngine,
            asyncService: asyncService
        )

        if let message = result.errorMessage {
            errorMessage = message
            showError = true
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

    private func submitAndScroll(_ answer: String) {
        Task {
            do {
                try await storyEngine.submitAnswer(answer)
                // Auto-scroll handled by onChange
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
        }
    }

    private func finishConversation() {
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
            errorMessage = message
            showError = true
            return
        }

        // Route based on flow type
        switch result.nextState {
        case .poemCreating:
            // Poem flow stays full-screen
            withAnimation { phase = .poemCreating }
        case .creatingTrack, .voice:
            // Song flow: advance to inline voice selection
            Task { await checkEntitlementsForSong() }
        default:
            Task { await checkEntitlementsForSong() }
        }
    }

    private func checkEntitlementsForSong() async {
        do {
            let entitlements = try await apiClient.getBillingEntitlements()
            if entitlements.songsRemaining > 0 {
                withAnimation { songProgress = .confirmed }
            } else {
                showUpgradePrompt = true
            }
        } catch {
            #if DEBUG
            print("[UnifiedCreateFlow] Entitlement check failed, proceeding: \(error.localizedDescription)")
            #endif
            withAnimation { songProgress = .confirmed }
        }
    }

    // MARK: - Inline Song Actions

    /// After voice is selected, apply it and start track creation
    private func applyVoiceAndCreateTrack() async {
        // Apply voice mode to existing track if we have one
        if let trackId = songFlow.currentTrackId {
            let result = await songFlow.applyVoiceSelection(using: asyncService)
            if let error = result.error {
                errorMessage = error
                showError = true
            }
        }

        // Wire lyrics callback
        trackCreationController.onLyricsGenerated = { [self] lyrics in
            createdLyrics = lyrics
        }

        startTrackCreation()
    }

    /// Start preview render after lyrics approval
    private func startPreviewRender() {
        guard let trackId = songFlow.currentTrackId,
              let versionNum = songFlow.currentVersionNum else { return }

        renderController.onPreviewComplete = { result in
            self.previewUrl = result.audioURL
            self.trackTitle = result.trackTitle
            self.coverImageUrl = result.coverImageUrl
            self.playbackController.trackTitle = result.trackTitle
            self.playbackController.artistName = result.recipientName
            self.playbackController.setupPlayer(url: result.audioURL)
            self.playbackController.play()
            self.songProgress = .previewReady
        }

        renderController.startPreviewRender(trackId: trackId, versionNum: versionNum)
    }

    /// Start full render with billing hold
    private func startFullRender() {
        songProgress = .fullRenderActive
        Task {
            do {
                let entitlements = try await apiClient.getBillingEntitlements()
                guard entitlements.songsRemaining > 0 else {
                    showUpgradePrompt = true
                    songProgress = .previewReady
                    return
                }

                guard let trackId = songFlow.currentTrackId,
                      let versionNum = songFlow.currentVersionNum else { return }

                renderController.onFullRenderComplete = { result in
                    self.fullUrl = result.audioURL
                    self.playbackController.switchAudio(url: result.audioURL)
                    self.songProgress = .fullRenderReady
                }

                renderController.startFullRender(trackId: trackId, versionNum: versionNum)
            } catch {
                errorMessage = error.localizedDescription
                showError = true
                songProgress = .previewReady
            }
        }
    }

    /// Handle reroll from inline player
    private func handleReroll() {
        // TODO: Show reroll type picker, then call API
        // For now, regenerate lyrics as the default reroll
        playbackController.cleanup()
        regenerateLyrics()
    }

    /// Regenerate lyrics via controller
    private func regenerateLyrics() {
        guard let controller = lyricsController else { return }
        Task {
            do {
                try await controller.regenerateLyrics()
                createdLyrics = controller.lyrics
                songProgress = .trackCreated
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
        }
    }

    // MARK: - Helpers

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
                errorMessage = msg
                showError = true
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
                            errorMessage = message
                            showError = true
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
