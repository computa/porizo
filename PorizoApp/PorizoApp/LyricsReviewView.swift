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
    @State private var hasUnsavedChanges = false

    // Editing state (using wrapper to avoid retroactive Int: Identifiable)
    @State private var editingSection: EditingSectionIndex?
    @State private var editedLines: [String] = []

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
            }

            Text("No Lyrics Yet")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Button {
                generateLyrics()
            } label: {
                HStack {
                    Image(systemName: "wand.and.stars")
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
                                } else {
                                    Image(systemName: "square.and.arrow.down")
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
                            } else {
                                Image(systemName: "checkmark.circle.fill")
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

    private func formatSectionName(_ name: String) -> String {
        // Convert snake_case to Title Case
        name.replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
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

        // Update anchor_line if editing chorus
        var newAnchorLine = currentLyrics.anchorLine
        if updatedSections[index].name == "chorus" && !editedLines.isEmpty {
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

        Task {
            defer {
                isLoading = false
                isGenerating = false
            }

            do {
                let response = try await apiClient.generateLyrics(
                    trackId: trackId,
                    versionNum: versionNum
                )

                await MainActor.run {
                    self.lyrics = response.lyrics
                    self.hasUnsavedChanges = false
                }

            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
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

        Task {
            defer { isSaving = false }

            do {
                try await apiClient.updateLyrics(
                    trackId: trackId,
                    versionNum: versionNum,
                    lyrics: lyrics
                )

                await MainActor.run {
                    hasUnsavedChanges = false
                }

            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            }
        }
    }

    private func approveLyrics() {
        guard !isApproving else { return }

        isApproving = true

        Task {
            defer { isApproving = false }

            do {
                _ = try await apiClient.approveLyrics(
                    trackId: trackId,
                    versionNum: versionNum
                )

                await MainActor.run {
                    onApproved()
                }

            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
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
                                }
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

    private func formatSectionName(_ name: String) -> String {
        name.replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst().lowercased() }
            .joined(separator: " ")
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
