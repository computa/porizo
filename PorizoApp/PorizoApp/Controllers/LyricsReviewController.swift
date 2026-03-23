//
//  LyricsReviewController.swift
//  PorizoApp
//
//  Business logic for lyrics review: loading, generation, editing,
//  moderation, approval, and policy-term highlighting.
//  Extracted from LyricsReviewView to enable reuse and testability.
//

import SwiftUI

@MainActor @Observable
final class LyricsReviewController {

    // MARK: - Dependencies

    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let storyId: String

    // MARK: - Published state

    var lyrics: Lyrics?
    var isLoading = true
    var isGenerating = false
    var isApproving = false
    var isSaving = false
    var showingError = false
    var errorMessage = ""
    var isAIUnavailable = false
    var aiUnavailableMessage = "Our AI songwriter is temporarily unavailable. Please try again soon."
    var hasUnsavedChanges = false
    var providerPolicyTerms: [String] = []

    // Moderation
    var isModerationBlocked = false
    var moderationReason: String?
    var moderationAttempts: Int = 0
    let maxModerationAttempts = 2

    // Editing
    var editingSection: EditingSectionIndex?
    var editedLines: [String] = []
    var isEditingTitle = false
    var editedTitle = ""

    // MARK: - Private

    private var generateTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private var approveTask: Task<Void, Never>?

    // Callbacks set by the view
    var onApproved: (() -> Void)?

    // MARK: - Init

    init(apiClient: APIClient, trackId: String, versionNum: Int, storyId: String) {
        self.apiClient = apiClient
        self.trackId = trackId
        self.versionNum = versionNum
        self.storyId = storyId
    }

    // MARK: - Lifecycle

    /// Call from onAppear. Seeds lyrics if provided, otherwise loads/generates.
    func onAppear(initialLyrics: Lyrics?, highlightTerms: [String]) {
        providerPolicyTerms = normalizedPolicyTerms(highlightTerms)
        if let seededLyrics = initialLyrics {
            lyrics = seededLyrics
            isLoading = false
            isGenerating = false
            isAIUnavailable = false
            hasUnsavedChanges = false
        } else {
            loadExistingLyricsOrGenerate()
        }
    }

    /// Cancel running tasks when the view disappears.
    func onDisappear() {
        generateTask?.cancel()
        saveTask?.cancel()
        approveTask?.cancel()
    }

    // MARK: - Loading & Generation

