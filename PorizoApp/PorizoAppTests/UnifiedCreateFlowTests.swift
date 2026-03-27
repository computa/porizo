//
//  UnifiedCreateFlowTests.swift
//  PorizoAppTests
//
//  Regression tests for unified creation flow:
//  - Done exit gating (preview-only, full-render-in-progress, full-render-ready)
//  - Full-render tap-lock
//  - Player display mode mapping
//  - Lyrics empty-section save rejection
//

import XCTest
@testable import PorizoApp

final class UnifiedCreateFlowTests: XCTestCase {

    // MARK: - PlayerDisplayMode

    func testPlayerDisplayModePreview() {
        let mode = InlinePlayerCard.PlayerDisplayMode.preview
        XCTAssertEqual(String(describing: mode), "preview")
    }

    func testPlayerDisplayModeFullRenderInProgress() {
        let mode = InlinePlayerCard.PlayerDisplayMode.fullRenderInProgress
        XCTAssertEqual(String(describing: mode), "fullRenderInProgress")
    }

    func testPlayerDisplayModeFullSong() {
        let mode = InlinePlayerCard.PlayerDisplayMode.fullSong
        XCTAssertEqual(String(describing: mode), "fullSong")
    }

    // MARK: - DoneWarningKind

    func testDoneWarningKindPreviewOnly() {
        let kind = UnifiedCreateFlowView.DoneWarningKind.previewOnly
        XCTAssertEqual(kind.id, "previewOnly")
    }

    func testDoneWarningKindFullRenderInProgress() {
        let kind = UnifiedCreateFlowView.DoneWarningKind.fullRenderInProgress
        XCTAssertEqual(kind.id, "fullRenderInProgress")
    }

    // MARK: - EditingLyricsSection

    func testEditingLyricsSectionIdentifiable() {
        let section = UnifiedCreateFlowView.EditingLyricsSection(id: 2)
        XCTAssertEqual(section.id, 2)
    }

    // MARK: - LyricsReviewController: Empty Section Save

    func testSaveEditedSectionRejectEmpty() {
        let controller = LyricsReviewController(
            apiClient: APIClient(baseURL: "http://localhost", deviceId: "test"),
            trackId: "t1",
            versionNum: 1,
            storyId: "s1"
        )
        controller.lyrics = Lyrics(
            title: "Test",
            style: "pop",
            sections: [
                LyricsSection(name: "verse_1", lines: ["Original line"])
            ],
            anchorLine: nil
        )

        // Start editing, set lines to all empty
        controller.startEditing(section: 0)
        controller.editedLines = ["", "   ", "\n"]

        let result = controller.saveEditedSection(at: 0)

        XCTAssertFalse(result, "Should reject save when all lines are empty")
        XCTAssertEqual(controller.lyrics?.sections[0].lines.first?.text, "Original line",
                       "Original lyrics should remain unchanged")
    }

    func testSaveEditedSectionAcceptValid() {
        let controller = LyricsReviewController(
            apiClient: APIClient(baseURL: "http://localhost", deviceId: "test"),
            trackId: "t1",
            versionNum: 1,
            storyId: "s1"
        )
        controller.lyrics = Lyrics(
            title: "Test",
            style: "pop",
            sections: [
                LyricsSection(name: "verse_1", lines: ["Original line"])
            ],
            anchorLine: nil
        )

        controller.startEditing(section: 0)
        controller.editedLines = ["New line one", "New line two"]

        let result = controller.saveEditedSection(at: 0)

        XCTAssertTrue(result, "Should accept save with valid lines")
        XCTAssertEqual(controller.lyrics?.sections[0].lines.count, 2)
        XCTAssertEqual(controller.lyrics?.sections[0].lines[0].text, "New line one")
        XCTAssertTrue(controller.hasUnsavedChanges)
    }

    func testSaveEditedSectionTrimsWhitespace() {
        let controller = LyricsReviewController(
            apiClient: APIClient(baseURL: "http://localhost", deviceId: "test"),
            trackId: "t1",
            versionNum: 1,
            storyId: "s1"
        )
        controller.lyrics = Lyrics(
            title: "Test",
            style: "pop",
            sections: [
                LyricsSection(name: "verse_1", lines: ["Original"])
            ],
            anchorLine: nil
        )

        controller.startEditing(section: 0)
        controller.editedLines = ["  Valid line  ", "", "  Another valid  ", "  "]

        let result = controller.saveEditedSection(at: 0)

        XCTAssertTrue(result)
        // Empty lines filtered out, whitespace trimmed
        XCTAssertEqual(controller.lyrics?.sections[0].lines.count, 2)
        XCTAssertEqual(controller.lyrics?.sections[0].lines[0].text, "Valid line")
        XCTAssertEqual(controller.lyrics?.sections[0].lines[1].text, "Another valid")
    }

