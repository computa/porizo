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

                RevisionComposerView(engine: engine) {
                    selectedTab = .story
                }

                FinalNotesCardView(engine: engine)

                if !draft.factInventory.isEmpty {
                    FactInventoryCardView(engine: engine)
                }

                if !draft.openConflicts.isEmpty {
                    ConflictResolutionCardView(engine: engine)
                }

                if !draft.revisionHistory.isEmpty {
                    RevisionHistoryCardView(engine: engine)
                }

                ProvenanceCardView(engine: engine)

                StoryElementsCardView(engine: engine)
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
        .disabled(engine.isLoading || hasPendingRevisionDraft || draft.pendingRevision != nil)
        .opacity(engine.isLoading || hasPendingRevisionDraft || draft.pendingRevision != nil ? 0.6 : 1.0)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(DesignTokens.surface)
    }

    private var hasPendingRevisionDraft: Bool {
        !engine.localReviewDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
            Text("Latest Draft Diff")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

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
}

// MARK: - Revision Composer

private struct RevisionComposerView: View {
    var engine: V2StoryEngine
    var onRevisionApplied: () -> Void

    @State private var revisionRequest = ""
    @State private var localRevisionMessage: String?
    @State private var selectedRevisionIntent: StoryRevisionIntent = .append
    @State private var selectedFactTargetId: String?
    @State private var selectedConflictTargetId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(revisionSectionTitle)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)

                    Text(revisionSectionSubtitle)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Spacer()

                if engine.isLoading {
                    ProgressView()
                        .tint(DesignTokens.gold)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Edit Intent")
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)

                HStack(spacing: 8) {
                    ForEach(StoryRevisionIntent.allCases) { intent in
                        Button {
                            selectedRevisionIntent = intent
                        } label: {
                            Text(intent.title)
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundStyle(selectedRevisionIntent == intent ? DesignTokens.background : DesignTokens.textPrimary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(selectedRevisionIntent == intent ? DesignTokens.gold : Color(hex: "#121212"))
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }

                Text(selectedRevisionIntent.subtitle)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            if selectedRevisionIntent == .replace || selectedRevisionIntent == .remove {
                targetFactSelectorCard
            }

            if selectedRevisionIntent == .resolveConflict {
                targetConflictSelectorCard
            }

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(hex: "#121212"))

                TextEditor(text: $revisionRequest)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(minHeight: 112)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .font(DesignTokens.bodyFont(size: 15))
                    .disabled(engine.isLoading)

                if revisionRequest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(revisionPlaceholder)
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary.opacity(0.75))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 18)
                        .allowsHitTesting(false)
                }
            }
            .frame(minHeight: 112)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(DesignTokens.borderSubtle, lineWidth: 1)
            )

            if let localRevisionMessage {
                Text(localRevisionMessage)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.success)
            } else if let revisionFollowUpQuestion {
                Text(revisionFollowUpQuestion)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
            }

            if hasPendingDraft {
                Text("Apply or clear this change request before continuing.")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            HStack(spacing: 12) {
                Button {
                    clearRevisionDraft()
                } label: {
                    Text("Clear")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(Color(hex: "#121212"))
                        .clipShape(RoundedRectangle(cornerRadius: 22))
                }
                .disabled(engine.isLoading || !hasPendingDraft)

                Button {
                    submitRevision()
                } label: {
                    HStack(spacing: 6) {
                        Text(revisionActionTitle)
                        Image(systemName: "arrow.trianglehead.2.clockwise")
                    }
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.background)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 22))
                }
                .disabled(engine.isLoading || !canSubmitRevision)
                .opacity(engine.isLoading || !canSubmitRevision ? 0.6 : 1.0)
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .onAppear {
            revisionRequest = engine.localReviewDraft
        }
        .onDisappear {
            engine.localReviewDraft = revisionRequest
            engine.schedulePersistence()
        }
        .onChange(of: revisionRequest) { _, newValue in
            localRevisionMessage = nil
            engine.localReviewDraft = newValue
        }
        .onChange(of: selectedRevisionIntent) { _, _ in
            selectedFactTargetId = nil
            selectedConflictTargetId = nil
        }
    }

    // MARK: - Target Selectors

    private var targetFactSelectorCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Target Detail")
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)

            ForEach(Array(engine.factInventory.prefix(5).enumerated()), id: \.offset) { item in
                let fact = item.element
                Button {
                    selectedFactTargetId = fact.id
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selectedFactTargetId == fact.id ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selectedFactTargetId == fact.id ? DesignTokens.gold : DesignTokens.textTertiary)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(fact.text)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(DesignTokens.textPrimary)
                                .textSelection(.enabled)
                            if let beat = fact.beat, !beat.isEmpty {
                                Text(beat.capitalized)
                                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                                    .foregroundStyle(DesignTokens.textSecondary)
                            }
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(Color(hex: "#121212"))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var targetConflictSelectorCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Conflict To Resolve")
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)

            ForEach(engine.openConflicts.prefix(4)) { conflict in
                Button {
                    selectedConflictTargetId = conflict.id
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: selectedConflictTargetId == conflict.id ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selectedConflictTargetId == conflict.id ? DesignTokens.gold : DesignTokens.textTertiary)
                        Text(conflict.summary ?? "Conflict")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                    }
                    .padding(12)
                    .background(Color(hex: "#121212"))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Computed Properties

    private var hasPendingDraft: Bool {
        !revisionRequest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canSubmitRevision: Bool {
        guard hasPendingDraft else { return false }
        switch selectedRevisionIntent {
        case .append:
            return true
        case .replace, .remove:
            return selectedFactTarget != nil
        case .resolveConflict:
            return selectedConflictTarget != nil
        }
    }

    private var selectedFactTarget: StorySessionFact? {
        engine.factInventory.first(where: { $0.id == selectedFactTargetId })
    }

    private var selectedConflictTarget: StoryDraftConflict? {
        engine.openConflicts.first(where: { $0.id == selectedConflictTargetId })
    }

    private var revisionFollowUpQuestion: String? {
        if let pending = engine.pendingRevision?.followUpQuestion, !pending.isEmpty {
            return pending
        }
        guard let response = engine.currentResponse else { return nil }
        guard response.action == .ask || response.action == .clarify else { return nil }
        return response.question
    }

    private var revisionSectionTitle: String {
        revisionFollowUpQuestion == nil ? "Refine Story" : "Clarify This Change"
    }

    private var revisionSectionSubtitle: String {
        if revisionFollowUpQuestion == nil {
            switch selectedRevisionIntent {
            case .append:
                return "Add a new detail or emphasis without leaving review."
            case .replace:
                return "Target an existing fact and tell the draft what should replace it."
            case .remove:
                return "Select a fact that should be removed from the draft."
            case .resolveConflict:
                return "Choose the conflict that needs a clear resolution."
            }
        }
        return "Answer the follow-up so the draft can update cleanly."
    }

    private var revisionPlaceholder: String {
        if let revisionFollowUpQuestion {
            return revisionFollowUpQuestion
        }
        switch selectedRevisionIntent {
        case .append:
            return "Example: tighten the opening, remove the joke line, and make the ending focus on how Awka trained him for what came next."
        case .replace:
            return "Write the replacement detail exactly as it should appear in the story."
        case .remove:
            return "Briefly explain why this detail should be removed."
        case .resolveConflict:
            return "Explain which version is correct and why."
        }
    }

    private var revisionActionTitle: String {
        revisionFollowUpQuestion == nil ? "Apply Changes" : "Submit Clarification"
    }

    private var revisionOperation: StoryRevisionOperation? {
        switch selectedRevisionIntent {
        case .append:
            return StoryRevisionOperation(
                type: "append",
                targetType: "narrative",
                targetId: nil,
                targetText: nil,
                replacementText: nil,
                resolution: nil
            )
        case .replace:
            return StoryRevisionOperation(
                type: "replace",
                targetType: selectedFactTarget == nil ? "section" : "fact",
                targetId: selectedFactTarget?.id,
                targetText: selectedFactTarget?.text,
                replacementText: revisionRequest.trimmingCharacters(in: .whitespacesAndNewlines),
                resolution: nil
            )
        case .remove:
            return StoryRevisionOperation(
                type: "remove",
                targetType: selectedFactTarget == nil ? "section" : "fact",
                targetId: selectedFactTarget?.id,
                targetText: selectedFactTarget?.text,
                replacementText: nil,
                resolution: nil
            )
        case .resolveConflict:
            return StoryRevisionOperation(
                type: "resolve_conflict",
                targetType: "conflict",
                targetId: selectedConflictTarget?.id,
                targetText: selectedConflictTarget?.summary,
                replacementText: nil,
                resolution: revisionRequest.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
    }

    // MARK: - Actions

    private func clearRevisionDraft() {
        revisionRequest = ""
        engine.localReviewDraft = ""
        localRevisionMessage = nil
    }

    private func submitRevision() {
        let trimmed = revisionRequest.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        localRevisionMessage = nil
        engine.localReviewDraft = revisionRequest

        Task {
            do {
                try await engine.reviseFromConfirmation(trimmed, operation: revisionOperation)
                revisionRequest = ""
                engine.localReviewDraft = ""
                if revisionFollowUpQuestion == nil {
                    localRevisionMessage = "Story updated to version \(engine.narrativeVersion)."
                    ToastService.shared.success("Story updated")
                } else {
                    localRevisionMessage = nil
                    ToastService.shared.info("One more detail is needed to apply that change cleanly.")
                }
                onRevisionApplied()
            } catch {
                localRevisionMessage = nil
                let message = engine.error ?? error.localizedDescription
                ToastService.shared.error(message)
            }
        }
    }

}

// MARK: - Final Notes Card

private struct FinalNotesCardView: View {
    var engine: V2StoryEngine

    @State private var finalNotes = ""
    @State private var finalNotesSyncTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Final Notes Before Lock-In")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("These notes will be applied at confirmation time for song or poem creation.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(hex: "#121212"))

                TextEditor(text: $finalNotes)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(minHeight: 90)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .font(DesignTokens.bodyFont(size: 15))

                if finalNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Optional: any final nuance to apply right before we lock the draft for creation.")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary.opacity(0.75))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 18)
                        .allowsHitTesting(false)
                }
            }
            .frame(minHeight: 90)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .onAppear {
            finalNotes = engine.finalNotesDraft
        }
        .onDisappear {
            finalNotesSyncTask?.cancel()
            engine.finalNotesDraft = finalNotes
            engine.schedulePersistence()
        }
        .onChange(of: finalNotes) { _, newValue in
            scheduleFinalNotesSync(newValue)
        }
    }

    private func scheduleFinalNotesSync(_ value: String) {
        finalNotesSyncTask?.cancel()
        finalNotesSyncTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            engine.finalNotesDraft = value
        }
    }
}

