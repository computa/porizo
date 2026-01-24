//
//  StoryConfirmationView.swift
//  PorizoApp
//
//  Final review screen for the V2 Story Wizard.
//  Shows tabbed interface with Chat history and Story summary.
//
//  Features:
//  - Segmented picker for Chat/Story tabs
//  - Chat tab: full conversation history (read-only)
//  - Story tab: narrative card + beat progress bars
//  - "Continue to Create Song" button
//

import SwiftUI

// MARK: - Story Confirmation View

struct StoryConfirmationView: View {
    @ObservedObject var engine: V2StoryEngine
    let creationNoun: String
    let onContinue: () -> Void

    @State private var selectedTab: ConfirmationTab = .story

    enum ConfirmationTab: String, CaseIterable {
        case chat = "Chat"
        case story = "Story"
    }

    var body: some View {
        ZStack {
            DesignTokens.backgroundSubtle.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                confirmationHeader

                // Tab picker
                tabPicker

                // Tab content
                TabView(selection: $selectedTab) {
                    chatTabContent
                        .tag(ConfirmationTab.chat)

                    storyTabContent
                        .tag(ConfirmationTab.story)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                // Continue button
                continueButton
            }
        }
    }

    // MARK: - Header

    private var confirmationHeader: some View {
        VStack(spacing: 8) {
            Image(systemName: "party.popper.fill")
                .font(.system(size: 32))
                .foregroundColor(DesignTokens.rose)

            Text("Story Complete!")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(DesignTokens.textPrimary)

            Text("Review your story before creating your \(creationNoun)")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
        }
        .padding(.vertical, 20)
    }

    // MARK: - Tab Picker

    private var tabPicker: some View {
        Picker("View", selection: $selectedTab) {
            ForEach(ConfirmationTab.allCases, id: \.self) { tab in
                Text(tab.rawValue).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    // MARK: - Chat Tab

    private var chatTabContent: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(engine.session.messages) { message in
                    ChatMessageBubble(
                        message: message,
                        isLatest: false,
                        showTypewriterEffect: false
                    )
                }
            }
            .padding(.vertical, 16)
        }
    }

    // MARK: - Story Tab

    private var storyTabContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Your Story card
                storyNarrativeCard

                // Story Elements card
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
                .fill(beat.isFilled ? DesignTokens.success : DesignTokens.rose)
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

    // MARK: - Continue Button

    private var continueButton: some View {
        Button {
            onContinue()
        } label: {
            HStack {
                Text("Continue to Create \(creationNoun.capitalized)")
                    .font(.headline)
                Image(systemName: "arrow.right")
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(DesignTokens.rose)
            .cornerRadius(12)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(DesignTokens.cardBackground)
    }

    // MARK: - Helpers

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
}

// MARK: - Preview

#Preview {
    StoryConfirmationView(
        engine: V2StoryEngine(
            apiClient: APIClient(baseURL: AppConfig.apiBaseURL)
        ),
        creationNoun: "song",
        onContinue: {}
    )
}
