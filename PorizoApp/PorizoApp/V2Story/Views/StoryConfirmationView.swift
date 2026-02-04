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
    var onEdit: (() -> Void)? = nil
    var onClose: (() -> Void)? = nil

    @State private var selectedTab: ConfirmationTab = .story

    enum ConfirmationTab: String, CaseIterable {
        case chat = "Chat"
        case story = "Story"
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

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
    }

    // MARK: - Header

    private var confirmationHeader: some View {
        VStack(spacing: 8) {
            Image(systemName: "party.popper.fill")
                .font(.system(size: 32))
                .foregroundColor(DesignTokens.gold)

            Text("Story Complete!")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)

            Text("Review your story before creating your \(creationNoun)")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .padding(.vertical, 20)
    }

    // MARK: - Tab Picker (v1.pen: gold accent)

    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(ConfirmationTab.allCases, id: \.self) { tab in
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
                    .foregroundColor(DesignTokens.gold)

                Text("Your Story")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                if let onEdit {
                    Button {
                        onEdit()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil")
                                .font(.system(size: 12))
                            Text("Edit")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        }
                        .foregroundColor(DesignTokens.gold)
                    }
                }
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

    // MARK: - Continue Button (v1.pen: gold, 56h, cornerRadius 28)

    private var continueButton: some View {
        Button {
            onContinue()
        } label: {
            HStack {
                Text("Continue to Create \(creationNoun.capitalized)")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                Image(systemName: "arrow.right")
            }
            .foregroundColor(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(DesignTokens.gold)
            .cornerRadius(28)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(DesignTokens.surface)
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
