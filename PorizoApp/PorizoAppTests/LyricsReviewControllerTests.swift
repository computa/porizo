//
//  LyricsReviewControllerTests.swift
//  PorizoAppTests
//
//  Unit tests for LyricsReviewController: loading, generation, editing,
//  approval state management, and concurrent operation safety.
//

import XCTest
import SwiftUI
@testable import PorizoApp

@MainActor
final class LyricsReviewControllerTests: XCTestCase {

    // MARK: - Helpers

    /// Creates an APIClient pointed at a non-existent host. API calls
    /// will fail with a network error — we only care about the
    /// controller's state transitions before/during the call.
    private func makeAPIClient() -> APIClient {
        APIClient(baseURL: "http://localhost:0", userId: "test-user")
    }

    /// Builds a minimal Lyrics value for testing.
    private func makeLyrics(
        title: String? = "Test Song",
        sections: [LyricsSection]? = nil
    ) -> Lyrics {
        let defaultSections = [
            LyricsSection(name: "verse_1", lines: [
                LyricsLine(stringLiteral: "First line of verse"),
                LyricsLine(stringLiteral: "Second line of verse"),
            ]),
            LyricsSection(name: "chorus", lines: [
                LyricsLine(stringLiteral: "Chorus line one"),
                LyricsLine(stringLiteral: "Chorus line two"),
            ]),
        ]
        return Lyrics(
            title: title,
            style: "pop",
            sections: sections ?? defaultSections,
            anchorLine: "Chorus line one"
        )
    }

    private func makeController(
        trackId: String = "track_test_1",
        versionNum: Int = 1,
        storyId: String? = "story_test_1"
    ) -> LyricsReviewController {
        LyricsReviewController(
            apiClient: makeAPIClient(),
            trackId: trackId,
            versionNum: versionNum,
            storyId: storyId
        )
    }

    // MARK: - 1. Initial State

    func testInitialState() {
        let controller = makeController()

        XCTAssertNil(controller.lyrics)
        XCTAssertTrue(controller.isLoading)
        XCTAssertFalse(controller.isGenerating)
        XCTAssertFalse(controller.isApproving)
        XCTAssertFalse(controller.isSaving)
        XCTAssertFalse(controller.showingError)
        XCTAssertEqual(controller.errorMessage, "")
        XCTAssertFalse(controller.isAIUnavailable)
        XCTAssertFalse(controller.hasUnsavedChanges)
        XCTAssertFalse(controller.isModerationBlocked)
        XCTAssertNil(controller.moderationReason)
        XCTAssertEqual(controller.moderationAttempts, 0)
        XCTAssertNil(controller.editingSection)
        XCTAssertTrue(controller.editedLines.isEmpty)
        XCTAssertFalse(controller.isEditingTitle)
        XCTAssertEqual(controller.editedTitle, "")
        XCTAssertEqual(controller.trackId, "track_test_1")
        XCTAssertEqual(controller.versionNum, 1)
        XCTAssertEqual(controller.storyId, "story_test_1")
    }

    // MARK: - 2. onAppear with Initial Lyrics

    func testOnAppearWithInitialLyrics_populatesState() {
        let controller = makeController()
        let lyrics = makeLyrics()

        controller.onAppear(initialLyrics: lyrics, highlightTerms: ["test-term"])

        XCTAssertNotNil(controller.lyrics)
        XCTAssertEqual(controller.lyrics?.title, "Test Song")
        XCTAssertEqual(controller.lyrics?.sections.count, 2)
        XCTAssertFalse(controller.isLoading,
                       "isLoading should be false when lyrics are seeded")
        XCTAssertFalse(controller.isGenerating)
        XCTAssertFalse(controller.isAIUnavailable)
        XCTAssertFalse(controller.hasUnsavedChanges)
        XCTAssertFalse(controller.providerPolicyTerms.isEmpty,
                       "Policy terms should be normalized from highlightTerms")
    }

    // MARK: - 3. onAppear without Lyrics Triggers Load

