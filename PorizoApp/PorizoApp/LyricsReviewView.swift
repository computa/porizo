//
//  LyricsReviewView.swift
//  PorizoApp
//
//  Displays generated lyrics for review and approval.
//  Supports section-by-section editing with inline line modifications.
//  Velvet & Gold design system.
//
//  Business logic delegated to LyricsReviewController.
//

import SwiftUI

// DesignTokens are now in DesignTokens.swift

// MARK: - Wrapper for Identifiable section index (avoids retroactive Int conformance)

struct EditingSectionIndex: Identifiable {
    let value: Int
    var id: Int { value }
}

struct LyricsReviewView: View {
    let initialLyrics: Lyrics?
    let highlightTerms: [String]
    let onBack: () -> Void

    @State private var controller: LyricsReviewController

    init(
        apiClient: APIClient,
        trackId: String,
        versionNum: Int,
        storyId: String,
        initialLyrics: Lyrics?,
        highlightTerms: [String],
        onApproved: @escaping () -> Void,
        onBack: @escaping () -> Void
    ) {
        self.initialLyrics = initialLyrics
        self.highlightTerms = highlightTerms
        self.onBack = onBack

        let ctrl = LyricsReviewController(
            apiClient: apiClient,
            trackId: trackId,
            versionNum: versionNum,
            storyId: storyId
        )
        ctrl.onApproved = onApproved
        self._controller = State(initialValue: ctrl)
    }