    func loadExistingLyricsOrGenerate() {
        isLoading = true
        isGenerating = false

        generateTask = Task {
            do {
                let existingLyrics = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadExistingLyrics") {
                    try await self.apiClient.getLyrics(trackId: self.trackId, versionNum: self.versionNum)
                }

                guard !Task.isCancelled else {
                    isLoading = false
                    return
                }

                if let existingLyrics {
                    lyrics = existingLyrics
                    isLoading = false
                    isGenerating = false
                    isAIUnavailable = false
                    hasUnsavedChanges = false
                    return
                }
            } catch {
                guard !Task.isCancelled else {
                    isLoading = false
                    return
                }
                print("[LyricsReviewController] Existing lyrics load failed, falling back to generation: \(error.localizedDescription)")
            }

            guard !Task.isCancelled else {
                isLoading = false
                return
            }

            isLoading = false
            generateLyrics()
        }
    }

    func generateLyrics() {
        guard !isGenerating else { return }

        isLoading = true
        isGenerating = true
        isAIUnavailable = false

        generateTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "generateStoryLyrics") {
                    try await self.apiClient.generateStoryLyrics(storyId: self.storyId)
                }
                try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "updateLyricsAfterGeneration") {
                    try await self.apiClient.updateLyrics(
                        trackId: self.trackId,
                        versionNum: self.versionNum,
                        lyrics: response.lyrics
                    )
                }

                guard !Task.isCancelled else {
                    isLoading = false; isGenerating = false
                    return
                }

                // Check moderation status by fetching track version
                let trackResponse = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getTrackForModerationCheck") {
                    try await self.apiClient.getTrack(trackId: self.trackId)
                }
                let version = trackResponse.versions.first { $0.versionNum == self.versionNum }

                guard !Task.isCancelled else {
                    isLoading = false; isGenerating = false
                    return
                }

                // Check if content was moderated
                if version?.moderationStatus == "blocked" {
                    isModerationBlocked = true
                    moderationReason = version?.moderationReason ?? "Content doesn't meet our guidelines"
                    moderationAttempts += 1
                    lyrics = nil
                } else {
                    lyrics = response.lyrics
                    isModerationBlocked = false
                    moderationReason = nil
                }
                isAIUnavailable = false
                hasUnsavedChanges = false
                isLoading = false
                isGenerating = false

            } catch {
                guard !Task.isCancelled else {
                    isLoading = false; isGenerating = false
                    return
                }
                // Check if error is AI-unavailable or moderation-related
                if let apiError = error as? APIClientError,
                   case .aiUnavailable(let message) = apiError {
                    isAIUnavailable = true
                    aiUnavailableMessage = message ?? aiUnavailableMessage
                } else {
                    let errorString = error.localizedDescription.lowercased()
                    if errorString.contains("moderat") || errorString.contains("blocked") {
                        isModerationBlocked = true
                        moderationReason = error.localizedDescription
                        moderationAttempts += 1
                    } else {
                        errorMessage = error.localizedDescription
                        showingError = true
                    }
                }
                isLoading = false
                isGenerating = false
            }
        }
    }

    func regenerateLyrics() {
        lyrics = nil
        hasUnsavedChanges = false
        generateLyrics()
    }

    // MARK: - Save

    func saveLyrics() {
        guard let lyrics = lyrics, !isSaving else { return }

        isSaving = true

        saveTask = Task {
            do {
                try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "saveLyricsEdits") {
                    try await self.apiClient.updateLyrics(
                        trackId: self.trackId,
                        versionNum: self.versionNum,
                        lyrics: lyrics
                    )
                }

                guard !Task.isCancelled else {
                    isSaving = false
                    return
                }

                hasUnsavedChanges = false
                isSaving = false
                ToastService.shared.success("Lyrics saved")

            } catch {
                guard !Task.isCancelled else {
                    isSaving = false
                    return
                }
                errorMessage = error.localizedDescription
                showingError = true
                isSaving = false
            }
        }
    }

    // MARK: - Approve

    func approveLyrics() {
        guard !isApproving else { return }

        print("[LyricsReviewController] Starting lyrics approval for trackId=\(trackId), versionNum=\(versionNum)")
        isApproving = true

        approveTask = Task {
            do {
                print("[LyricsReviewController] Calling apiClient.approveLyrics...")
                _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "approveLyrics") {
                    try await self.apiClient.approveLyrics(
                        trackId: self.trackId,
                        versionNum: self.versionNum
                    )
                }
                print("[LyricsReviewController] Lyrics approval API call succeeded")

                guard !Task.isCancelled else {
                    isApproving = false
                    return
                }

                isApproving = false
                ToastService.shared.success("Lyrics approved!")
                print("[LyricsReviewController] Calling onApproved callback")
                onApproved?()

            } catch {
                print("[LyricsReviewController] Lyrics approval failed: \(error.localizedDescription)")
                guard !Task.isCancelled else {
                    isApproving = false
                    return
                }
                let extractedPolicyTerms = normalizedPolicyTerms(
                    extractPolicyTerms(from: error.localizedDescription)
                )
                if !extractedPolicyTerms.isEmpty {
                    providerPolicyTerms = normalizedPolicyTerms(
                        providerPolicyTerms + extractedPolicyTerms
                    )
                }
                errorMessage = error.localizedDescription
                showingError = true
                isApproving = false
            }
        }
    }

    // MARK: - Section Editing

    func startEditing(section index: Int) {
        guard let lyrics = lyrics, index < lyrics.sections.count else { return }
        editedLines = lyrics.sections[index].lineTexts
        editingSection = EditingSectionIndex(value: index)
    }

    func startEditingTitle() {
        editedTitle = lyrics?.title ?? ""
        isEditingTitle = true
    }

    func saveEditedTitle() {
        guard let currentLyrics = lyrics else { return }

        let currentTitle = (currentLyrics.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let newTitle = editedTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        isEditingTitle = false

        guard currentTitle != newTitle else { return }

        lyrics = Lyrics(
            title: newTitle.isEmpty ? nil : newTitle,
            style: currentLyrics.style,
            sections: currentLyrics.sections,
            anchorLine: currentLyrics.anchorLine
        )
        hasUnsavedChanges = true
    }

    @discardableResult
    func saveEditedSection(at index: Int) -> Bool {
        guard let currentLyrics = lyrics, index < currentLyrics.sections.count else { return false }

        let trimmedLines = editedLines
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !trimmedLines.isEmpty else { return false }

        var updatedSections = currentLyrics.sections
        updatedSections[index] = LyricsSection(
            name: updatedSections[index].name,
            lines: trimmedLines.map { LyricsLine(stringLiteral: $0) }
        )

        // Update anchor_line if editing chorus
        var newAnchorLine = currentLyrics.anchorLine
        if updatedSections[index].name.lowercased() == "chorus" && !trimmedLines.isEmpty {
            newAnchorLine = trimmedLines[0]
        }

        lyrics = Lyrics(
            title: currentLyrics.title,
            style: currentLyrics.style,
            sections: updatedSections,
            anchorLine: newAnchorLine
        )

        hasUnsavedChanges = true
        editingSection = nil
        return true
    }

    // MARK: - Moderation Helpers

    func clearModerationAndRetry() {
        isModerationBlocked = false
        moderationReason = nil
        regenerateLyrics()
    }

    func clearAIUnavailableAndRetry() {
        isAIUnavailable = false
        generateLyrics()
    }

    // MARK: - Support Actions

    func openSupportEmail() {
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

    func openContentGuidelines() {
        if let url = URL(string: "https://porizo.co/guidelines") {
            #if os(iOS)
            UIApplication.shared.open(url)
            #endif
        }
    }

    // MARK: - Display Helpers

    func displayTitle(for lyrics: Lyrics) -> String {
        let title = lyrics.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? "Untitled Song" : title
    }

    func highlightedLine(_ line: String, baseColor: Color) -> AttributedString {
        var attributed = AttributedString(line)
        attributed.foregroundColor = baseColor
        let variants = providerPolicyTerms
            .flatMap { normalizedPolicyTermVariants($0) }
            .filter { !$0.isEmpty }
            .sorted { $0.count > $1.count }

        guard !variants.isEmpty else {
            return attributed
        }

        for variant in variants {
            var searchRange = line.startIndex..<line.endIndex
            while let range = line.range(
                of: variant,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            ) {
                if let attributedRange = Range(range, in: attributed) {
                    attributed[attributedRange].foregroundColor = DesignTokens.error
                    attributed[attributedRange].backgroundColor = DesignTokens.warning.opacity(0.42)
                }
                searchRange = range.upperBound..<line.endIndex
            }
        }

        return attributed
    }

    var providerPolicySuggestions: [String] {
        guard !providerPolicyTerms.isEmpty else { return [] }

        let sortedTerms = providerPolicyTerms
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted { $0.count > $1.count }

        var suggestions: [String] = [
            "Keep references personal and descriptive instead of named artist or producer tags."
        ]

        for term in sortedTerms.prefix(3) {
            suggestions.append(gentleSuggestion(for: term))
        }

        suggestions.append("After editing highlighted words, tap Save Changes before approving.")

        var unique = Set<String>()
        return suggestions.filter { unique.insert($0).inserted }
    }

    // MARK: - Policy Term Processing (Private)

    private func gentleSuggestion(for term: String) -> String {
        let compact = term.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)

        if let expanded = expandCompactNumberWord(compact) {
            return "Try replacing \"\(term)\" with \"\(expanded.spaced) years old\" when describing age."
        }

        if let numericValue = Int(compact), (1...125).contains(numericValue) {
            return "If \"\(term)\" is an age, rewrite it as \"\(numericValue) years old\"."
        }

        return "Consider replacing \"\(term)\" with a neutral phrase tied to the story (for example, \"special day\" or \"celebration beat\")."
    }

    private func normalizedPolicyTerms(_ terms: [String]) -> [String] {
        var normalized = Set<String>()
        for term in terms {
            for variant in normalizedPolicyTermVariants(term) {
                normalized.insert(variant)
            }
        }
        return Array(normalized).sorted()
    }

    private func normalizedPolicyTermVariants(_ rawTerm: String) -> [String] {
        let term = rawTerm.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !term.isEmpty else { return [] }

        var variants = Set([term])
        let spaced = term.replacingOccurrences(of: "-", with: " ")
        let hyphenated = term.replacingOccurrences(of: #"\s+"#, with: "-", options: .regularExpression)
        variants.insert(spaced)
        variants.insert(hyphenated)
        let compact = term.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
        variants.insert(compact)
        if let expanded = expandCompactNumberWord(compact) {
            variants.insert(expanded.compact)
            variants.insert(expanded.spaced)
            variants.insert(expanded.spaced.replacingOccurrences(of: " ", with: "-"))
            variants.insert(expanded.numeric)
        }
        return Array(variants)
    }

    private func expandCompactNumberWord(_ value: String) -> (compact: String, spaced: String, numeric: String)? {
        let tens: [(String, Int)] = [
            ("twenty", 20), ("thirty", 30), ("forty", 40), ("fifty", 50),
            ("sixty", 60), ("seventy", 70), ("eighty", 80), ("ninety", 90)
        ]
        let ones: [(String, Int)] = [
            ("one", 1), ("two", 2), ("three", 3), ("four", 4), ("five", 5),
            ("six", 6), ("seven", 7), ("eight", 8), ("nine", 9)
        ]

        for (tensWord, tensValue) in tens {
            for (onesWord, onesValue) in ones {
                let compact = "\(tensWord)\(onesWord)"
                if value == compact {
                    return (compact, "\(tensWord) \(onesWord)", "\(tensValue + onesValue)")
                }
            }
        }

        return nil
    }

    private func extractPolicyTerms(from message: String) -> [String] {
        let patterns = [
            #"producer tag\s+([a-z0-9-]+)"#,
            #"lyrics contain(?:s)?\s+([a-z0-9-]+)"#
        ]

        let range = NSRange(message.startIndex..<message.endIndex, in: message)
        var terms = Set<String>()
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }
            let matches = regex.matches(in: message, options: [], range: range)
            for match in matches {
                guard match.numberOfRanges > 1,
                      let termRange = Range(match.range(at: 1), in: message) else {
                    continue
                }
                terms.insert(String(message[termRange]))
            }
        }
        return Array(terms).sorted()
    }
}
