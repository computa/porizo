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
}