    var body: some View {
        NavigationStack {
            contentView
                .navigationTitle("Review Lyrics")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Back") {
                            onBack()
                        }
                        .disabled(controller.isSaving || controller.isApproving)  // Disable during save operations
                    }
                }
        }
        .alert("Error", isPresented: $controller.showingError) {
            Button("OK") { }
        } message: {
            Text(controller.errorMessage)
        }
        .onAppear {
            controller.onAppear(initialLyrics: initialLyrics, highlightTerms: highlightTerms)
        }
        .onDisappear {
            controller.onDisappear()
        }
        .sheet(item: $controller.editingSection) { sectionIndexWrapper in
            SectionEditSheet(
                sectionName: controller.lyrics?.sections[sectionIndexWrapper.value].name ?? "",
                lines: $controller.editedLines,
                onSave: {
                    controller.saveEditedSection(at: sectionIndexWrapper.value)
                },
                onCancel: {
                    controller.editingSection = nil
                }
            )
        }
        .sheet(isPresented: $controller.isEditingTitle) {
            TitleEditSheet(
                title: $controller.editedTitle,
                onSave: {
                    controller.saveEditedTitle()
                },
                onCancel: {
                    controller.isEditingTitle = false
                }
            )
        }
    }

    @ViewBuilder
    private var contentView: some View {
        if controller.isLoading || controller.isGenerating {
            loadingView
        } else if controller.isAIUnavailable {
            aiUnavailableView
        } else if controller.isModerationBlocked {
            moderationBlockedView
        } else if let lyrics = controller.lyrics {
            lyricsContentView(lyrics: lyrics)
        } else {
            emptyStateView
        }
    }

    // MARK: - Views

    private var loadingView: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.gold)
                .accessibilityLabel(controller.isGenerating ? "Crafting your lyrics" : "Loading")

            Text(controller.isGenerating ? "Crafting Your Lyrics..." : "Loading...")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            if controller.isGenerating {
                Text("Our AI songwriter is creating personalized lyrics based on your story")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            Spacer()
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 120, height: 120)

                Image(systemName: "music.note.list")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.gold)
                    .accessibilityHidden(true)
            }

            Text("No Lyrics Yet")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            Button {
                controller.generateLyrics()
            } label: {
                HStack {
                    Image(systemName: "wand.and.stars")
                        .accessibilityHidden(true)
                    Text("Generate Lyrics")
                }
                .font(.headline)
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 25))
            }

            Spacer()
        }
    }

    private var aiUnavailableView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.warning.opacity(0.15))
                    .frame(width: 120, height: 120)

                Image(systemName: "sparkles.slash")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.warning)
                    .accessibilityHidden(true)
            }

            Text("AI Temporarily Unavailable")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            Text(controller.aiUnavailableMessage)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                controller.clearAIUnavailableAndRetry()
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                        .accessibilityHidden(true)
                    Text("Try Again")
                }
                .font(.headline)
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 25))
            }

            Spacer()
        }
    }

    // C10: Enhanced moderation view with escalation after repeated failures
    private var moderationBlockedView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.warning.opacity(0.15))
                    .frame(width: 120, height: 120)

                Image(systemName: "exclamationmark.shield.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.warning)
                    .accessibilityHidden(true)
            }

            Text(controller.moderationAttempts >= controller.maxModerationAttempts
                 ? "We Need Your Help"
                 : "Content Review Required")
                .font(.headline)
                .foregroundStyle(DesignTokens.textPrimary)

            VStack(spacing: 8) {
                Text(controller.moderationAttempts >= controller.maxModerationAttempts
                     ? "We're having trouble creating lyrics that meet our guidelines."
                     : "We couldn't generate lyrics for this song.")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)

                if let reason = controller.moderationReason {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(DesignTokens.warning)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(DesignTokens.warning.opacity(0.1))
                        .clipShape(.rect(cornerRadius: 8))
                }
            }
            .padding(.horizontal, 32)

            VStack(spacing: 12) {
                // Standard options
                Text("Try adjusting your message or story details")
                    .font(.caption)
                    .foregroundStyle(DesignTokens.textTertiary)

                Button {
                    onBack()
                } label: {
                    HStack {
                        Image(systemName: "pencil")
                            .accessibilityHidden(true)
                        Text("Edit Story Details")
                    }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(DesignTokens.gold)
                    .clipShape(.rect(cornerRadius: 25))
                }

                if controller.moderationAttempts < controller.maxModerationAttempts {
                    // Show "Try Again" only before escalation threshold
                    Button {
                        controller.clearModerationAndRetry()
                    } label: {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                                .accessibilityHidden(true)
                            Text("Try Again")
                        }
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                    }
                } else {
                    // C10: Escalation options after repeated failures
                    Divider()
                        .padding(.vertical, 8)

                    Text("Need more help?")
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textTertiary)

                    // Contact Support button
                    Button {
                        controller.openSupportEmail()
                    } label: {
                        HStack {
                            Image(systemName: "envelope")
                                .accessibilityHidden(true)
                            Text("Contact Support")
                        }
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(DesignTokens.gold.opacity(0.15))
                        .clipShape(.rect(cornerRadius: 20))
                    }

                    // Content Guidelines link
                    Button {
                        controller.openContentGuidelines()
                    } label: {
                        HStack {
                            Image(systemName: "doc.text")
                                .accessibilityHidden(true)
                            Text("View Content Guidelines")
                        }
                        .font(.caption)
                        .foregroundStyle(DesignTokens.textSecondary)
                    }
                }
            }

            Spacer()
        }
    }

    private func lyricsContentView(lyrics: Lyrics) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 24) {
                // Title with edit button
                HStack(alignment: .top, spacing: 12) {
                    Text(controller.highlightedLine(controller.displayTitle(for: lyrics), baseColor: DesignTokens.textPrimary))
                        .font(.title2)
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        controller.startEditingTitle()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil")
                                .accessibilityHidden(true)
                            Text("Edit")
                        }
                        .font(.caption)
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(DesignTokens.gold.opacity(0.15))
                        .clipShape(.rect(cornerRadius: 16))
                    }
                    .accessibilityLabel("Edit title")
                }
                .padding(.horizontal)

                // Instructions
                Text("Tap Edit on the title or any section to make changes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                if !controller.providerPolicyTerms.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("The music provider rejected parts of these lyrics. We highlighted matching terms below so you can edit and continue.")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.textSecondary)

                        Text(controller.providerPolicyTerms.joined(separator: ", "))
                            .font(.caption)
                            .foregroundStyle(DesignTokens.warning)

                        if !controller.providerPolicySuggestions.isEmpty {
                            Divider()
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Gentle suggestions")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundStyle(DesignTokens.textSecondary)

                                ForEach(Array(controller.providerPolicySuggestions.enumerated()), id: \.offset) { _, suggestion in
                                    Text("• \(suggestion)")
                                        .font(.caption)
                                        .foregroundStyle(DesignTokens.textSecondary)
                                }
                            }
                        }
                    }
                    .padding(12)
                    .background(DesignTokens.warning.opacity(0.12))
                    .clipShape(.rect(cornerRadius: 10))
                    .padding(.horizontal)
                }

                // Sections with edit buttons
                ForEach(Array(lyrics.sections.enumerated()), id: \.offset) { index, section in
                    sectionView(section: section, index: index)
                }

                // Anchor line highlight
                if let anchor = lyrics.anchorLine {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Key Line")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.gold)
                            .textCase(.uppercase)

                        Text(controller.highlightedLine("\"\(anchor)\"", baseColor: DesignTokens.background))
                            .font(.body)
                            .italic()
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(DesignTokens.gold.opacity(0.85))
                            .clipShape(.rect(cornerRadius: 8))
                    }
                    .padding(.horizontal)
                }

                // Unsaved changes indicator
                if controller.hasUnsavedChanges {
                    HStack {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundStyle(.orange)
                        Text("You have unsaved changes")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    .padding(.horizontal)
                }

                // Action buttons
                VStack(spacing: 16) {
                    // Save changes button (if needed)
                    if controller.hasUnsavedChanges {
                        Button {
                            controller.saveLyrics()
                        } label: {
                            HStack {
                                Spacer()
                                if controller.isSaving {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                                        .accessibilityLabel("Saving changes")
                                } else {
                                    Image(systemName: "square.and.arrow.down")
                                        .accessibilityHidden(true)
                                    Text("Save Changes")
                                }
                                Spacer()
                            }
                            .font(.headline)
                            .foregroundStyle(DesignTokens.gold)
                            .padding()
                            .background(DesignTokens.gold.opacity(0.15))
                            .clipShape(.rect(cornerRadius: 12))
                        }
                        .disabled(controller.isSaving)
                        .accessibilityLabel(controller.isSaving ? "Saving changes" : "Save Changes")
                    }

                    // Approve button
                    Button {
                        controller.approveLyrics()
                    } label: {
                        HStack {
                            Spacer()
                            if controller.isApproving {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .accessibilityLabel("Approving lyrics")
                            } else {
                                Image(systemName: "checkmark.circle.fill")
                                    .accessibilityHidden(true)
                                Text("Approve & Create Song")
                            }
                            Spacer()
                        }
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding()
                        .background(controller.isApproving || controller.hasUnsavedChanges ? DesignTokens.textTertiary : DesignTokens.gold)
                        .clipShape(.rect(cornerRadius: 12))
                    }
                    .disabled(controller.isApproving || controller.hasUnsavedChanges)
                    .accessibilityLabel(controller.isApproving ? "Approving lyrics" : "Approve and Create Song")
                    .accessibilityHint(controller.hasUnsavedChanges ? "Save your changes before approving" : "")

                    if controller.hasUnsavedChanges {
                        Text("Save your changes before approving")
                            .font(.caption)
                            .foregroundStyle(DesignTokens.textSecondary)
                    }

                    Button {
                        controller.regenerateLyrics()
                    } label: {
                        HStack {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .accessibilityHidden(true)
                            Text("Try Different Lyrics")
                        }
                        .font(.subheadline)
                        .foregroundStyle(controller.isGenerating || controller.isApproving ? DesignTokens.textTertiary : DesignTokens.textSecondary)
                    }
                    .disabled(controller.isGenerating || controller.isApproving)
                }
                .padding()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical)
        }
        .frame(maxWidth: .infinity)
    }

    private func sectionView(section: LyricsSection, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header with edit button
            HStack {
                Text(formatSectionName(section.name))
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(DesignTokens.gold)
                    .textCase(.uppercase)

                Spacer()

                Button {
                    controller.startEditing(section: index)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "pencil")
                            .accessibilityHidden(true)
                        Text("Edit")
                    }
                    .font(.caption)
                    .foregroundStyle(DesignTokens.gold)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(DesignTokens.gold.opacity(0.15))
                    .clipShape(.rect(cornerRadius: 16))
                }
            }

            // Lines
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(section.lineTexts.enumerated()), id: \.offset) { _, line in
                    Text(controller.highlightedLine(line, baseColor: DesignTokens.textPrimary))
                        .font(.body)
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(DesignTokens.surface)
        )
        .padding(.horizontal)
    }
}

