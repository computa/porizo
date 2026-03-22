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
        case setup       // Name, occasion, style selection
        case chat        // Conversation with AI
        case creating    // Track creation in progress
        case lyrics      // Lyrics review inline
        case voice       // Voice selection
        case rendering   // Render in progress
        case player      // Song ready
    }

    @State private var phase: UnifiedPhase = .setup
    @State private var storyEngine: V2StoryEngine
    @State private var apiWrapper: APIClientWrapper
    @State private var setup = StorySetup()
    @State private var songFlow = SongFlowCoordinator()
    @State private var selectedType: CreateFlowKind?

    // Chat state
    @State private var pendingSpeechText: String?
    @State private var isInputActive: Bool = false
    @State private var speechInputContext: SpeechInputContext?

    // Story flow coordinators
    private let asyncService: CreateFlowAsyncService
    private let storyFlowCoordinator: StoryFlowCoordinator
    private let resumeCoordinator: CreateFlowResumeCoordinator

    // Error
    @State private var showError = false
    @State private var errorMessage = ""

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
        _selectedType = State(initialValue: preselectedType ?? .song)
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            switch phase {
            case .setup:
                setupPhase
            case .chat:
                chatPhase
            default:
                // Phases 3-7 will be wired in subsequent phases
                placeholderPhase
            }
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Setup Phase (reuses existing merged setup view)

    private var setupPhase: some View {
        CreateFlowMergedSetupView(
            selectedType: selectedType,
            setup: $setup,
            isInstrumental: $songFlow.isInstrumental,
            hasOwnLyrics: $songFlow.hasOwnLyrics,
            canContinue: !setup.recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            onBack: { onCancel() },
            onContinue: {
                setup.applyPreselectedOccasion(preselectedOccasion)
                Task { await beginConversation() }
            }
        )
    }

    // MARK: - Chat Phase

    private var chatPhase: some View {
        VStack(spacing: 0) {
            // Header
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
                Text("\(setup.recipientName)'s Story")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)

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

    // MARK: - Placeholder for future phases

    private var placeholderPhase: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.gold)
            Text("Phase: \(String(describing: phase))")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
            Text("This phase will be wired next.")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
            Spacer()
            Button { onCancel() } label: {
                Text("Close")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
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
            poemFlow: PoemFlowCoordinator(),
            engine: storyEngine
        )
        songFlow = result.songFlow

        // Map to unified phase based on what the coordinator returns
        switch result.nextState {
        case .creatingTrack:
            phase = .creating
        case .voice:
            phase = .voice
        case .poemCreating:
            phase = .creating
        default:
            phase = .creating
        }

        if let message = result.errorMessage {
            errorMessage = message
            showError = true
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
}
