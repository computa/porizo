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
//  - Story tab: narrative + interactive elements + optional diff
//  - "Continue to Create Song" button
//

import SwiftUI

// MARK: - Story Confirmation View

struct StoryConfirmationView: View {
    var engine: V2StoryEngine
    let creationNoun: String
    let onContinue: () -> Void
    var onEdit: (() -> Void)? = nil
    var onClose: (() -> Void)? = nil

    @State private var selectedTab: ConfirmationTab = .story

    private var draft: StoryDraftSnapshot {
        engine.draft
    }

    enum ConfirmationTab: String, CaseIterable {
        case chat = "Chat"
        case story = "Story"
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                confirmationHeader
                tabPicker

                TabView(selection: $selectedTab) {
                    chatTabContent
                        .tag(ConfirmationTab.chat)
                    storyTabContent
                        .tag(ConfirmationTab.story)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

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
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 36, height: 36)
                        .background(DesignTokens.surface)
                        .clipShape(Circle())
                }
                .accessibilityLabel("Close")
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
                .foregroundStyle(DesignTokens.gold)

            Text("Story Complete!")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Review your story before creating your \(creationNoun)")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)

            if draft.narrativeVersion > 0 {
                Text("Draft Version \(draft.narrativeVersion)")
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
            }
        }
        .padding(.vertical, 20)
    }

    // MARK: - Tab Picker

    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(ConfirmationTab.allCases, id: \.self) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    Text(tab.rawValue)
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(selectedTab == tab ? DesignTokens.textPrimary : DesignTokens.textSecondary)
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
        .background(DesignTokens.surfaceMuted)
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
                ForEach(engine.messages) { message in
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
                if let resumeNotice = draft.resumeNotice, !resumeNotice.isEmpty {
                    StatusBannerCard(
                        title: "Resume Update",
                        message: resumeNotice,
                        accent: DesignTokens.gold,
                        icon: "clock.arrow.trianglehead.counterclockwise.rotate.90"
                    )
                }

                if let pendingRevision = draft.pendingRevision {
                    StatusBannerCard(
                        title: "Awaiting Clarification",
                        message: pendingRevision.followUpQuestion ?? "One more detail is needed before this revision can be applied.",
                        accent: DesignTokens.gold,
                        icon: "questionmark.bubble"
                    )
                }

                StoryNarrativeCardView(engine: engine, onEdit: onEdit)

                if draft.draftDiff != nil {
                    DraftDiffCardView(engine: engine)
                }

                InteractiveStoryElementsView(engine: engine)

                if !draft.revisionHistory.isEmpty {
                    revisionSummaryRow
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
    }

    // MARK: - Continue Button

    private var continueButton: some View {
        Button {
            onContinue()
        } label: {
            HStack {
                Text("Continue to Create \(creationNoun.capitalized)")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                Image(systemName: "arrow.right")
            }
            .foregroundStyle(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(DesignTokens.gold)
            .clipShape(.rect(cornerRadius: 28))
        }
        .disabled(engine.isLoading || draft.pendingRevision != nil)
        .opacity(engine.isLoading || draft.pendingRevision != nil ? 0.6 : 1.0)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(DesignTokens.surface)
    }

    // MARK: - Revision Summary (collapsed one-liner)

    private var revisionSummaryRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "pencil.line")
                .font(.system(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)

            Text("\(draft.revisionHistory.count) revision\(draft.revisionHistory.count == 1 ? "" : "s") applied")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)

            Spacer()
        }
        .padding(.horizontal, 4)
    }
}

// MARK: - Status Banner Card

private struct StatusBannerCard: View {
    let title: String
    let message: String
    let accent: Color
    let icon: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(accent)
                .font(.system(size: 16, weight: .semibold))
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text(message)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .textSelection(.enabled)
            }

            Spacer()
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Story Narrative Card

private struct StoryNarrativeCardView: View {
    var engine: V2StoryEngine
    var onEdit: (() -> Void)?

    private var draft: StoryDraftSnapshot {
        engine.draft
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles.rectangle.stack")
                    .foregroundStyle(DesignTokens.gold)

                Text("Your Story")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                if draft.narrativeVersion > 0 {
                    Text("v\(draft.narrativeVersion)")
                        .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(DesignTokens.gold.opacity(0.12))
                        .clipShape(Capsule())
                }

                if let onEdit {
                    Button {
                        onEdit()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil")
                                .font(.system(size: 12))
                            Text("Chat Editor")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        }
                        .foregroundStyle(DesignTokens.gold)
                    }
                }
            }

            SelectableText(
                text: draft.displayNarrative,
                font: .systemFont(ofSize: 16),
                lineSpacing: 6
            )

            if let soul = draft.soulOfStory {
                Divider()
                    .background(DesignTokens.borderSubtle)

                VStack(alignment: .leading, spacing: 6) {
                    Text("The Soul")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)

                    SelectableText(
                        text: soul,
                        font: .italicSystemFont(ofSize: 14),
                        textColor: UIColor(DesignTokens.textSecondary)
                    )
                }
            }

            if let revisionSummary = latestRevisionSummary {
                Divider()
                    .background(DesignTokens.borderSubtle)

                Label(revisionSummary, systemImage: "arrow.trianglehead.2.clockwise")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .textSelection(.enabled)
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var latestRevisionSummary: String? {
        guard let delta = draft.lastIntegrationDelta else { return nil }

        var parts: [String] = []
        if delta.narrativeRewritten {
            parts.append("Narrative rewritten")
        }
        if !delta.updatedFacts.isEmpty {
            parts.append("\(delta.updatedFacts.count) detail updated")
        }
        if !delta.addedFacts.isEmpty {
            parts.append("\(delta.addedFacts.count) detail added")
        }
        if !delta.supersededFacts.isEmpty {
            parts.append("\(delta.supersededFacts.count) detail replaced")
        }
        if !delta.conflictsDetected.isEmpty {
            parts.append("\(delta.conflictsDetected.count) conflict noted")
        }

        return parts.isEmpty ? nil : parts.joined(separator: " • ")
    }
}

// MARK: - Draft Diff Card

private struct DraftDiffCardView: View {
    var engine: V2StoryEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Latest Draft Diff")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                if let before = engine.draftDiff?.beforeScore,
                   let after = engine.draftDiff?.afterScore {
                    scoreChangeBadge(before: before, after: after)
                }
            }

            if let summary = engine.revisionHistory.last?.summary {
                Text(summary)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
            }

            if let beforeText = engine.draftDiff?.beforeText, !beforeText.isEmpty {
                diffBlock(title: "Before", text: beforeText, accent: DesignTokens.textSecondary)
            }

            if let afterText = engine.draftDiff?.afterText, !afterText.isEmpty {
                diffBlock(title: "After", text: afterText, accent: DesignTokens.success)
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func diffBlock(title: String, text: String, accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundStyle(accent)
                Text(text)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(6)
                    .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(hex: "#121212"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func scoreChangeBadge(before: Int, after: Int) -> some View {
        let delta = after - before
        let improved = delta > 0
        let color: Color = improved ? DesignTokens.success : (delta < 0 ? Color(hex: "#FF6B6B") : DesignTokens.textSecondary)
        let arrow = improved ? "↑" : (delta < 0 ? "↓" : "→")

        return HStack(spacing: 4) {
            Text("\(before)%")
                .foregroundStyle(DesignTokens.textSecondary)
            Text(arrow)
                .foregroundStyle(color)
            Text("\(after)%")
                .foregroundStyle(color)
                .fontWeight(.semibold)
        }
        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.12))
        .clipShape(Capsule())
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