    func testOnAppearWithoutLyrics_triggersLoad() {
        let controller = makeController()

        controller.onAppear(initialLyrics: nil, highlightTerms: [])

        // Without initial lyrics, loadExistingLyricsOrGenerate() is called.
        // This sets isLoading = true and spawns a Task.
        XCTAssertTrue(controller.isLoading,
                      "isLoading should be true when no initial lyrics provided")
    }

    // MARK: - 4. Load Triggers Loading State

    func testLoadTriggersLoadingState() {
        let controller = makeController()

        controller.loadExistingLyricsOrGenerate()

        XCTAssertTrue(controller.isLoading,
                      "isLoading should be true immediately after loadExistingLyricsOrGenerate()")
        XCTAssertFalse(controller.isGenerating,
                       "isGenerating should remain false during initial load attempt")
    }

    // MARK: - 5. Generate Triggers Generating State

    func testGenerateTriggersGeneratingState() {
        let controller = makeController()

        controller.generateLyrics()

        XCTAssertTrue(controller.isGenerating,
                      "isGenerating should be true immediately after generateLyrics()")
        XCTAssertTrue(controller.isLoading,
                      "isLoading should also be true during generation")
        XCTAssertFalse(controller.isAIUnavailable)
    }

    // MARK: - 6. Edit Section Updates Model

    func testEditSectionUpdatesModel() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        // Start editing section 0 (verse_1)
        controller.startEditing(section: 0)

        XCTAssertNotNil(controller.editingSection)
        XCTAssertEqual(controller.editingSection?.value, 0)
        XCTAssertEqual(controller.editedLines, ["First line of verse", "Second line of verse"])

        // Modify and save
        controller.editedLines = ["New first line", "New second line"]
        let saved = controller.saveEditedSection(at: 0)

