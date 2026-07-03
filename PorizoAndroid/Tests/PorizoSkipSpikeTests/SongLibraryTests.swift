import XCTest
@testable import PorizoSkipSpike

/// U5 — Songs library pure logic: status mapping, My/Received filter, and
/// building a playable track from a track + its versions. All host-runnable.
final class SongLibraryTests: XCTestCase {

    private func summary(
        id: String = "t1",
        status: String = "ready",
        origin: String? = nil
    ) -> PorizoTrackSummary {
        PorizoTrackSummary(
            id: id, title: "For Sarah", occasion: "Birthday",
            recipientName: "Sarah", status: status, latestVersion: 1,
            shareTokenId: nil, artworkUrl: nil, libraryOrigin: origin,
            canShare: true, canDelete: true
        )
    }

    private func version(num: Int, status: String = "ready", preview: String? = nil, full: String? = nil) -> PorizoTrackVersion {
        PorizoTrackVersion(id: "v\(num)", versionNum: num, status: status, previewUrl: preview, fullUrl: full,
                           previewJobId: nil, fullJobId: nil, lastErrorCode: nil, lastErrorMessage: nil)
    }

    // MARK: status mapping

    func testStatusMappingReadyStates() {
        for s in ["ready", "preview_ready", "full_ready", "completed", "complete"] {
            XCTAssertEqual(SongLibrary.displayStatus(for: s), .ready, "\(s) should be ready")
        }
    }

    func testStatusMappingFailedStates() {
        for s in ["failed", "dead_letter", "blocked"] {
            XCTAssertEqual(SongLibrary.displayStatus(for: s), .failed, "\(s) should be failed")
        }
    }

    func testStatusMappingDraftStates() {
        for s in ["draft", "lyrics_ready", "lyrics_approved", "created"] {
            XCTAssertEqual(SongLibrary.displayStatus(for: s), .draft, "\(s) should be draft")
        }
    }

    func testStatusMappingInFlightDefaultsToCreating() {
        for s in ["queued", "processing", "rendering", "anything_else"] {
            XCTAssertEqual(SongLibrary.displayStatus(for: s), .creating, "\(s) should be creating")
        }
    }

    func testStatusMappingIsCaseInsensitive() {
        XCTAssertEqual(SongLibrary.displayStatus(for: "FAILED"), .failed)
        XCTAssertEqual(SongLibrary.displayStatus(for: "Ready"), .ready)
    }

    func testBadgeLabels() {
        XCTAssertEqual(SongLibrary.badgeLabel(for: .ready), "Ready")
        XCTAssertEqual(SongLibrary.badgeLabel(for: .creating), "Creating")
        XCTAssertEqual(SongLibrary.badgeLabel(for: .draft), "Draft")
        XCTAssertEqual(SongLibrary.badgeLabel(for: .failed), "Failed")
    }

    // MARK: filter

    func testFilterSplitsMineVsReceived() {
        let mine = summary(id: "a", origin: nil)
        let mineExplicit = summary(id: "b", origin: "created")
        let received = summary(id: "c", origin: "received")
        let all = [mine, mineExplicit, received]

        XCTAssertEqual(SongLibrary.filtered(all, by: .mine).map(\.id), ["a", "b"])
        XCTAssertEqual(SongLibrary.filtered(all, by: .received).map(\.id), ["c"])
    }

    func testFilterLabels() {
        XCTAssertEqual(SongLibraryFilter.mine.label, "My Songs")
        XCTAssertEqual(SongLibraryFilter.received.label, "Received")
    }

    // MARK: playable track construction

    func testPlayablePrefersLatestVersionWithURL() {
        let t = summary()
        let versions = [
            version(num: 1, full: "/tracks/t1/v1/full.m4a"),
            version(num: 3, full: "/tracks/t1/v3/full.m4a"),
            version(num: 2, preview: "/tracks/t1/v2/preview.m4a"),
        ]
        let playable = SongLibrary.playableTrack(for: t, versions: versions)
        XCTAssertEqual(playable?.streamURL, "/tracks/t1/v3/full.m4a", "highest version with a URL wins")
        XCTAssertEqual(playable?.id, "t1")
    }

    func testPlayablePrefersFullOverPreviewWithinAVersion() {
        let t = summary()
        let versions = [version(num: 1, preview: "/p.m4a", full: "/f.m4a")]
        XCTAssertEqual(SongLibrary.playableTrack(for: t, versions: versions)?.streamURL, "/f.m4a")
    }

    func testPlayableFallsBackToPreviewWhenNoFull() {
        let t = summary()
        let versions = [version(num: 1, preview: "/p.m4a", full: nil)]
        XCTAssertEqual(SongLibrary.playableTrack(for: t, versions: versions)?.streamURL, "/p.m4a")
    }

    func testPlayableNilWhenNoURLs() {
        let t = summary()
        let versions = [version(num: 1, preview: nil, full: nil)]
        XCTAssertNil(SongLibrary.playableTrack(for: t, versions: versions), "no URL → not playable")
    }

    func testPlayableNilWhenNoVersions() {
        XCTAssertNil(SongLibrary.playableTrack(for: summary(), versions: []))
    }

    func testOwnedContentFlagFollowsOrigin() {
        let owned = SongLibrary.playableTrack(for: summary(origin: nil), versions: [version(num: 1, full: "/f.m4a")])
        XCTAssertEqual(owned?.isOwnedContent, true)
        let received = SongLibrary.playableTrack(for: summary(origin: "received"), versions: [version(num: 1, full: "/f.m4a")])
        XCTAssertEqual(received?.isOwnedContent, false)
    }
}
