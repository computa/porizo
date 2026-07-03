import XCTest
@testable import PorizoSkipSpike

/// U6 — Poems library pure logic: My/Received filter, verse preview, and
/// building a playable track from a poem's TTS audio URL.
final class PoemLibraryTests: XCTestCase {

    private func poem(
        id: String = "p1",
        verses: [String] = ["Roses are red", "Violets are blue"],
        origin: String? = nil
    ) -> PorizoPoemSummary {
        PorizoPoemSummary(
            id: id, title: "For Sarah", recipientName: "Sarah",
            occasion: "Birthday", tone: "warm", status: "complete",
            verses: verses, libraryOrigin: origin
        )
    }

    func testFilterSplitsMineVsReceived() {
        let mine = poem(id: "a", origin: nil)
        let received = poem(id: "b", origin: "received")
        let all = [mine, received]
        XCTAssertEqual(PoemLibrary.filtered(all, by: .mine).map(\.id), ["a"])
        XCTAssertEqual(PoemLibrary.filtered(all, by: .received).map(\.id), ["b"])
    }

    func testFilterLabels() {
        XCTAssertEqual(PoemLibraryFilter.mine.label, "My Poems")
        XCTAssertEqual(PoemLibraryFilter.received.label, "Received")
    }

    func testPreviewUsesFirstNonEmptyVerse() {
        XCTAssertEqual(PoemLibrary.preview(for: poem(verses: ["", "  ", "Real line"])), "Real line")
        XCTAssertEqual(PoemLibrary.preview(for: poem(verses: ["First"])), "First")
    }

    func testPreviewFallbackWhenAllEmpty() {
        XCTAssertEqual(PoemLibrary.preview(for: poem(verses: ["", "   "])), "Tap to read")
        XCTAssertEqual(PoemLibrary.preview(for: poem(verses: [])), "Tap to read")
    }

    func testPlayableTrackFromAudioURL() {
        let track = PoemLibrary.playableTrack(for: poem(id: "p9"), audioURL: "/poems/p9/audio")
        XCTAssertEqual(track.id, "p9")
        XCTAssertEqual(track.streamURL, "/poems/p9/audio")
        XCTAssertEqual(track.recipientName, "Sarah")
    }

    func testPlayableOwnedFlagFollowsOrigin() {
        XCTAssertTrue(PoemLibrary.playableTrack(for: poem(origin: nil), audioURL: "/a").isOwnedContent)
        XCTAssertFalse(PoemLibrary.playableTrack(for: poem(origin: "received"), audioURL: "/a").isOwnedContent)
    }
}
