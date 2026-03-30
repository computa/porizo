//
//  APIContractTests.swift
//  PorizoAppTests
//
//  Verify iOS models can decode real backend response shapes.
//  When the backend changes a field's type/structure, these tests fail BEFORE shipping.
//

import XCTest
@testable import PorizoApp

final class APIContractTests: XCTestCase {

    private let decoder = JSONDecoder()

    // MARK: - LyricsLine (polymorphic: string OR object)

    func testLyricsLine_decodesPlainString() throws {
        let json = Data(#""Hello world""#.utf8)
        let line = try decoder.decode(LyricsLine.self, from: json)
        XCTAssertEqual(line.text, "Hello world")
        XCTAssertNil(line.startTime)
        XCTAssertNil(line.endTime)
    }

    func testLyricsLine_decodesObjectWithTiming() throws {
        let json = Data(#"{"text":"Gozie, remember","startTime":18.56,"endTime":24.14}"#.utf8)
        let line = try decoder.decode(LyricsLine.self, from: json)
        XCTAssertEqual(line.text, "Gozie, remember")
        XCTAssertEqual(line.startTime, 18.56, accuracy: 0.01)
        XCTAssertEqual(line.endTime, 24.14, accuracy: 0.01)
    }

    func testLyricsLine_decodesObjectWithoutTiming() throws {
        let json = Data(#"{"text":"No timing here"}"#.utf8)
        let line = try decoder.decode(LyricsLine.self, from: json)
        XCTAssertEqual(line.text, "No timing here")
        XCTAssertNil(line.startTime)
    }

    // MARK: - LyricsSection

    func testLyricsSection_decodesMixedLines() throws {
        let json = Data("""
        {
            "name": "verse1",
            "lines": [
                "Plain string line",
                {"text": "Timed line", "startTime": 1.0, "endTime": 3.5}
            ],
            "startTime": 0.5,
            "endTime": 4.0
        }
        """.utf8)
        let section = try decoder.decode(LyricsSection.self, from: json)
        XCTAssertEqual(section.name, "verse1")
        XCTAssertEqual(section.lines.count, 2)
        XCTAssertEqual(section.lines[0].text, "Plain string line")
        XCTAssertNil(section.lines[0].startTime)
        XCTAssertEqual(section.lines[1].text, "Timed line")
        XCTAssertEqual(section.lines[1].startTime, 1.0)
        XCTAssertEqual(section.lineTexts, ["Plain string line", "Timed line"])
    }

    func testLyricsSection_decodesWithoutSectionTiming() throws {
        let json = Data("""
        {"name": "chorus", "lines": ["Line A", "Line B"]}
        """.utf8)
        let section = try decoder.decode(LyricsSection.self, from: json)
        XCTAssertEqual(section.name, "chorus")
        XCTAssertNil(section.startTime)
        XCTAssertEqual(section.lines.count, 2)
    }

    // MARK: - Full Lyrics object

    func testLyrics_decodesWhisperAlignedResponse() throws {
        // Simulates real backend response after Whisper alignment
        let json = Data("""
        {
            "title": "Song for Gozie",
            "style": "highlife",
            "sections": [
                {
                    "name": "verse1",
                    "lines": [
                        {"text": "Gozie, remember the cold", "startTime": 18.5, "endTime": 24.1},
                        {"text": "Empty pockets, dreams in our eyes", "startTime": 24.1, "endTime": 28.0}
                    ],
                    "startTime": 18.5,
                    "endTime": 28.0
                },
                {
                    "name": "chorus",
                    "lines": [
                        {"text": "Look how far you've come", "startTime": 28.5, "endTime": 32.0}
                    ],
                    "startTime": 28.5,
                    "endTime": 32.0
                }
            ],
            "anchor_line": "Look how far you've come"
        }
        """.utf8)
        let lyrics = try decoder.decode(Lyrics.self, from: json)
        XCTAssertEqual(lyrics.title, "Song for Gozie")
        XCTAssertEqual(lyrics.sections.count, 2)
        XCTAssertEqual(lyrics.sections[0].lines[0].startTime, 18.5)
        XCTAssertEqual(lyrics.anchorLine, "Look how far you've come")
    }

    func testLyrics_decodesPreWhisperResponse() throws {
        // Simulates backend response BEFORE Whisper alignment (plain strings)
        let json = Data("""
        {
            "title": "Test Song",
            "style": "pop",
            "sections": [
                {"name": "verse1", "lines": ["Hello world", "Second line"]},
                {"name": "chorus", "lines": ["Chorus line"]}
            ],
            "anchor_line": "Chorus line"
        }
        """.utf8)
        let lyrics = try decoder.decode(Lyrics.self, from: json)
        XCTAssertEqual(lyrics.sections.count, 2)
        XCTAssertEqual(lyrics.sections[0].lines[0].text, "Hello world")
        XCTAssertNil(lyrics.sections[0].lines[0].startTime)
    }

    // MARK: - TrackVersion with embedded lyrics

    func testTrackVersion_decodesWithTimedLyrics() throws {
        let json = Data("""
        {
            "id": "abc-123",
            "track_id": "def-456",
            "version_num": 1,
            "status": "preview_ready",
            "lyrics_json": {
                "title": "Test",
                "style": "soul",
                "sections": [{"name": "v1", "lines": [{"text": "Line", "startTime": 0.5, "endTime": 2.0}]}]
            },
            "created_at": "2026-01-01T00:00:00Z"
        }
        """.utf8)
        let version = try decoder.decode(TrackVersion.self, from: json)
        XCTAssertEqual(version.id, "abc-123")
        XCTAssertEqual(version.lyricsJson?.sections.first?.lines.first?.text, "Line")
        XCTAssertEqual(version.lyricsJson?.sections.first?.lines.first?.startTime, 0.5)
    }

    func testTrackVersion_decodesWithNullLyrics() throws {
        let json = Data("""
        {
            "id": "abc-123",
            "track_id": "def-456",
            "version_num": 1,
            "status": "queued",
            "lyrics_json": null,
            "created_at": "2026-01-01T00:00:00Z"
        }
        """.utf8)
        let version = try decoder.decode(TrackVersion.self, from: json)
        XCTAssertNil(version.lyricsJson)
    }

    // MARK: - Story guidance contract (backwards compatibility)

    /// Proves old iOS APIError decodes the same 422 body without crashing.
    /// Old clients show the `message` as a toast — degraded but functional.
    func testStoryGuidance422_decodesAsAPIError_backwardsCompat() throws {
        let json = Data("""
        {
            "error": "STORY_NEEDS_INPUT",
            "message": "Before I lock this in, tell me one line about how this changed them.",
            "recovery": {
                "question": "Before I lock this in, tell me one line about how this changed them.",
                "suggestions": ["Talk about how they grew"],
                "missing_blocks": ["transformation"],
                "session_version": 5
            }
        }
        """.utf8)

        // Old iOS decodes the same body as APIError — must NOT crash
        let apiError = try decoder.decode(APIError.self, from: json)
        XCTAssertEqual(apiError.error, "STORY_NEEDS_INPUT")
        XCTAssertEqual(apiError.message, "Before I lock this in, tell me one line about how this changed them.")
        // `details` is [String: String]? — the nested `recovery` object is silently ignored
        XCTAssertNil(apiError.details)
    }

    func testStoryGuidanceResponse_decodesConfirmNeedsInputPayload() throws {
        let json = Data("""
        {
            "error": "STORY_NEEDS_INPUT",
            "message": "Before I lock this in, tell me one line about how this changed them.",
            "recovery": {
                "question": "Before I lock this in, tell me one line about how this changed them.",
                "suggestions": ["Talk about how they grew"],
                "missing_blocks": ["transformation"],
                "session_version": 5
            }
        }
        """.utf8)

        let payload = try decoder.decode(StoryGuidanceResponse.self, from: json)
        XCTAssertEqual(payload.error, "STORY_NEEDS_INPUT")
        XCTAssertEqual(payload.message, "Before I lock this in, tell me one line about how this changed them.")
        XCTAssertEqual(payload.recovery.question, "Before I lock this in, tell me one line about how this changed them.")
        XCTAssertEqual(payload.recovery.suggestions, ["Talk about how they grew"])
        XCTAssertEqual(payload.recovery.missingBlocks, ["transformation"])
        XCTAssertEqual(payload.recovery.sessionVersion, 5)
    }
}