// MARK: - Section Edit Sheet

struct SectionEditSheet: View {
    let sectionName: String
    @Binding var lines: [String]
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 16) {
                    // Instructions
                    Text("Edit each line of the \(formatSectionName(sectionName).lowercased())")
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .padding(.horizontal)

                    // Line editors - using TextEditor for full visibility
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, _ in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Line \(index + 1)")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundStyle(DesignTokens.textSecondary)

                                Spacer()

                                Button {
                                    lines.remove(at: index)
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.caption)
                                        .foregroundStyle(DesignTokens.error)
                                        .accessibilityHidden(true)
                                }
                                .accessibilityLabel("Delete line \(index + 1)")
                            }

                            TextEditor(text: $lines[index])
                                .font(.body)
                                .foregroundStyle(DesignTokens.textPrimary)
                                .frame(minHeight: 60)
                                .padding(8)
                                .background(DesignTokens.surface)
                                .clipShape(.rect(cornerRadius: 8))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                                )
                                .scrollContentBackground(.hidden)
                        }
                        .padding(.horizontal)
                    }

                    // Add line button
                    Button {
                        lines.append("")
                    } label: {
                        HStack {
                            Image(systemName: "plus.circle")
                                .accessibilityHidden(true)
                            Text("Add Line")
                        }
                        .font(.body)
                        .foregroundStyle(DesignTokens.gold)
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)

                    Spacer(minLength: 100)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical)
            }
            .frame(maxWidth: .infinity)
            .background(DesignTokens.background)
            .navigationTitle("Edit \(formatSectionName(sectionName))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundStyle(DesignTokens.textSecondary)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        // Remove empty lines before saving
                        lines = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                        onSave()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(DesignTokens.gold)
                }
            }
        }
    }
}

struct TitleEditSheet: View {
    @Binding var title: String
    let onSave: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Update the song title")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .padding(.horizontal)

                TextField("Song title", text: $title)
                    .font(.body)
                    .foregroundStyle(DesignTokens.textPrimary)
                    .padding()
                    .background(DesignTokens.surface)
                    .clipShape(.rect(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                    )
                    .padding(.horizontal)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled(false)

                Spacer()
            }
            .padding(.top)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DesignTokens.background)
            .navigationTitle("Edit Title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundStyle(DesignTokens.textSecondary)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onSave()
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(DesignTokens.gold)
                }
            }
        }
    }
}

#Preview {
    LyricsReviewView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        trackId: "test-track-id",
        versionNum: 1,
        storyId: "story_test",
        initialLyrics: nil,
        highlightTerms: [],
        onApproved: { },
        onBack: { }
    )
}