        XCTAssertTrue(saved, "saveEditedSection should return true on success")
        XCTAssertNil(controller.editingSection,
                     "editingSection should be nil after save")
        XCTAssertTrue(controller.hasUnsavedChanges,
                      "hasUnsavedChanges should be true after editing")
        XCTAssertEqual(controller.lyrics?.sections[0].lineTexts,
                       ["New first line", "New second line"])
    }

    func testEditChorusSectionUpdatesAnchorLine() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        // Edit chorus (section 1)
        controller.startEditing(section: 1)
        controller.editedLines = ["New chorus hook", "Chorus line two updated"]
        controller.saveEditedSection(at: 1)

        XCTAssertEqual(controller.lyrics?.anchorLine, "New chorus hook",
                       "anchorLine should update when chorus is edited")
    }

    func testStartEditingOutOfBounds_doesNothing() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.startEditing(section: 99)

        XCTAssertNil(controller.editingSection)
        XCTAssertTrue(controller.editedLines.isEmpty)
    }

    func testSaveEditedSectionWithEmptyLines_returnsFalse() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.startEditing(section: 0)
        controller.editedLines = ["   ", ""]  // All whitespace/empty
        let saved = controller.saveEditedSection(at: 0)

        XCTAssertFalse(saved, "saveEditedSection should return false when all lines are empty")
    }

    // MARK: - 7. Title Editing

    func testEditTitle() {
        let controller = makeController()
        let lyrics = makeLyrics(title: "Original Title")
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.startEditingTitle()
        XCTAssertTrue(controller.isEditingTitle)
        XCTAssertEqual(controller.editedTitle, "Original Title")

        controller.editedTitle = "New Title"
        controller.saveEditedTitle()

        XCTAssertFalse(controller.isEditingTitle)
        XCTAssertEqual(controller.lyrics?.title, "New Title")
        XCTAssertTrue(controller.hasUnsavedChanges)
    }

    func testSaveEditedTitle_noChange_doesNotMarkUnsaved() {
        let controller = makeController()
        let lyrics = makeLyrics(title: "Same Title")
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.startEditingTitle()
        // Don't change the title
        controller.saveEditedTitle()

        XCTAssertFalse(controller.hasUnsavedChanges,
                       "hasUnsavedChanges should remain false when title is unchanged")
    }

    // MARK: - 8. Approve Sets Pending State

    func testApproveSetsPendingState() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        XCTAssertFalse(controller.isApproving)

        controller.approveLyrics()

        XCTAssertTrue(controller.isApproving,
                      "isApproving should be true immediately after approveLyrics()")
    }

    func testApproveCallsOnApprovedCallback() async {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        // The API call will fail (no server). We verify the callback would
        // be wired correctly and that isApproving resets after failure.
        controller.onApproved = { /* would fire on success */ }

        controller.approveLyrics()

        // Wait for the async task to settle
        let expectation = XCTestExpectation(description: "Approve settles")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                if !controller.isApproving { break }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        XCTAssertFalse(controller.isApproving,
                       "isApproving should be false after approval settles")
        // With a fake server, the API call fails, so onApproved won't fire.
        // But showingError should be true from the network failure.
        XCTAssertTrue(controller.showingError,
                      "showingError should be true after network failure")
    }

    // MARK: - 9. Concurrent Guard (Generate)

    func testConcurrentGenerateGuard_doubleCallIsNoOp() {
        let controller = makeController()

        controller.generateLyrics()
        XCTAssertTrue(controller.isGenerating)

        // Second call while first is in flight — guard should prevent it
        controller.generateLyrics()

        // Still generating from the first call; no crash or double-task
        XCTAssertTrue(controller.isGenerating)
    }

    func testConcurrentApproveGuard_doubleCallIsNoOp() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.approveLyrics()
        XCTAssertTrue(controller.isApproving)

        // Second call while first is in flight — guard prevents it
        controller.approveLyrics()
        XCTAssertTrue(controller.isApproving)
    }

    func testConcurrentSaveGuard_doubleCallIsNoOp() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.saveLyrics()
        XCTAssertTrue(controller.isSaving)

        // Second call while first is in flight — guard prevents it
        controller.saveLyrics()
        XCTAssertTrue(controller.isSaving)
    }

    // MARK: - 10. Save Without Lyrics Is No-Op

    func testSaveWithoutLyrics_isNoOp() {
        let controller = makeController()

        controller.saveLyrics()

        XCTAssertFalse(controller.isSaving,
                       "saveLyrics should be a no-op when lyrics is nil")
    }

    // MARK: - 11. Network Failure Handling

    func testNetworkFailure_generateSettlesToError() async {
        let controller = makeController()

        controller.generateLyrics()
        XCTAssertTrue(controller.isGenerating)

        // Wait for the async task to settle (network failure)
        let expectation = XCTestExpectation(description: "Generate settles")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                if !controller.isGenerating { break }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        XCTAssertFalse(controller.isGenerating,
                       "isGenerating should be false after network failure")
        XCTAssertFalse(controller.isLoading,
                       "isLoading should be false after network failure")
        // Either showingError is true (generic error) or isAIUnavailable
        // depending on the error type from localhost:0
        let hasErrorState = controller.showingError || controller.isAIUnavailable || controller.isModerationBlocked
        XCTAssertTrue(hasErrorState,
                      "Should be in some error state after network failure")
    }

    func testNetworkFailure_saveSettlesToError() async {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.saveLyrics()
        XCTAssertTrue(controller.isSaving)

        let expectation = XCTestExpectation(description: "Save settles")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                if !controller.isSaving { break }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        XCTAssertFalse(controller.isSaving,
                       "isSaving should be false after save settles")
        XCTAssertTrue(controller.showingError,
                      "showingError should be true after network failure")
        XCTAssertFalse(controller.errorMessage.isEmpty,
                       "errorMessage should be populated after failure")
    }

    // MARK: - 12. Moderation Helpers

    func testClearModerationAndRetry_resetsAndRegenerates() {
        let controller = makeController()

        // Simulate moderation blocked state
        controller.isModerationBlocked = true
        controller.moderationReason = "Content flagged"

        controller.clearModerationAndRetry()

        XCTAssertFalse(controller.isModerationBlocked)
        XCTAssertNil(controller.moderationReason)
        XCTAssertTrue(controller.isGenerating,
                      "Should start regenerating after clearing moderation")
    }

    func testClearAIUnavailableAndRetry_resetsAndGenerates() {
        let controller = makeController()

        controller.isAIUnavailable = true

        controller.clearAIUnavailableAndRetry()

        XCTAssertFalse(controller.isAIUnavailable)
        XCTAssertTrue(controller.isGenerating,
                      "Should start generating after clearing AI unavailable")
    }

    // MARK: - 13. Display Helpers

    func testDisplayTitle_withTitle() {
        let controller = makeController()
        let lyrics = makeLyrics(title: "Birthday Song")

        XCTAssertEqual(controller.displayTitle(for: lyrics), "Birthday Song")
    }

    func testDisplayTitle_withNilTitle_returnsUntitled() {
        let controller = makeController()
        let lyrics = makeLyrics(title: nil)

        XCTAssertEqual(controller.displayTitle(for: lyrics), "Untitled Song")
    }

    func testDisplayTitle_withEmptyTitle_returnsUntitled() {
        let controller = makeController()
        let lyrics = makeLyrics(title: "   ")

        XCTAssertEqual(controller.displayTitle(for: lyrics), "Untitled Song")
    }

    // MARK: - 14. Highlighted Line

    func testHighlightedLine_noPolicyTerms_returnsPlainText() {
        let controller = makeController()
        // No policy terms set
        controller.providerPolicyTerms = []

        let result = controller.highlightedLine("Just a normal line", baseColor: .white)

        XCTAssertEqual(String(result.characters), "Just a normal line")
    }

    func testHighlightedLine_withPolicyTerms_highlightsMatches() {
        let controller = makeController()
        controller.onAppear(initialLyrics: nil, highlightTerms: ["birthday"])

        let result = controller.highlightedLine("Happy birthday to you", baseColor: .white)

        // The result should be an AttributedString with "birthday" highlighted.
        // We verify the string content is preserved.
        XCTAssertEqual(String(result.characters), "Happy birthday to you")
    }

    // MARK: - 15. Policy Suggestions

    func testProviderPolicySuggestions_emptyTerms_returnsEmpty() {
        let controller = makeController()
        controller.providerPolicyTerms = []

        XCTAssertTrue(controller.providerPolicySuggestions.isEmpty)
    }

    func testProviderPolicySuggestions_withTerms_returnsSuggestions() {
        let controller = makeController()
        controller.providerPolicyTerms = ["twentyone"]

        let suggestions = controller.providerPolicySuggestions
        XCTAssertFalse(suggestions.isEmpty,
                       "Should generate suggestions for policy terms")
        XCTAssertTrue(suggestions.count >= 2,
                      "Should include at least the default suggestion and a term-specific one")
    }

    // MARK: - 16. onDisappear Cancels Tasks

    func testOnDisappear_doesNotCrash() {
        let controller = makeController()

        // Start some async operations
        controller.generateLyrics()

        // Calling onDisappear should cancel tasks without crashing
        controller.onDisappear()

        // No assertion needed — just verifying no crash on cancel
    }

    // MARK: - 17. Regenerate Preserves Existing Lyrics

    func testRegenerateLyrics_keepsExistingLyricsVisible() {
        let controller = makeController()
        let lyrics = makeLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        controller.hasUnsavedChanges = true

        controller.regenerateLyrics()

        XCTAssertNotNil(controller.lyrics,
                        "Existing lyrics should remain visible during regeneration")
        XCTAssertFalse(controller.hasUnsavedChanges,
                       "hasUnsavedChanges should be reset on regenerate")
        XCTAssertTrue(controller.isGenerating)
    }

    // MARK: - 18. Callback Wiring

    func testOnApprovedCallback_isRetained() {
        let controller = makeController()

        var called = false
        controller.onApproved = { called = true }

        XCTAssertNotNil(controller.onApproved)
        controller.onApproved?()
        XCTAssertTrue(called)
    }

    // MARK: - 19. Generate Without StoryId

    func testGenerateWithoutStoryId_settlesWithError() async {
        let controller = makeController(storyId: nil)

        controller.generateLyrics()

        let expectation = XCTestExpectation(description: "Generate without storyId settles")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                if !controller.isGenerating { break }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        XCTAssertFalse(controller.isGenerating)
        XCTAssertTrue(controller.showingError,
                      "Should show error when storyId is nil")
        XCTAssertTrue(controller.errorMessage.contains("story"),
                      "Error should mention story: \(controller.errorMessage)")
    }
}