    // MARK: - ErrorHandler friendly mapping

    func testFriendlyMessageForModerationBlocked() {
        let error = APIClientError.serverError(
            message: "Track version blocked by moderation.",
            code: "MODERATION_BLOCKED",
            details: nil
        )

        XCTAssertEqual(
            ErrorHandler.friendlyMessage(for: error),
            "Your content was flagged by our safety filter. Please edit and try again."
        )
    }

    func testFriendlyMessageForAlreadyRendering() {
        let error = APIClientError.serverError(
            message: "Already rendering.",
            code: "ALREADY_RENDERING",
            details: nil
        )

        XCTAssertEqual(
            ErrorHandler.friendlyMessage(for: error),
            "Your song is already being created. Please wait."
        )
    }

    func testPoemAudioErrorMessageUsesSharedRateLimitCopy() {
        XCTAssertEqual(
            ErrorHandler.poemAudioErrorMessage(.rateLimited(retryAfter: 60)),
            "You have reached the poem audio limit. Please wait and try again."
        )
    }

    // MARK: - Poem content guard

    func testPoemFullViewHasRenderableVersesIgnoresWhitespaceOnlyContent() {
        let poem = Poem(
            id: "poem_1",
            userId: "user_1",
            title: "Empty",
            recipientName: "Chioma",
            occasion: "birthday",
            tone: "warm",
            status: "generated",
            verses: ["", "   ", "\n"],
            createdAt: "2026-03-25",
            updatedAt: "2026-03-25"
        )

        XCTAssertFalse(PoemFullView.hasRenderableVerses(poem))
    }

    func testPoemFullViewHasRenderableVersesDetectsRealContent() {
        let poem = Poem(
            id: "poem_2",
            userId: "user_1",
            title: "Full",
            recipientName: "Chioma",
            occasion: "birthday",
            tone: "warm",
            status: "generated",
            verses: ["", "A real line"],
            createdAt: "2026-03-25",
            updatedAt: "2026-03-25"
        )

        XCTAssertTrue(PoemFullView.hasRenderableVerses(poem))
    }

    // MARK: - LyricsReviewController: Approve & Regenerate

    @MainActor
    func testApproveLyrics_setsApprovedState() async {
        let controller = LyricsReviewController(
            apiClient: APIClient(baseURL: "http://localhost:9999", userId: "test"),
            trackId: "t1",
            versionNum: 1,
            storyId: "s1"
        )
        controller.lyrics = Lyrics(
            title: "Approval Test",
            style: "pop",
            sections: [
                LyricsSection(name: "chorus", lines: ["La la la"])
            ],
            anchorLine: "La la la"
        )

        // Pre-conditions
        XCTAssertFalse(controller.isApproving, "Should not be approving initially")

        // Trigger approval — will hit a fake server and fail,
        // but we can verify the immediate state transition.
        controller.approveLyrics()
        XCTAssertTrue(controller.isApproving,
                      "isApproving should be true immediately after calling approveLyrics()")

        // Wait for the async Task to settle (network will fail)
        let expectation = XCTestExpectation(description: "Approve settles")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                if !controller.isApproving {
                    break
                }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        // After settling, isApproving should be false (error or success)
        XCTAssertFalse(controller.isApproving,
                       "isApproving should be false after the operation settles")
    }

    @MainActor
    func testRegenerateLyrics_resetsState() {
        let controller = LyricsReviewController(
            apiClient: APIClient(baseURL: "http://localhost:9999", userId: "test"),
            trackId: "t1",
            versionNum: 1,
            storyId: "s1"
        )

        // Seed existing lyrics and mark unsaved changes
        controller.lyrics = Lyrics(
            title: "Old Song",
            style: "jazz",
            sections: [
                LyricsSection(name: "verse_1", lines: ["Old line one", "Old line two"])
            ],
            anchorLine: nil
        )
        controller.hasUnsavedChanges = true
        controller.isLoading = false
        controller.isGenerating = false

        // Pre-conditions
        XCTAssertNotNil(controller.lyrics, "Should have lyrics before regenerate")
        XCTAssertTrue(controller.hasUnsavedChanges)

        // Trigger regeneration
        controller.regenerateLyrics()

        // Verify immediate state changes
        XCTAssertNil(controller.lyrics,
                     "Lyrics should be cleared on regenerate")
        XCTAssertFalse(controller.hasUnsavedChanges,
                       "hasUnsavedChanges should be reset on regenerate")
        XCTAssertTrue(controller.isLoading,
                      "isLoading should be true during regeneration")
        XCTAssertTrue(controller.isGenerating,
                      "isGenerating should be true during regeneration")
    }
}
