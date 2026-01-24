//
//  AdaptiveConversationView.swift
//  PorizoApp
//
//  Chat-style conversation UI for the V2 Story Wizard.
//
//  Features:
//  - Chat/Story tab toggle to switch between conversation and story preview
//  - Scrollable chat with full conversation history
//  - AI messages (left) with colored backgrounds by action type
//  - User messages (right) with rose filled background
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
    @State private var inputText: String = ""
    @State private var showFinishConfirmation: Bool = false
    @State private var expandedStoryCardId: UUID? = nil
    @State private var selectedTab: ConversationViewTab = .chat
    @FocusState private var isInputFocused: Bool

    var body: some View {
        ZStack {
            DesignTokens.backgroundSubtle.ignoresSafeArea()

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
    }

    // MARK: - Tab Picker

    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(ConversationViewTab.allCases, id: \.self) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Text(tab.rawValue)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(selectedTab == tab ? DesignTokens.textPrimary : DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            selectedTab == tab
                                ? DesignTokens.cardBackground
                                : Color.clear
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .background(DesignTokens.backgroundSubtle)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(DesignTokens.cardBorder, lineWidth: 1)
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
                    .foregroundColor(DesignTokens.rose)

                Text("Your Story")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()
            }

            Text(storyNarrative)
                .font(.body)
                .foregroundColor(DesignTokens.textPrimary)
                .lineSpacing(6)

            // Soul of story if available
            if let soul = engine.session.soulOfStory {
                Divider()
                    .background(DesignTokens.cardBorder)

                VStack(alignment: .leading, spacing: 6) {
                    Text("The Soul")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(soul)
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                        .italic()
                }
            }
        }
        .padding(16)
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .elevation(.level2)
    }

    private var storyElementsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Story Elements")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Text("\(engine.completionScore)%")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(DesignTokens.rose)
            }

            // Beat progress bars
            ForEach(engine.currentBeats) { beat in
                beatProgressRow(beat: beat)
            }
        }
        .padding(16)
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .elevation(.level2)
    }

    private func beatProgressRow(beat: V2Beat) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(beat.isFilled ? DesignTokens.success : DesignTokens.rose.opacity(0.5))
                .frame(width: 8, height: 8)

            Text(beat.displayName)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)
                .frame(width: 100, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.backgroundSubtle)
                        .frame(height: 8)

                    // Fill
                    RoundedRectangle(cornerRadius: 4)
                        .fill(beat.isFilled ? DesignTokens.success : DesignTokens.rose)
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

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()
                .background(DesignTokens.cardBorder)

            VStack(spacing: 12) {
                // Text input row
                HStack(spacing: 12) {
                    TextField("Share your thoughts...", text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.body)
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.rose)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(DesignTokens.backgroundSubtle)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .strokeBorder(DesignTokens.cardBorder, lineWidth: 1)
                        )
                        .focused($isInputFocused)
                        .lineLimit(1...4)

                    // Send button
                    Button {
                        submitAnswer()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(inputText.isEmpty || engine.isLoading ? DesignTokens.cardBorder : DesignTokens.rose)
                    }
                    .disabled(inputText.isEmpty || engine.isLoading)
                }

                // "I'm done sharing" option
                if engine.session.currentTurn >= 2 {
                    Button {
                        showFinishConfirmation = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle")
                                .font(.system(size: 14))
                            Text("I'm done sharing")
                                .font(.subheadline)
                        }
                        .foregroundColor(DesignTokens.textSecondary)
                    }
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(DesignTokens.cardBackground)
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 40))
                .foregroundColor(DesignTokens.rose)

            Text("Let's craft your story")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text("I'll ask you some questions to understand what makes your relationship special.")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }

    // MARK: - Loading Indicator

    private var loadingIndicator: some View {
        HStack {
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(DesignTokens.rose)
                        .frame(width: 8, height: 8)
                        .scaleEffect(loadingDotScale(for: index))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(DesignTokens.roseMuted)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Spacer()
        }
        .padding(.horizontal, 16)
        .onAppear {
            startLoadingAnimation()
        }
    }

    @State private var loadingAnimationPhase: Int = 0

    private func loadingDotScale(for index: Int) -> CGFloat {
        let phase = (loadingAnimationPhase + index) % 3
        switch phase {
        case 0: return 1.0
        case 1: return 0.7
        default: return 0.5
        }
    }

    private func startLoadingAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { timer in
            if !engine.isLoading {
                timer.invalidate()
                return
            }
            withAnimation(.easeInOut(duration: 0.2)) {
                loadingAnimationPhase += 1
            }
        }
    }

    // MARK: - Actions

    private func submitAnswer() {
        guard !inputText.isEmpty else { return }

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
