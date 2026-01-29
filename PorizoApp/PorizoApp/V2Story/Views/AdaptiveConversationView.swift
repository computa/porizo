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
    @ObservedObject var engine: V2StoryEngine
    var onClose: (() -> Void)? = nil
    @State private var inputText: String = ""
    @State private var showFinishConfirmation: Bool = false
    @State private var expandedStoryCardId: UUID? = nil
    @State private var selectedTab: ConversationViewTab = .chat
    @State private var showSpeechInput: Bool = false
    @FocusState private var isInputFocused: Bool

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with progress
                ConversationHeaderMinimal(
                    recipientName: engine.session.recipientName,
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

                // Input bar (always visible)
                inputBar
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
        .animation(.easeInOut(duration: 0.3), value: engine.session.messages.count)
        .animation(.easeInOut(duration: 0.2), value: selectedTab)
        .alert("Finish Early?", isPresented: $showFinishConfirmation) {
            Button("Keep Going", role: .cancel) { }
            Button("I'm Done") {
                engine.finishEarly()
            }
        } message: {
            Text("You can add more details to make your song more personal, or finish now with what you've shared.")
        }
        .fullScreenCover(isPresented: $showSpeechInput) {
            SpeechInputView(
                storyId: engine.session.storyId ?? "",
                onTranscription: { text in
                    inputText = text
                    showSpeechInput = false
                    // Focus the input field so user can review/edit before sending
                    isInputFocused = true
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
                    if engine.session.messages.isEmpty && !engine.isLoading {
                        emptyStateView
                    }

                    // Render messages with inline story cards
                    ForEach(Array(engine.session.messages.enumerated()), id: \.element.id) { index, message in
                        VStack(spacing: 12) {
                            // Check if we should show inline story card before this message
                            if shouldShowStoryCard(at: index) {
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
                                isLatest: index == engine.session.messages.count - 1,
                                showTypewriterEffect: index == engine.session.messages.count - 1 && message.role == .ai
                            )
                            .id(message.id)

                            // Suggestion chips below the latest AI message
                            // Hidden when user is typing to avoid distraction
                            // Filter empty strings to prevent blank chips
                            if message.role == .ai,
                               index == engine.session.messages.count - 1,
                               let suggestions = message.suggestions,
                               !engine.isLoading,
                               inputText.isEmpty {
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

                    // Loading indicator
                    if engine.isLoading {
                        loadingIndicator
                    }

                    // Scroll anchor
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.vertical, 16)
            }
            .onChange(of: engine.session.messages.count) { _, _ in
                withAnimation {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onAppear {
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
            if let soul = engine.session.soulOfStory {
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
        if let summary = engine.session.storySummary, !summary.isEmpty {
            return summary
        }
        if !engine.currentNarrative.isEmpty {
            return engine.currentNarrative
        }
        return "You're creating a \(engine.session.occasion) song for \(engine.session.recipientName)."
    }

    // MARK: - Input Bar (v1.pen: gold accent)

    private var inputBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)

            VStack(spacing: 12) {
                // Text input row
                HStack(spacing: 12) {
                    TextField("Share your thoughts...", text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.gold)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(DesignTokens.inputBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .strokeBorder(DesignTokens.borderSubtle, lineWidth: 1)
                        )
                        .focused($isInputFocused)
                        .lineLimit(1...4)

                    // Microphone button for speech input
                    if !engine.isLoading {
                        Button {
                            showSpeechInput = true
                        } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 20))
                                .foregroundColor(DesignTokens.gold)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }

                    // Send button
                    Button {
                        submitAnswer()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(inputText.isEmpty || engine.isLoading ? DesignTokens.borderSubtle : DesignTokens.gold)
                    }
                    .disabled(inputText.isEmpty || engine.isLoading)
                }

                // "I'm done sharing" option - made bold and prominent
                if engine.session.currentTurn >= 2 {
                    Button {
                        showFinishConfirmation = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 18, weight: .semibold))
                            Text("I'm done sharing")
                                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        }
                        .foregroundColor(DesignTokens.gold)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 16)
                        .background(DesignTokens.gold.opacity(0.12))
                        .cornerRadius(20)
                    }
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(DesignTokens.surface)
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

    // MARK: - Loading Indicator

    private var loadingIndicator: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                // Thinking label with sparkle
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.gold)
                    Text("Thinking...")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(DesignTokens.gold)
                }

                // Animated dots
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 8, height: 8)
                            .scaleEffect(loadingDotScale(for: index))
                    }
                }

                // Elapsed time with contextual message
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
        .onAppear {
            startLoadingAnimation()
            startElapsedTimer()
        }
        .onDisappear {
            loadingTask?.cancel()
            elapsedTask?.cancel()
        }
    }

    @State private var loadingAnimationPhase: Int = 0
    @State private var loadingTask: Task<Void, Never>?
    @State private var elapsedSeconds: Int = 0
    @State private var elapsedTask: Task<Void, Never>?

    private var elapsedTimeText: String {
        if elapsedSeconds < 5 {
            return "Starting..."
        } else if elapsedSeconds < 20 {
            return "Crafting your story... \(elapsedSeconds)s"
        } else if elapsedSeconds < 45 {
            return "Weaving details... \(elapsedSeconds)s"
        } else {
            return "Almost there... \(elapsedSeconds)s"
        }
    }

    private func loadingDotScale(for index: Int) -> CGFloat {
        let phase = (loadingAnimationPhase + index) % 3
        switch phase {
        case 0: return 1.0
        case 1: return 0.7
        default: return 0.5
        }
    }

    private func startLoadingAnimation() {
        loadingTask?.cancel()
        loadingTask = Task { @MainActor in
            while engine.isLoading {
                try? await Task.sleep(for: .milliseconds(300))
                guard engine.isLoading else { break }
                withAnimation(.easeInOut(duration: 0.2)) {
                    loadingAnimationPhase += 1
                }
            }
        }
    }

    private func startElapsedTimer() {
        elapsedSeconds = 0
        elapsedTask?.cancel()
        elapsedTask = Task { @MainActor in
            while engine.isLoading {
                try? await Task.sleep(for: .seconds(1))
                guard engine.isLoading else { break }
                elapsedSeconds += 1
            }
        }
    }

    // MARK: - Actions

    private func submitAnswer() {
        guard !inputText.isEmpty else { return }
        guard !engine.isLoading else { return }  // Prevent double-tap

        // Immediate haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        let answer = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        inputText = ""
        isInputFocused = false

        // Switch to chat tab when submitting
        if selectedTab != .chat {
            selectedTab = .chat
        }

        Task {
            do {
                try await engine.submitAnswer(answer)
            } catch {
                // Error is stored in engine.error
            }
        }
    }

    private func handleSuggestionTap(_ suggestion: String) {
        guard !engine.isLoading else { return }

        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()

        // Clear any text in the input field
        inputText = ""
        isInputFocused = false

        // Switch to chat tab when submitting
        if selectedTab != .chat {
            selectedTab = .chat
        }

        Task {
            do {
                try await engine.submitAnswer(suggestion)
            } catch {
                // Error is stored in engine.error
            }
        }
    }

    // MARK: - Story Card Placement Logic

    /// Determines if an inline story card should appear before the message at this index
    private func shouldShowStoryCard(at index: Int) -> Bool {
        let message = engine.session.messages[index]

        // Only show before AI messages
        guard message.role == .ai else { return false }

        // Show before CONFIRM actions
        if message.action == .confirm {
            return true
        }

        // Show every 3 AI turns (after turns 3, 6, 9...)
        // Count AI messages up to this point
        let aiMessageCount = engine.session.messages.prefix(index + 1)
            .filter { $0.role == .ai }
            .count

        // Show at turns 3, 6, 9...
        if aiMessageCount > 0 && aiMessageCount % 3 == 0 {
            return true
        }

        return false
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
