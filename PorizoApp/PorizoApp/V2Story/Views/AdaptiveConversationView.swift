//
//  AdaptiveConversationView.swift
//  PorizoApp
//
//  Chat-style conversation UI matching v1.pen Velvet & Gold design.
//
//  Features:
//  - Chat/Story tab toggle to switch between conversation and story preview
//  - Scrollable chat with full conversation history
//  - AI messages (left) with surface backgrounds
//  - User messages (right) with gold filled background
//  - Story tab shows developing narrative and beat progress
//  - Input bar at bottom with "I'm done sharing" option
//

import SwiftUI

// MARK: - View Tab

enum ConversationViewTab: String, CaseIterable {
    case chat = "Chat"
    case story = "Story"
}

// MARK: - Adaptive Conversation View

struct AdaptiveConversationView: View {
    var engine: V2StoryEngine
    var onClose: (() -> Void)? = nil
    @State private var showFinishConfirmation: Bool = false
    @State private var expandedStoryCardId: UUID? = nil
    @State private var selectedTab: ConversationViewTab = .chat
    @State private var showSpeechInput: Bool = false
    @State private var pendingSpeechText: String?
    @State private var isInputActive: Bool = false
    @State private var storyCardIndices: Set<Int> = []

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with progress
                ConversationHeaderMinimal(
                    recipientName: engine.recipientName,
                    completionScore: engine.completionScore
                )

                // Tab picker
                tabPicker

                // Tab content
                if selectedTab == .chat {
                    chatScrollView
                } else {
                    storyTabContent
                }

