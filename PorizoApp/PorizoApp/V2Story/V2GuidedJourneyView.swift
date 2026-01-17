//
//  V2GuidedJourneyView.swift
//  PorizoApp
//
//  Full-screen immersive cards with smooth transitions.
//  Each V2 action type has a distinct card style.
//  Enhanced with collapsible "View Your Story" panel.
//

import SwiftUI

struct V2GuidedJourneyView: View {
    @ObservedObject var engine: V2StoryEngine
    @State private var inputText: String = ""
    @State private var isStoryPanelExpanded: Bool = false
    @State private var previousNarrative: String = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        ZStack {
            // Background gradient based on action
            backgroundGradient
                .ignoresSafeArea()

            // Main content
            VStack(spacing: 0) {
                // Collapsible story panel
                storyPanelHeader
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                if isStoryPanelExpanded {
                    expandedStoryPanel
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                // Progress dots
                progressDots
                    .padding(.top, isStoryPanelExpanded ? 12 : 20)

                Spacer()

                // Card based on current action
                if let response = engine.session.currentResponse {
                    cardView(for: response)
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .move(edge: .leading).combined(with: .opacity)
                        ))
                        .id(response.id)
                } else if engine.isLoading {
                    loadingCard
                } else {
                    welcomeCard
                }

                Spacer()

                // Beat summary at bottom
                if let response = engine.session.currentResponse, !isStoryPanelExpanded {
                    beatSummaryBar(response: response)
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 20)
        }
        .animation(.easeInOut(duration: 0.4), value: engine.session.currentResponse?.id)
        .animation(.spring(response: 0.3), value: isStoryPanelExpanded)
    }

    // MARK: - Story Panel

    private var storyPanelHeader: some View {
        Button {
            withAnimation(.spring(response: 0.3)) {
                isStoryPanelExpanded.toggle()
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "sparkles.rectangle.stack")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.rose)

                Text("View Your Story")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Text("\(engine.completionScore)%")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(DesignTokens.rose)

                Image(systemName: isStoryPanelExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(DesignTokens.cardBackground.opacity(0.95))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private var expandedStoryPanel: some View {
        V2NarrativeCanvasWithBeats(
            narrative: engine.currentNarrative,
            previousNarrative: previousNarrative,
            beats: engine.currentBeats,
            completionScore: engine.completionScore
        )
    }

    // MARK: - Background Gradient

    private var backgroundGradient: some View {
        Group {
            if let action = engine.session.currentResponse?.action {
                switch action {
                case .ask:
                    LinearGradient(
                        colors: [DesignTokens.roseMuted, DesignTokens.backgroundSubtle],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                case .clarify:
                    LinearGradient(
                        colors: [Color.orange.opacity(0.15), DesignTokens.backgroundSubtle],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                case .confirm:
                    LinearGradient(
                        colors: [Color.green.opacity(0.15), DesignTokens.backgroundSubtle],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                case .stop:
                    LinearGradient(
                        colors: [Color.purple.opacity(0.15), DesignTokens.backgroundSubtle],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
            } else {
                DesignTokens.backgroundSubtle
            }
        }
    }

    // MARK: - Progress Dots

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<6, id: \.self) { index in
                Circle()
                    .fill(index < engine.session.currentTurn ? DesignTokens.rose : DesignTokens.cardBorder)
                    .frame(width: 10, height: 10)
            }
        }
    }

    // MARK: - Card Views

    @ViewBuilder
    private func cardView(for response: V2EngineResponse) -> some View {
        switch response.action {
        case .ask, .clarify:
            questionCard(response: response)
        case .confirm:
            confirmCard(response: response)
        case .stop:
            completeCard(response: response)
        }
    }

    private func questionCard(response: V2EngineResponse) -> some View {
        VStack(spacing: 24) {
            // Action badge
            HStack {
                Image(systemName: response.action.iconName)
                    .font(.system(size: 14, weight: .semibold))
                Text(response.action.displayName)
                    .font(.subheadline)
                    .fontWeight(.semibold)
            }
            .foregroundColor(response.action == .ask ? DesignTokens.rose : DesignTokens.warning)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill((response.action == .ask ? DesignTokens.rose : DesignTokens.warning).opacity(0.15))
            )

            // Question
            Text(response.question ?? "")
                .font(.title2)
                .fontWeight(.medium)
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)

            // Input area
            VStack(spacing: 12) {
                TextField("Share your thoughts...", text: $inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(.body)
                    .padding(16)
                    .background(DesignTokens.cardBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(DesignTokens.cardBorder, lineWidth: 1)
                    )
                    .focused($isInputFocused)
                    .lineLimit(2...6)

                Button {
                    submitAnswer()
                } label: {
                    HStack {
                        if engine.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        } else {
                            Text("Continue")
                                .fontWeight(.semibold)
                            Image(systemName: "arrow.right")
                        }
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(inputText.isEmpty ? DesignTokens.cardBorder : DesignTokens.rose)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(inputText.isEmpty || engine.isLoading)
            }
        }
        .padding(32)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(DesignTokens.cardBackground)
                .shadow(color: .black.opacity(0.1), radius: 20, y: 10)
        )
        .padding(.horizontal, 16)
    }

    private func confirmCard(response: V2EngineResponse) -> some View {
        VStack(spacing: 24) {
            // Icon
            Image(systemName: "checkmark.circle")
                .font(.system(size: 56))
                .foregroundColor(DesignTokens.success)

            // Message
            Text(response.confirmation ?? "Your story is ready!")
                .font(.title3)
                .fontWeight(.medium)
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)

            // Narrative preview
            Text(response.narrative)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .italic()
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .padding(.horizontal, 8)

            // Actions
            HStack(spacing: 16) {
                Button {
                    // Add more details - sends "add more" to continue
                    inputText = "I'd like to add more details."
                    submitAnswer()
                } label: {
                    Text("Add More")
                        .fontWeight(.medium)
                        .foregroundColor(DesignTokens.rose)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .overlay(
                            Capsule()
                                .strokeBorder(DesignTokens.rose, lineWidth: 2)
                        )
                }

                Button {
                    // Confirm and proceed
                    inputText = "Yes, let's create the song!"
                    submitAnswer()
                } label: {
                    HStack {
                        if engine.isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        } else {
                            Text("Create Song")
                                .fontWeight(.semibold)
                        }
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.rose)
                    .clipShape(Capsule())
                }
                .disabled(engine.isLoading)
            }
        }
        .padding(32)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(DesignTokens.cardBackground)
                .shadow(color: .black.opacity(0.1), radius: 20, y: 10)
        )
        .padding(.horizontal, 16)
    }

    private func completeCard(response: V2EngineResponse) -> some View {
        VStack(spacing: 24) {
            // Celebration icon
            Image(systemName: "party.popper.fill")
                .font(.system(size: 64))
                .foregroundColor(.purple)

            Text("Story Complete!")
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(DesignTokens.textPrimary)

            Text("\(response.completionScore)% of your story captured")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)

            // Narrative
            Text(response.narrative)
                .font(.body)
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(16)
                .background(DesignTokens.backgroundSubtle)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding(32)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(DesignTokens.cardBackground)
                .shadow(color: .black.opacity(0.1), radius: 20, y: 10)
        )
        .padding(.horizontal, 16)
    }

    private var welcomeCard: some View {
        VStack(spacing: 24) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundColor(DesignTokens.rose)

            Text("Let's Write Your Song")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(DesignTokens.textPrimary)

            Text("I'll ask you some questions to understand the story you want to tell.")
                .font(.body)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(DesignTokens.cardBackground)
                .shadow(color: .black.opacity(0.1), radius: 20, y: 10)
        )
        .padding(.horizontal, 16)
    }

    private var loadingCard: some View {
        VStack(spacing: 24) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.rose))
                .scaleEffect(1.5)

            Text("Thinking...")
                .font(.headline)
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(48)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(DesignTokens.cardBackground)
                .shadow(color: .black.opacity(0.1), radius: 20, y: 10)
        )
        .padding(.horizontal, 16)
    }

    // MARK: - Beat Summary Bar

    private func beatSummaryBar(response: V2EngineResponse) -> some View {
        HStack(spacing: 12) {
            ForEach(response.beats.prefix(4)) { beat in
                VStack(spacing: 4) {
                    Circle()
                        .fill(beat.isFilled ? DesignTokens.success : DesignTokens.cardBorder)
                        .frame(width: 8, height: 8)

                    Text(beat.displayName)
                        .font(.caption2)
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            Capsule()
                .fill(DesignTokens.cardBackground.opacity(0.9))
        )
    }

    // MARK: - Actions

    private func submitAnswer() {
        let answer = inputText.isEmpty ? "Yes, let's do it!" : inputText.trimmingCharacters(in: .whitespacesAndNewlines)

        // Store current narrative before update
        previousNarrative = engine.currentNarrative

        inputText = ""
        isInputFocused = false

        Task {
            do {
                try await engine.submitAnswer(answer)
            } catch {
                // Error is stored in engine.error
            }
        }
    }
}
