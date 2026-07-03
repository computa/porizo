import XCTest
@testable import PorizoSkipSpike

/// Deterministic fake playback engine — no ExoPlayer, no timers.
/// Lets us assert AndroidPlayerModel state transitions on the host.
final class FakePlaybackEngine: AudioPlaybackEngine, @unchecked Sendable {
    var prepareResult: Result<Void, AndroidNativeAdapterError> = .success(())
    private(set) var preparedURL: String?
    private(set) var preparedHeaders: [String: String] = [:]
    private(set) var playCount = 0
    private(set) var pauseCount = 0
    private(set) var lastSeekMs: Int?
    private(set) var releaseCount = 0

    var fakePositionMs = 0
    var fakeDurationMs = 0
    var fakeIsPlaying = false

    func prepare(url: String, headers: [String: String]) -> Result<Void, AndroidNativeAdapterError> {
        preparedURL = url
        preparedHeaders = headers
        return prepareResult
    }
    func play() { playCount += 1; fakeIsPlaying = true }
    func pause() { pauseCount += 1; fakeIsPlaying = false }
    func seek(toMs positionMs: Int) { lastSeekMs = positionMs }
    func release() { releaseCount += 1; fakeIsPlaying = false }
    func currentPositionMs() -> Int { fakePositionMs }
    func durationMs() -> Int { fakeDurationMs }
    func isPlaying() -> Bool { fakeIsPlaying }
}

@MainActor
final class PlayerModelTests: XCTestCase {

    private func track(owned: Bool = true) -> AndroidPlayableTrack {
        AndroidPlayableTrack(
            id: "t1", title: "For Sarah", recipientName: "Sarah",
            artworkURL: nil, streamURL: "/tracks/1/full.m4a", isOwnedContent: owned
        )
    }

    func testPlayLoadsTrackAndShowsMiniPlayer() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        XCTAssertFalse(model.hasTrack)

        model.play(track())

        XCTAssertTrue(model.hasTrack)
        XCTAssertEqual(model.currentTrack?.id, "t1")
        XCTAssertTrue(model.isPlaying)
        XCTAssertEqual(engine.playCount, 1)
    }

    func testOwnedContentSendsBearerHeader() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track(owned: true))
        XCTAssertEqual(engine.preparedHeaders["Authorization"], "Bearer tok")
    }

    func testSharedContentSendsNoHeaders() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track(owned: false))
        XCTAssertTrue(engine.preparedHeaders.isEmpty)
    }

    func testToggleFlipsPlayingAndCallsEngine() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track())
        XCTAssertTrue(model.isPlaying)

        model.toggle()
        XCTAssertFalse(model.isPlaying)
        XCTAssertEqual(engine.pauseCount, 1)

        model.toggle()
        XCTAssertTrue(model.isPlaying)
        XCTAssertEqual(engine.playCount, 2)
    }

    func testToggleNoOpWithoutTrack() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { nil })
        model.toggle()
        XCTAssertEqual(engine.playCount, 0)
        XCTAssertEqual(engine.pauseCount, 0)
    }

    func testSeekMapsFractionToMilliseconds() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track())
        engine.fakeDurationMs = 60_000
        model.refreshFromPlayer()          // pulls duration=60s

        model.seek(toFraction: 0.5)
        XCTAssertEqual(engine.lastSeekMs, 30_000)
    }

    func testSeekIgnoredWhenDurationUnknown() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track())              // duration still 0
        model.seek(toFraction: 0.5)
        XCTAssertNil(engine.lastSeekMs)
    }

    func testProgressFractionClampsAndHandlesZeroDuration() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track())
        XCTAssertEqual(model.progressFraction, 0, "Zero duration → 0 progress, no divide-by-zero")

        engine.fakeDurationMs = 10_000
        engine.fakePositionMs = 5_000
        model.refreshFromPlayer()
        XCTAssertEqual(model.progressFraction, 0.5, accuracy: 0.001)
    }

    func testClearReleasesAndHidesMiniPlayer() {
        let engine = FakePlaybackEngine()
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track())
        model.clear()

        XCTAssertFalse(model.hasTrack)
        XCTAssertFalse(model.isPlaying)
        XCTAssertEqual(engine.releaseCount, 1)
    }

    func testPrepareFailureSurfacesErrorAndDoesNotLoad() {
        let engine = FakePlaybackEngine()
        engine.prepareResult = .failure(.operationFailed("boom"))
        let model = AndroidPlayerModel(player: engine, accessTokenProvider: { "tok" })
        model.play(track())

        XCTAssertFalse(model.hasTrack)
        XCTAssertFalse(model.isPlaying)
        XCTAssertEqual(model.lastError, "boom")
        XCTAssertEqual(engine.playCount, 0)
    }

    func testNowPlayingTimeLabelFormatting() {
        XCTAssertEqual(NowPlayingView.timeLabel(0), "0:00")
        XCTAssertEqual(NowPlayingView.timeLabel(5), "0:05")
        XCTAssertEqual(NowPlayingView.timeLabel(65), "1:05")
        XCTAssertEqual(NowPlayingView.timeLabel(600), "10:00")
        XCTAssertEqual(NowPlayingView.timeLabel(-3), "0:00")
    }
}