// MARK: - Fact Inventory Card

private struct FactInventoryCardView: View {
    var engine: V2StoryEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Draft Facts")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            ForEach(Array(engine.factInventory.prefix(8).enumerated()), id: \.offset) { item in
                let fact = item.element
                VStack(alignment: .leading, spacing: 4) {
                    Text(fact.text)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .textSelection(.enabled)
                    HStack(spacing: 8) {
                        if let beat = fact.beat, !beat.isEmpty {
                            Text(beat.capitalized)
                        }
                        if let status = fact.status, !status.isEmpty {
                            Text(status.capitalized)
                        }
                    }
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(hex: "#121212"))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Conflict Resolution Card

private struct ConflictResolutionCardView: View {
    var engine: V2StoryEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Open Conflicts")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("Resolve these with the editor before continuing if they affect meaning.")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)

            ForEach(engine.openConflicts.prefix(4)) { conflict in
                VStack(alignment: .leading, spacing: 6) {
                    Text(conflict.summary ?? "Conflict")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(hex: "#121212"))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Revision History Card

private struct RevisionHistoryCardView: View {
    var engine: V2StoryEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Revision History")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            ForEach(Array(engine.revisionHistory.suffix(4).reversed())) { entry in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("v\(entry.afterVersion ?? entry.version ?? 0)")
                            .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                            .foregroundStyle(DesignTokens.gold)
                        if let source = entry.source {
                        Text(source.replacing("_", with: " ").capitalized)
                            .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                        }
                        Spacer()
                    }
                    if let summary = entry.summary, !summary.isEmpty {
                        Text(summary)
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .textSelection(.enabled)
                    }
                    if let request = entry.request, !request.isEmpty {
                        Text(request)
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .lineLimit(3)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(hex: "#121212"))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Provenance Card

private struct ProvenanceCardView: View {
    var engine: V2StoryEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Creation Provenance")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Text(provenanceSummary)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
                .textSelection(.enabled)
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var provenanceSummary: String {
        let lifecycle = engine.draftLifecycle.replacing("_", with: " ").capitalized
        let version = engine.storyProvenance?.narrativeVersion ?? engine.narrativeVersion
        if let confirmedVersion = engine.storyProvenance?.confirmedNarrativeVersion {
            return "Current lifecycle: \(lifecycle). Downstream creation will lock story draft v\(version) and the last confirmed draft was v\(confirmedVersion)."
        }
        return "Current lifecycle: \(lifecycle). Downstream creation will use story draft v\(version)."
    }
}

// MARK: - Story Elements Card

private struct StoryElementsCardView: View {
    var engine: V2StoryEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Story Elements")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                Text("\(engine.completionScore)%")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }

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
                .foregroundStyle(DesignTokens.textPrimary)
                .frame(width: 100, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(hex: "#1A1A1A"))
                        .frame(height: 8)

                    RoundedRectangle(cornerRadius: 4)
                        .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold)
                        .frame(width: geo.size.width * beat.strength, height: 8)
                }
            }
            .frame(height: 8)
        }
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