                // Input bar (isolated — owns inputText so keystrokes don't re-render chat)
                InputBarView(
                    engine: engine,
                    onSubmit: { answer in
                        submitAndHandleError(answer)
                    },
                    onSpeechInput: { showSpeechInput = true },
                    onFinishEarly: { showFinishConfirmation = true },
                    onExitReviewEdit: { engine.exitReviewEditMode() },
                    pendingSpeechText: $pendingSpeechText,
                    isInputActive: $isInputActive
                )
            }
        }
        .overlay(alignment: .topTrailing) {
            if let onClose {
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .frame(width: 36, height: 36)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
                .padding(.top, 8)
                .padding(.trailing, 16)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: selectedTab)
        .alert("Finish Early?", isPresented: $showFinishConfirmation) {
            Button("Keep Going", role: .cancel) { }
            Button("I'm Done") {
                Task {
                    do {
                        try await engine.finishEarly()
                    } catch {
                        if let message = engine.error?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
                            ToastService.shared.error(message)
                        } else {
                            ToastService.shared.error(error.localizedDescription)
                        }
                    }
                }
            }
        } message: {
            Text("You can add more details to make your song more personal, or finish now with what you've shared.")
        }
        .fullScreenCover(isPresented: $showSpeechInput) {
            SpeechInputView(
                storyId: engine.storyId ?? "",
                onTranscription: { text in
                    showSpeechInput = false
                    pendingSpeechText = text
                },
                onCancel: {
                    showSpeechInput = false
                }
            )
        }
    }

    // MARK: - Tab Picker (v1.pen: gold accent)

    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(ConversationViewTab.allCases, id: \.self) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Text(tab.rawValue)
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(selectedTab == tab ? DesignTokens.textPrimary : DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            selectedTab == tab
                                ? DesignTokens.surface
                                : Color.clear
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .background(Color(hex: "#1A1A1A"))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(DesignTokens.borderSubtle, lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Chat Scroll View

    private var chatScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    // Initial prompt bubble (user's first message)
                    // This is shown separately since it's not in messages array
                    if engine.messages.isEmpty && !engine.isLoading {
                        emptyStateView
                    }

                    // Render messages with inline story cards
                    ForEach(Array(engine.messages.enumerated()), id: \.element.id) { index, message in
                        VStack(spacing: 12) {
                            // Check if we should show inline story card before this message
                            if storyCardIndices.contains(index) {
                                InlineStoryCard(
                                    narrative: engine.currentNarrative,
                                    completionScore: engine.completionScore,
                                    isExpanded: expandedStoryCardId == message.id,
                                    onToggle: {
                                        withAnimation(.spring(response: 0.3)) {
                                            if expandedStoryCardId == message.id {
                                                expandedStoryCardId = nil
                                            } else {
                                                expandedStoryCardId = message.id
                                            }
                                        }
                                    }
                                )
                            }

                            // Message bubble
                            ChatMessageBubble(
                                message: message,
                                isLatest: index == engine.messages.count - 1,
                                showTypewriterEffect: index == engine.messages.count - 1 && message.role == .ai
                            )
                            .id(message.id)

                            // Suggestion chips below the latest AI message
                            // Hidden during confirm and while user is actively typing
                            if message.role == .ai,
                               index == engine.messages.count - 1,
                               message.action != .confirm,
                               !isInputActive,
                               let suggestions = message.suggestions,
                               !engine.isLoading {
                                let validSuggestions = suggestions.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                                if !validSuggestions.isEmpty {
                                    SuggestionChipsView(
                                        suggestions: validSuggestions,
                                        isDisabled: engine.isLoading
                                    ) { selected in
                                        handleSuggestionTap(selected)
                                    }
                                    .padding(.top, 4)
                                }
                            }
                        }
                    }

                    // Loading indicator (isolated — timer state doesn't re-render chat)
                    if engine.isLoading {
                        LoadingBubble()
                    }

                    // Scroll anchor
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.vertical, 16)
                .animation(.easeInOut(duration: 0.3), value: engine.messages.count)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: engine.messages.count) { _, _ in
                storyCardIndices = computeStoryCardIndices()
                withAnimation {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onAppear {
                storyCardIndices = computeStoryCardIndices()
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    // MARK: - Story Tab Content

    private var storyTabContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Your Story card
                storyNarrativeCard

                // Story Elements card with beat progress
                storyElementsCard
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
    }

    private var storyNarrativeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles.rectangle.stack")
                    .foregroundColor(DesignTokens.gold)

                Text("Your Story")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()
            }

            Text(storyNarrative)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
                .lineSpacing(6)

            // Soul of story if available
            if let soul = engine.soulOfStory {
                Divider()
                    .background(DesignTokens.borderSubtle)

                VStack(alignment: .leading, spacing: 6) {
                    Text("The Soul")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(soul)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
                        .italic()
                }
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var storyElementsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Story Elements")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Text("\(engine.completionScore)%")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundColor(DesignTokens.gold)
            }

            // Beat progress bars
            ForEach(engine.currentBeats) { beat in
                beatProgressRow(beat: beat)
            }

            if shouldOfferReviewOverride {
                reviewOverrideCallout
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func beatProgressRow(beat: V2Beat) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold.opacity(0.5))
                .frame(width: 8, height: 8)

            Text(beat.displayName)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textPrimary)
                .frame(width: 100, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(hex: "#1A1A1A"))
                        .frame(height: 8)

                    // Fill
                    RoundedRectangle(cornerRadius: 4)
                        .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold)
                        .frame(width: geo.size.width * beat.strength, height: 8)
                }
            }
            .frame(height: 8)
        }
    }

    private var storyNarrative: String {
        // Prefer story summary if available, otherwise use current narrative
        if let summary = engine.narrative, !summary.isEmpty {
            return summary
        }
        if !engine.currentNarrative.isEmpty {
            return engine.currentNarrative
        }
        return "You're creating a \(engine.occasion) song for \(engine.recipientName)."
    }

    private var shouldOfferReviewOverride: Bool {
        guard !engine.isComplete, !engine.isLoading, !engine.isEditingFromReview else { return false }
        guard engine.storyId != nil else { return false }
        if let readiness = engine.readiness {
            guard readiness.isUserOverridable || readiness.recommendedNextAction == "review" else {
                return false
            }
        } else {
            guard hasReviewableDraft else { return false }
        }
        return engine.currentAction != .confirm && engine.currentAction != .stop
    }

    private var hasReviewableDraft: Bool {
        let trimmedNarrative = storyNarrative.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = engine.initialPrompt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmedNarrative.count >= 160 || trimmedPrompt.count >= 160 || engine.currentTurn >= 2
    }

    private var reviewOverrideTitle: String {
        if engine.readiness?.isReady == true {
            return "This already reads like a complete story."
        }
        if engine.completionScore >= 70 {
            return "This already reads like a complete story."
        }
        return "Proceed if the draft already says what you mean."
    }

    private var reviewOverrideMessage: String {
        if let readiness = engine.readiness?.why, !readiness.isEmpty {
            return readiness
        }
        if engine.completionScore >= 70 {
            return "The app can keep digging for more detail, but you can review this draft now and decide whether to keep it as-is."
        }
        return "The story elements score is guidance, not a hard rule. If this draft already captures what matters, you can review and continue now."
    }

    private var reviewOverrideCallout: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider()
                .background(DesignTokens.borderSubtle)

            VStack(alignment: .leading, spacing: 8) {
                Text(reviewOverrideTitle)
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text(reviewOverrideMessage)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundColor(DesignTokens.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button {
                showFinishConfirmation = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Use This Story As-Is")
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                }
                .foregroundColor(DesignTokens.gold)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(DesignTokens.gold.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 40))
                .foregroundColor(DesignTokens.gold)

            Text("Let's craft your story")
                .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Text("I'll ask you some questions to understand what makes your relationship special.")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }

    // MARK: - Actions

    private func handleSuggestionTap(_ suggestion: String) {
        guard !engine.isLoading else { return }

        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()

        submitAndHandleError(suggestion)
    }

    private func submitAndHandleError(_ answer: String) {
        if selectedTab != .chat { selectedTab = .chat }
        Task {
            do {
                try await engine.submitAnswer(answer)
                if let message = engine.error?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
                    ToastService.shared.error(message)
                }
            } catch {
                if let message = engine.error?.trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty {
                    ToastService.shared.error(message)
                } else {
                    ToastService.shared.error(error.localizedDescription)
                }
            }
        }
    }

    // MARK: - Story Card Placement Logic

    /// Precomputes which message indices get an inline story card.
    /// Called once per message-count change instead of O(n^2) per render.
    private func computeStoryCardIndices() -> Set<Int> {
        var indices = Set<Int>()
        var aiCount = 0
        for (index, message) in engine.messages.enumerated() {
            guard message.role == .ai else { continue }
            aiCount += 1
            if message.action == .confirm {
                indices.insert(index)
            } else if aiCount > 0 && aiCount % 3 == 0 {
                indices.insert(index)
            }
        }
        return indices
    }
}

