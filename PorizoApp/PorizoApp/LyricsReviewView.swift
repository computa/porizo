//
//  LyricsReviewView.swift
//  PorizoApp
//
//  Displays generated lyrics for review and approval.
//  Supports section-by-section editing with inline line modifications.
//  Light mode design with rose accents.
//

import SwiftUI

// DesignTokens are now in DesignTokens.swift

// MARK: - Wrapper for Identifiable section index (avoids retroactive Int conformance)

struct EditingSectionIndex: Identifiable {
    let value: Int
    var id: Int { value }
}

struct LyricsReviewView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let onApproved: () -> Void
    let onBack: () -> Void

    // State
    @State private var lyrics: Lyrics?
    @State private var isLoading = true
    @State private var isGenerating = false
    @State private var isApproving = false
    @State private var isSaving = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var isAIUnavailable = false
    @State private var aiUnavailableMessage = "Our AI songwriter is temporarily unavailable. Please try again soon."
    @State private var hasUnsavedChanges = false

    // Moderation state
    @State private var isModerationBlocked = false
    @State private var moderationReason: String?
    // C10: Track repeated moderation failures for escalation
    @State private var moderationAttempts: Int = 0
    private let maxModerationAttempts = 2

    // Editing state (using wrapper to avoid retroactive Int: Identifiable)
    @State private var editingSection: EditingSectionIndex?
    @State private var editedLines: [String] = []

    // Task management for proper cancellation
    @State private var generateTask: Task<Void, Never>?
    @State private var saveTask: Task<Void, Never>?
    @State private var approveTask: Task<Void, Never>?

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
                        .disabled(isSaving || isApproving)  // Disable during save operations
                    }
                }
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            generateLyrics()
        }
        .onDisappear {
            // Cancel any running tasks to prevent state updates on deallocated view
            generateTask?.cancel()
            saveTask?.cancel()
            approveTask?.cancel()
        }
        .sheet(item: $editingSection) { sectionIndexWrapper in
            SectionEditSheet(
                sectionName: lyrics?.sections[sectionIndexWrapper.value].name ?? "",
                lines: $editedLines,
                onSave: {
                    saveEditedSection(at: sectionIndexWrapper.value)
                },
                onCancel: {
                    editingSection = nil
                }
            )
        }
    }

    @ViewBuilder
    private var contentView: some View {
        if isLoading || isGenerating {
            loadingView
        } else if isAIUnavailable {
            aiUnavailableView
        } else if isModerationBlocked {
            moderationBlockedView
        } else if let lyrics = lyrics {
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
                .tint(DesignTokens.rose)
                .accessibilityLabel(isGenerating ? "Crafting your lyrics" : "Loading")

            Text(isGenerating ? "Crafting Your Lyrics..." : "Loading...")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            if isGenerating {
                Text("Our AI songwriter is creating personalized lyrics based on your story")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
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
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 120, height: 120)

                Image(systemName: "music.note.list")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.rose)
                    .accessibilityHidden(true)
            }

            Text("No Lyrics Yet")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Button {
                generateLyrics()
            } label: {
                HStack {
                    Image(systemName: "wand.and.stars")
                        .accessibilityHidden(true)
                    Text("Generate Lyrics")
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.rose)
                .cornerRadius(25)
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
                    .foregroundColor(DesignTokens.warning)
                    .accessibilityHidden(true)
            }

            Text("AI Temporarily Unavailable")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text(aiUnavailableMessage)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                isAIUnavailable = false
                generateLyrics()
            } label: {
                HStack {
                    Image(systemName: "arrow.clockwise")
                        .accessibilityHidden(true)
                    Text("Try Again")
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.rose)
                .cornerRadius(25)
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
                    .foregroundColor(DesignTokens.warning)
                    .accessibilityHidden(true)
            }

            Text(moderationAttempts >= maxModerationAttempts
                 ? "We Need Your Help"
                 : "Content Review Required")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            VStack(spacing: 8) {
                Text(moderationAttempts >= maxModerationAttempts
                     ? "We're having trouble creating lyrics that meet our guidelines."
                     : "We couldn't generate lyrics for this song.")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)

                if let reason = moderationReason {
                    Text(reason)
                        .font(.caption)
                        .foregroundColor(DesignTokens.warning)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(DesignTokens.warning.opacity(0.1))
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 32)

            VStack(spacing: 12) {
                // Standard options
                Text("Try adjusting your message or story details")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textTertiary)

                Button {
                    onBack()
                } label: {
                    HStack {
                        Image(systemName: "pencil")
                            .accessibilityHidden(true)
                        Text("Edit Story Details")
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(DesignTokens.rose)
                    .cornerRadius(25)
                }

                if moderationAttempts < maxModerationAttempts {
                    // Show "Try Again" only before escalation threshold
                    Button {
                        isModerationBlocked = false
                        moderationReason = nil
                        regenerateLyrics()
                    } label: {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                                .accessibilityHidden(true)
                            Text("Try Again")
                        }
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                    }
                } else {
                    // C10: Escalation options after repeated failures
                    Divider()
                        .padding(.vertical, 8)

                    Text("Need more help?")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textTertiary)

                    // Contact Support button
                    Button {
                        openSupportEmail()
                    } label: {
                        HStack {
                            Image(systemName: "envelope")
                                .accessibilityHidden(true)
                            Text("Contact Support")
                        }
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.rose)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(DesignTokens.roseMuted)
                        .cornerRadius(20)
                    }

                    // Content Guidelines link
                    Button {
                        openContentGuidelines()
                    } label: {
                        HStack {
                            Image(systemName: "doc.text")
                                .accessibilityHidden(true)
                            Text("View Content Guidelines")
                        }
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                    }
                }
            }

            Spacer()
        }
    }

    // C10: Open support email with context
    private func openSupportEmail() {
        let subject = "Song Creation Help - Content Review"
        let body = """
        Hi Porizo Support,

        I'm having trouble creating a song. The content keeps being flagged for review.

        Track ID: \(trackId)
        Attempts: \(moderationAttempts)
        Last reason: \(moderationReason ?? "Not specified")

        Please help me understand what I can change to create my song.

        Thank you!
        """

        let encodedSubject = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let encodedBody = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""

        if let url = URL(string: "mailto:support@porizo.co?subject=\(encodedSubject)&body=\(encodedBody)") {
            #if os(iOS)
            UIApplication.shared.open(url)
            #endif
        }
    }

    // C10: Open content guidelines (can be a web page or in-app view)
    private func openContentGuidelines() {
        if let url = URL(string: "https://porizo.co/guidelines") {
            #if os(iOS)
            UIApplication.shared.open(url)
            #endif
        }
    }

    private func lyricsContentView(lyrics: Lyrics) -> some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 24) {
                // Title if present
                if let title = lyrics.title {
                    Text(title)
                        .font(.title2)
                        .fontWeight(.bold)
                        .padding(.horizontal)
                }

                // Instructions
                Text("Tap the edit button on any section to make changes")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)

                // Sections with edit buttons
                ForEach(Array(lyrics.sections.enumerated()), id: \.offset) { index, section in
                    sectionView(section: section, index: index)
                }

                // Anchor line highlight
                if let anchor = lyrics.anchorLine {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Key Line")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                            .textCase(.uppercase)

                        Text("\"\(anchor)\"")
                            .font(.body)
                            .italic()
                            .foregroundColor(DesignTokens.textPrimary)
                            .padding()
                            .background(DesignTokens.roseMuted)
                            .cornerRadius(8)
                    }
                    .padding(.horizontal)
                }

                // Unsaved changes indicator
                if hasUnsavedChanges {
                    HStack {
                        Image(systemName: "exclamationmark.circle")
                            .foregroundColor(.orange)
                        Text("You have unsaved changes")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                    .padding(.horizontal)
                }

                // Action buttons
                VStack(spacing: 16) {
                    // Save changes button (if needed)
                    if hasUnsavedChanges {
                        Button {
                            saveLyrics()
                        } label: {
                            HStack {
                                Spacer()
                                if isSaving {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.rose))
                                        .accessibilityLabel("Saving changes")
                                } else {
                                    Image(systemName: "square.and.arrow.down")
                                        .accessibilityHidden(true)
                                    Text("Save Changes")
                                }
                                Spacer()
                            }
                            .font(.headline)
                            .foregroundColor(DesignTokens.rose)
                            .padding()
                            .background(DesignTokens.roseMuted)
                            .cornerRadius(12)
                        }
                        .disabled(isSaving)
                        .accessibilityLabel(isSaving ? "Saving changes" : "Save Changes")
                    }

                    // Approve button
                    Button {
                        approveLyrics()
                    } label: {
                        HStack {
                            Spacer()
                            if isApproving {
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
                        .foregroundColor(.white)
                        .padding()
                        .background(isApproving || hasUnsavedChanges ? DesignTokens.textTertiary : DesignTokens.rose)
                        .cornerRadius(12)
                    }
                    .disabled(isApproving || hasUnsavedChanges)
                    .accessibilityLabel(isApproving ? "Approving lyrics" : "Approve and Create Song")
                    .accessibilityHint(hasUnsavedChanges ? "Save your changes before approving" : "")

                    if hasUnsavedChanges {
                        Text("Save your changes before approving")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                    }

                    Button {
                        regenerateLyrics()
                    } label: {
                        HStack {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .accessibilityHidden(true)
                            Text("Try Different Lyrics")
                        }
                        .font(.subheadline)
                        .foregroundColor(isGenerating || isApproving ? DesignTokens.textTertiary : DesignTokens.textSecondary)
                    }
                    .disabled(isGenerating || isApproving)
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
                    .foregroundColor(DesignTokens.rose)
                    .textCase(.uppercase)

                Spacer()

                Button {
                    startEditing(section: index)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "pencil")
                            .accessibilityHidden(true)
                        Text("Edit")
                    }
                    .font(.caption)
                    .foregroundColor(DesignTokens.rose)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(DesignTokens.roseMuted)
                    .cornerRadius(16)
                }
            }

            // Lines
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(section.lines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.body)
                        .foregroundColor(DesignTokens.textPrimary)
                }
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(DesignTokens.backgroundSubtle)
        )
        .padding(.horizontal)
    }

    // MARK: - Editing

    private func startEditing(section index: Int) {
        guard let lyrics = lyrics, index < lyrics.sections.count else { return }
        editedLines = lyrics.sections[index].lines
        editingSection = EditingSectionIndex(value: index)
    }

    private func saveEditedSection(at index: Int) {
        guard let currentLyrics = lyrics, index < currentLyrics.sections.count else { return }

        // Update the section with edited lines
        var updatedSections = currentLyrics.sections
        updatedSections[index] = LyricsSection(
            name: updatedSections[index].name,
            lines: editedLines
        )

        // Update anchor_line if editing chorus (case-insensitive to handle backend variations)
        var newAnchorLine = currentLyrics.anchorLine
        if updatedSections[index].name.lowercased() == "chorus" && !editedLines.isEmpty {
            newAnchorLine = editedLines[0]
        }

        lyrics = Lyrics(
            title: currentLyrics.title,
            style: currentLyrics.style,
            sections: updatedSections,
            anchorLine: newAnchorLine
        )

        hasUnsavedChanges = true
        editingSection = nil
    }

    // MARK: - Actions

    private func generateLyrics() {
        guard !isGenerating else { return }

        isLoading = true
        isGenerating = true
        isAIUnavailable = false

        generateTask = Task {
            do {
                let response = try await apiClient.generateLyrics(
                    trackId: trackId,
                    versionNum: versionNum
                )

                guard !Task.isCancelled else {
                    await MainActor.run { isLoading = false; isGenerating = false }
                    return
                }

                // Check moderation status by fetching track version
                let trackResponse = try await apiClient.getTrack(trackId: trackId)
                let version = trackResponse.versions.first { $0.versionNum == versionNum }

                guard !Task.isCancelled else {
                    await MainActor.run { isLoading = false; isGenerating = false }
                    return
                }

                await MainActor.run {
                    // Check if content was moderated
                    if version?.moderationStatus == "blocked" {
                        self.isModerationBlocked = true
                        self.moderationReason = version?.moderationReason ?? "Content doesn't meet our guidelines"
                        self.moderationAttempts += 1  // C10: Track failures for escalation
                        self.lyrics = nil
                    } else {
                        self.lyrics = response.lyrics
                        self.isModerationBlocked = false
                        self.moderationReason = nil
                    }
                    self.isAIUnavailable = false
                    self.hasUnsavedChanges = false
                    self.isLoading = false
                    self.isGenerating = false
                }

            } catch {
                guard !Task.isCancelled else {
                    await MainActor.run { isLoading = false; isGenerating = false }
                    return
                }
                await MainActor.run {
                    // Check if error is moderation-related
                    if let apiError = error as? APIClientError,
                       case .aiUnavailable(let message) = apiError {
                        self.isAIUnavailable = true
                        self.aiUnavailableMessage = message ?? self.aiUnavailableMessage
                    } else {
                        let errorString = error.localizedDescription.lowercased()
                        if errorString.contains("moderat") || errorString.contains("blocked") {
                        self.isModerationBlocked = true
                        self.moderationReason = error.localizedDescription
                        self.moderationAttempts += 1  // C10: Track failures for escalation
                        } else {
                            self.errorMessage = error.localizedDescription
                            self.showingError = true
                        }
                    }
                    self.isLoading = false
                    self.isGenerating = false
                }
            }
        }
    }

    private func regenerateLyrics() {
        lyrics = nil
        hasUnsavedChanges = false
        generateLyrics()
    }

    private func saveLyrics() {
        guard let lyrics = lyrics, !isSaving else { return }

        isSaving = true

        saveTask = Task {
            do {
                try await apiClient.updateLyrics(
                    trackId: trackId,
                    versionNum: versionNum,
                    lyrics: lyrics
                )

                guard !Task.isCancelled else {
                    await MainActor.run { isSaving = false }
                    return
                }

                await MainActor.run {
                    hasUnsavedChanges = false
                    isSaving = false
                    ToastService.shared.success("Lyrics saved")
                }

            } catch {
                guard !Task.isCancelled else {
                    await MainActor.run { isSaving = false }
                    return
                }
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isSaving = false
                }
            }
        }
    }

    private func approveLyrics() {
        guard !isApproving else { return }

        isApproving = true

        approveTask = Task {
            do {
                _ = try await apiClient.approveLyrics(
                    trackId: trackId,
                    versionNum: versionNum
                )

                guard !Task.isCancelled else {
                    await MainActor.run { isApproving = false }
                    return
                }

                await MainActor.run {
                    isApproving = false
                    ToastService.shared.success("Lyrics approved!")
                    onApproved()
                }

            } catch {
                guard !Task.isCancelled else {
                    await MainActor.run { isApproving = false }
                    return
                }
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isApproving = false
                }
            }
        }
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
            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 16) {
                    // Instructions
                    Text("Edit each line of the \(formatSectionName(sectionName).lowercased())")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                        .padding(.horizontal)

                    // Line editors - using TextEditor for full visibility
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, _ in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Line \(index + 1)")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundColor(DesignTokens.textSecondary)

                                Spacer()

                                Button {
                                    lines.remove(at: index)
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.caption)
                                        .foregroundColor(DesignTokens.error)
                                        .accessibilityHidden(true)
                                }
                                .accessibilityLabel("Delete line \(index + 1)")
                            }

                            TextEditor(text: $lines[index])
                                .font(.body)
                                .foregroundColor(DesignTokens.textPrimary)
                                .frame(minHeight: 60)
                                .padding(8)
                                .background(DesignTokens.backgroundSubtle)
                                .cornerRadius(8)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(DesignTokens.cardBorder, lineWidth: 1)
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
                        .foregroundColor(DesignTokens.rose)
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
                    .foregroundColor(DesignTokens.textSecondary)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        // Remove empty lines before saving
                        lines = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
                        onSave()
                    }
                    .fontWeight(.semibold)
                    .foregroundColor(DesignTokens.rose)
                }
            }
        }
    }
}

#Preview {
    LyricsReviewView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        trackId: "test-track-id",
        versionNum: 1,
        onApproved: { },
        onBack: { }
    )
}
