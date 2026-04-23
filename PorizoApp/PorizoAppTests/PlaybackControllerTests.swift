//
//  PlaybackControllerTests.swift
//  PorizoAppTests
//
//  Unit tests for PlaybackController: state management, retry throttle,
//  and playback-finished callback wiring.
//

import XCTest
import AVFoundation
@testable import PorizoApp

@MainActor
final class PlaybackControllerTests: XCTestCase {

    private var controller: PlaybackController!

    override func setUp() {
        super.setUp()
        controller = PlaybackController()
    }

    override func tearDown() {
        controller.cleanup()
        controller = nil
        super.tearDown()
    }

    // MARK: - Play State

    func testPlay_afterSetup_setsIsPlaying() {
        controller.setupPlayer(url: "https://example.com/song.mp3")
        controller.play()

        XCTAssertTrue(controller.isPlaying)
        XCTAssertNil(controller.playbackError)
    }

    func testPlay_withoutSetup_setsError() {
        controller.play()

        XCTAssertFalse(controller.isPlaying)
        XCTAssertEqual(controller.playbackError, "Player not initialised")
    }

    func testPause_setsIsPlayingFalse() {
        controller.setupPlayer(url: "https://example.com/song.mp3")
        controller.play()
        XCTAssertTrue(controller.isPlaying)

        controller.pause()

        XCTAssertFalse(controller.isPlaying)
    }

    func testTogglePlayPause_alternatesState() {
        controller.setupPlayer(url: "https://example.com/song.mp3")

        controller.togglePlayPause()
        XCTAssertTrue(controller.isPlaying, "First toggle should play")

        controller.togglePlayPause()
        XCTAssertFalse(controller.isPlaying, "Second toggle should pause")
    }

    // MARK: - Setup

    func testSetupPlayer_invalidURL_setsError() {
        controller.setupPlayer(url: "")

        XCTAssertEqual(controller.playbackError, "Invalid audio URL")
    }

    func testSetupPlayer_resetsPlaybackPosition() {
        controller.setupPlayer(url: "https://example.com/song.mp3")

        // Setup a second time — should reset position-related state.
        // Note: setupPlayer does NOT reset isPlaying — that is managed
        // separately by play()/pause()/cleanup().
        controller.setupPlayer(url: "https://example.com/other.mp3")

        XCTAssertEqual(controller.currentTime, 0)
        XCTAssertEqual(controller.playbackProgress, 0)
        XCTAssertEqual(controller.duration, 0)
        XCTAssertNil(controller.playbackError)
    }

    // MARK: - Retry Throttle

    func testRetryThrottle_preventsRapidRetry() {
        controller.setupPlayer(url: "https://example.com/song.mp3")

        // First retry proceeds — calls setupPlayer + play internally.
        controller.retryPlayback()
        let stateAfterFirst = controller.isPlaying

        // Second retry immediately — should be throttled.
        // If throttled, setupPlayer is NOT called again, so isPlaying
        // remains whatever the first retry set it to.
        controller.retryPlayback()

        XCTAssertEqual(controller.isPlaying, stateAfterFirst,
                       "Rapid second retry should be throttled with no state change")
    }

    func testRetryThrottle_doesNotResetProgressOnThrottle() {
        controller.setupPlayer(url: "https://example.com/song.mp3")
        controller.retryPlayback() // first retry proceeds

        let progressAfterFirst = controller.playbackProgress

        // Immediate second retry is throttled — should NOT call
        // setupPlayer, so playbackProgress stays unchanged.
        controller.retryPlayback()

        XCTAssertEqual(controller.playbackProgress, progressAfterFirst,
                       "Throttled retry must not reset playback progress")
    }

    func testRetryPlayback_withNoURL_setsError() {
        // Controller has no loadedURL (never called setupPlayer).
        // retryPlayback should set error about missing URL.
        // Note: First retry also sets lastRetryTime, but loadedURL is nil.
        controller.retryPlayback()

        XCTAssertEqual(controller.playbackError, "No audio URL available")
    }

    // MARK: - Playback Finished Callback

