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
    enum UnifiedPhase {
        case typeSelection // Song vs Poem picker (when no type preselected)
        case setup         // Name, occasion, style selection
        case simpleCreate  // Freeform description before chat (non-own-lyrics path)
        case customLyrics  // User provides own lyrics (hasOwnLyrics path)
        case chat          // Conversation with AI
        case creating      // Track creation in progress
        case lyrics        // Lyrics review inline
        case voice         // Voice selection
        case rendering     // Render in progress
        case player        // Song ready
        // Poem phases
        case poemCreating  // Poem generation
        case poemGap       // Server needs more details
        case poemPreview   // Poem ready for review
    }

    @State private var phase: UnifiedPhase = .setup
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

    // Controllers
    @State private var trackCreationController: TrackCreationController
    @State private var createdTrackId: String?
    @State private var createdVersionNum: Int?
    @State private var createdLyrics: Lyrics?

    // Task handles
    @State private var creationTask: Task<Void, Never>?

    // Lifecycle
    @State private var didInitializeFlow = false
    @State private var didStartConversation = false

    // Error
    @State private var showError = false
    @State private var errorMessage = ""

    // Billing gate
    @State private var showUpgradePrompt = false

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
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            switch phase {
            case .typeSelection:
                typeSelectionPhase
            case .setup:
                setupPhase
            case .simpleCreate:
                simpleCreatePhase
            case .customLyrics:
                customLyricsPhase
            case .chat:
                chatPhase
            case .creating:
                creatingPhase
            case .lyrics:
                lyricsPlaceholder
            case .voice:
                voicePlaceholder
            case .rendering:
                renderingPlaceholder
            case .player:
                playerPlaceholder
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

    // MARK: - Simple Create Phase (freeform description before chat)

    private var simpleCreatePhase: some View {
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
                    styles: [setup.style],
                    title: nil,
                    tempo: nil,
                    mood: nil,
                    duration: nil
                )
                songFlow.customSongRequest = request
                Task { await beginConversation() }
            },
            onBack: {
                withAnimation { phase = .setup }
            },
            onCancel: {
                onCancel()
            },
            contentKind: selectedType == .poem ? .poem : .song
        )
        .environment(apiWrapper)
    }

    // MARK: - Custom Lyrics Phase (hasOwnLyrics path)

    private var customLyricsPhase: some View {
        CustomCreateView(
            apiClient: apiClient,
            onCreateSong: { request in
                songFlow.customSongRequest = request
                Task { await beginConversation() }
            },
            onCancel: {
                withAnimation { phase = .setup }
            },
            contentKind: selectedType == .poem ? .poem : .song,
            primaryCtaTitle: "Continue",
            primaryCtaIcon: "arrow.right"
        )
        .environment(apiWrapper)
    }

    /// Routes from setup to the correct next phase based on song-entry flags.
    /// Matches the old flow's branching: hasOwnLyrics → CustomCreateView,
    /// else → SimpleCreateView (freeform description step before chat).
    private func continueFromSetup() {
        if songFlow.hasOwnLyrics {
            withAnimation { phase = .customLyrics }
        } else {
            withAnimation { phase = .simpleCreate }
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
                // Active conversation
                chatHeader

                // Story Elements card (collapsible, tabbed)
                if !storyEngine.currentBeats.isEmpty {
                    storyElementsCard
                        .padding(.horizontal, 16)
                        .padding(.top, 4)
                        .padding(.bottom, 4)
                }

                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 4) {
                            ForEach(storyEngine.messages) { msg in
                                chatBubble(msg)
                                    .id(msg.id)
                            }

                            // Loading indicator
                            if storyEngine.isLoading {
                                loadingIndicator
                            }

                            // Confirmation (when story is complete)
                            if storyEngine.isComplete {
                                confirmationSection
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
                }

                // Input bar (reuses existing InputBarView)
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
                    },
                    pendingSpeechText: $pendingSpeechText,
                    isInputActive: $isInputActive
                )
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

    // MARK: - Creating Phase (Phase 3)

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

                // Persist resume state
                resumeCoordinator.persistResumeState(
                    flowState: .lyricsReview,
                    selectedType: selectedType,
                    songFlow: songFlow,
                    poemFlow: PoemFlowCoordinator(),
                    storyId: storyEngine.storyId
                )

                // Advance to lyrics
                withAnimation { phase = .lyrics }
            } catch is CancellationError {
                // User cancelled — already returned to chat
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = error.localizedDescription
                showError = true
                // Return to chat per plan (not dismiss)
                withAnimation { phase = .chat }
            }
        }
    }

    private func cancelCreation() {
        creationTask?.cancel()
        creationTask = nil
        // Return to chat, not dismiss (per plan Phase 5.4)
        withAnimation { phase = .chat }
    }

    // MARK: - Lyrics Phase (Phase 3 continued)

    @State private var lyricsController: LyricsReviewController?

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
                            withAnimation { phase = .voice }
                        } else {
                            // Instrumental: skip voice, go to player
                            withAnimation { phase = .player }
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
                    withAnimation { phase = .player }
                }
            },
            onBack: {
                withAnimation { phase = .lyrics }
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
                        withAnimation { phase = .lyrics }
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
                phase = .player
            case .lyricsReview:
                phase = .lyrics
            default:
                phase = .lyrics
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

        // Map CreateFlowState to unified phase
        let targetPhase: UnifiedPhase
        switch result.nextState {
        case .creatingTrack:
            targetPhase = .creating
        case .voice:
            targetPhase = .voice
        case .poemCreating:
            targetPhase = .poemCreating
        default:
            targetPhase = .creating
        }

        // Gate song/poem creation on billing entitlements
        if targetPhase == .creating || targetPhase == .poemCreating {
            Task { await checkEntitlementsThenAdvance(to: targetPhase) }
        } else {
            phase = targetPhase
        }
    }

    private func checkEntitlementsThenAdvance(to targetPhase: UnifiedPhase) async {
        do {
            let entitlements = try await apiClient.getBillingEntitlements()
            let isSong = (selectedType ?? .song) == .song
            let remaining = isSong ? entitlements.songsRemaining : entitlements.poemsRemaining
            if remaining > 0 {
                withAnimation { phase = targetPhase }
            } else {
                showUpgradePrompt = true
            }
        } catch {
            // If entitlement check fails (offline, etc.), proceed — don't block creation
            #if DEBUG
            print("[UnifiedCreateFlow] Entitlement check failed, proceeding: \(error.localizedDescription)")
            #endif
            withAnimation { phase = targetPhase }
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