// MARK: - Loading Bubble (isolated timer state)

/// Owns animation phase and elapsed-seconds timers so ticks don't
/// trigger reevaluation of the parent chat view.
private struct LoadingBubble: View {
    @State private var animationPhase: Int = 0
    @State private var elapsedSeconds: Int = 0
    @State private var animationTask: Task<Void, Never>?
    @State private var elapsedTask: Task<Void, Never>?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.gold)
                    Text("Thinking...")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                }

                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 8, height: 8)
                            .scaleEffect(dotScale(for: index))
                    }
                }

                Text(elapsedTimeText)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(DesignTokens.gold.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Spacer()
        }
        .padding(.horizontal, 16)
        .onAppear { startTimers() }
        .onDisappear { cancelTimers() }
    }

    private var elapsedTimeText: String {
        if elapsedSeconds < 5 { return "Starting..." }
        else if elapsedSeconds < 20 { return "Crafting your story... \(elapsedSeconds)s" }
        else if elapsedSeconds < 45 { return "Weaving details... \(elapsedSeconds)s" }
        else { return "Almost there... \(elapsedSeconds)s" }
    }

    private func dotScale(for index: Int) -> CGFloat {
        let phase = (animationPhase + index) % 3
        switch phase {
        case 0: return 1.0
        case 1: return 0.7
        default: return 0.5
        }
    }

    private func startTimers() {
        animationTask?.cancel()
        animationTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { break }
                withAnimation(.easeInOut(duration: 0.2)) {
                    animationPhase += 1
                }
            }
        }

        elapsedSeconds = 0
        elapsedTask?.cancel()
        elapsedTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { break }
                elapsedSeconds += 1
            }
        }
    }

    private func cancelTimers() {
        animationTask?.cancel()
        elapsedTask?.cancel()
    }
}

// MARK: - Preview

#Preview {
    AdaptiveConversationView(
        engine: V2StoryEngine(
            apiClient: APIClient(baseURL: AppConfig.apiBaseURL)
        )
    )
}