    func testOnPlaybackFinished_callbackIsRetained() {
        var callbackCalled = false
        controller.onPlaybackFinished = { callbackCalled = true }

        XCTAssertNotNil(controller.onPlaybackFinished,
                        "Callback should be retained after assignment")

        // Directly invoke to verify the closure works.
        controller.onPlaybackFinished?()
        XCTAssertTrue(callbackCalled)
    }

    func testOnTimeUpdate_callbackIsRetained() {
        var receivedTime: TimeInterval?
        controller.onTimeUpdate = { time in
            receivedTime = time
        }

        XCTAssertNotNil(controller.onTimeUpdate)
        controller.onTimeUpdate?(42.0)
        XCTAssertEqual(receivedTime, 42.0)
    }

    // MARK: - Cleanup

    func testCleanup_resetsAllState() {
        controller.setupPlayer(url: "https://example.com/song.mp3")
        controller.play()
        controller.trackTitle = "Test Song"
        XCTAssertTrue(controller.isPlaying)

        controller.cleanup()

        XCTAssertFalse(controller.isPlaying)
        XCTAssertEqual(controller.currentTime, 0)
        XCTAssertEqual(controller.playbackProgress, 0)
        XCTAssertEqual(controller.duration, 0)
        XCTAssertNil(controller.playbackError)
    }

    // MARK: - SwitchAudio

    func testSwitchAudio_resetsAndLoadsNewURL() {
        controller.setupPlayer(url: "https://example.com/preview.mp3")
        controller.play()
        XCTAssertTrue(controller.isPlaying)

        // Switch to a new URL — should reset and reload.
        // Since the previous state was playing, it should auto-play.
        controller.switchAudio(url: "https://example.com/full.mp3")

        XCTAssertTrue(controller.isPlaying,
                      "switchAudio should auto-play when previously playing")
        XCTAssertEqual(controller.currentTime, 0)
        XCTAssertEqual(controller.playbackProgress, 0)
    }

    func testSwitchAudio_whilePaused_doesNotAutoPlay() {
        controller.setupPlayer(url: "https://example.com/preview.mp3")
        // Don't call play() — stays paused.

        controller.switchAudio(url: "https://example.com/full.mp3")

        XCTAssertFalse(controller.isPlaying,
                       "switchAudio should not auto-play when previously paused")
    }

    // MARK: - Metadata

    func testTrackTitle_canBeSet() {
        controller.trackTitle = "Birthday Song"
        XCTAssertEqual(controller.trackTitle, "Birthday Song")
    }

    func testArtistName_canBeSet() {
        controller.artistName = "Sarah"
        XCTAssertEqual(controller.artistName, "Sarah")
    }
}

final class OnboardingSplashAudioPlanTests: XCTestCase {

    func testAttemptsAutoStartOnFirstAppearWhenSampleURLExists() {
        let plan = OnboardingSplashAudioPlan.resolve(
            sampleURL: "https://api.porizo.co/audio/sample.mp3",
            isAudioPlaying: false
        )
        var startedURL: URL?

        plan.attemptAutoStart { url in
            startedURL = url
        }

        XCTAssertEqual(startedURL?.absoluteString, "https://api.porizo.co/audio/sample.mp3")
        XCTAssertTrue(plan.showsPlayFallback)
    }

    func testDoesNotAttemptAutoStartWithoutPlayableURL() {
        let plan = OnboardingSplashAudioPlan.resolve(
            sampleURL: nil,
            isAudioPlaying: false
        )
        var didStart = false

        plan.attemptAutoStart { _ in
            didStart = true
        }

        XCTAssertFalse(didStart)
        XCTAssertFalse(plan.showsPlayFallback)
    }

    func testDoesNotAutoStartOrShowFallbackWhenAudioAlreadyPlaying() {
        let plan = OnboardingSplashAudioPlan.resolve(
            sampleURL: "https://api.porizo.co/audio/sample.mp3",
            isAudioPlaying: true
        )
        var didStart = false

        plan.attemptAutoStart { _ in
            didStart = true
        }

        XCTAssertFalse(didStart)
        XCTAssertFalse(plan.showsPlayFallback)
    }
}
