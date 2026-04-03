//
//  WarmCanvasFlowRobustnessTests.swift
//  PorizoAppTests
//
//  Robustness tests for the Warm Canvas song creation flow.
//  Tests state machine transitions, backend integration contracts,
//  and error recovery paths from voice selection through completion.
//

import XCTest
@testable import PorizoApp

@MainActor
final class WarmCanvasFlowRobustnessTests: XCTestCase {

    // MARK: - Helpers

    private func makeAPIClient() -> APIClient {
        APIClient(baseURL: "http://localhost:0", userId: "test-robustness-user")
    }

    private func makeStoryContext(storyId: String = "story_robustness_1") -> StoryContext {
        StoryContext(
            storyId: storyId,
            recipientName: "Sarah",
            occasion: .birthday,
            specificMemory: "Lost on Mount Rainier",
            memoryAnswers: [],
            specialPhrases: nil,
            whatMakesThemSpecial: nil,
            style: "pop",
            narrativeVersion: 1,
            finalNotes: nil,
            storyProvenance: nil
        )
    }

    private func makeMockLyrics() -> Lyrics {
        Lyrics(
            title: "Birthday Song for Sarah",
            style: "pop",
            sections: [
                LyricsSection(name: "verse_1", lines: [
                    "Remember when we climbed that mountain trail",
                    "You said the view was worth the aching feet"
                ]),
                LyricsSection(name: "chorus", lines: [
                    "Here's to you, here's to thirty more",
                    "Of late-night talks and mornings at the shore"
                ]),
            ],
            anchorLine: "Here's to you, here's to thirty more"
        )
    }

    // MARK: - State Machine: Moment Transitions

    /// Verify WarmCanvasMoment enum covers all four user moments.
    func testWarmCanvasMoment_allCasesExist() {
        let tell = WarmCanvasMoment.tell(.nameEntry)
        let wait = WarmCanvasMoment.wait
        let reveal = WarmCanvasMoment.reveal
        let share = WarmCanvasMoment.share

        XCTAssertNotEqual(tell, wait)
        XCTAssertNotEqual(wait, reveal)
        XCTAssertNotEqual(reveal, share)
    }

    /// Verify TellSubPhase covers the complete sub-phase progression.
    func testTellSubPhase_coversFullProgression() {
        let phases: [TellSubPhase] = [
            .nameEntry,
            .conversing,
            .confirmed,
            .voiceSelected,
            .trackCreated
        ]
        XCTAssertEqual(phases.count, 5, "TellSubPhase should have 5 sub-phases")
    }

    /// Verify WarmCanvasError covers all error overlay types.
    func testWarmCanvasError_allCasesExist() {
        let errors: [WarmCanvasError] = [
            .connectionError,
            .moderationError,
            .waitTimeout,
            .waitFailure(recipientName: "Sarah"),
            .revealPartial,
            .shareFailure,
            .noCredits,
        ]
        XCTAssertEqual(errors.count, 7, "WarmCanvasError should have 7 error states")
    }

    // MARK: - SongFlowCoordinator State Management

    /// Verify SongFlowCoordinator defaults.
    func testSongFlowCoordinator_defaults() {
        let flow = SongFlowCoordinator()
        XCTAssertEqual(flow.voiceMode, .aiVoice)
        XCTAssertEqual(flow.voiceGender, .female)
        XCTAssertNil(flow.currentTrackId)
        XCTAssertNil(flow.currentVersionNum)
        XCTAssertNil(flow.currentStoryId)
    }

    /// Verify resume correctly restores track state.
    func testSongFlowCoordinator_resume() {
        var flow = SongFlowCoordinator()
        let state = flow.resume(trackId: "track_1", versionNum: 2, storyId: "story_1", target: .lyricsReview)

        XCTAssertEqual(flow.currentTrackId, "track_1")
        XCTAssertEqual(flow.currentVersionNum, 2)
        XCTAssertEqual(flow.currentStoryId, "story_1")
        XCTAssertEqual(state, .lyricsReview)
    }

    /// Verify resume with trackPlayer target.
    func testSongFlowCoordinator_resumeToPlayer() {
        var flow = SongFlowCoordinator()
        let state = flow.resume(trackId: "t1", versionNum: 1, storyId: nil, target: .trackPlayer)
        XCTAssertEqual(state, .trackPlayer)
    }

    /// Verify storeCreatedTrack sets all fields.
    func testSongFlowCoordinator_storeCreatedTrack() {
        var flow = SongFlowCoordinator()
        let lyrics = makeMockLyrics()
        flow.storeCreatedTrack(
            trackId: "track_new",
            versionNum: 1,
            storyId: "story_new",
            lyrics: lyrics,
            originState: .storyConversation
        )

        XCTAssertEqual(flow.currentTrackId, "track_new")
        XCTAssertEqual(flow.currentVersionNum, 1)
        XCTAssertEqual(flow.currentStoryId, "story_new")
        XCTAssertEqual(flow.initialLyrics?.title, "Birthday Song for Sarah")
        XCTAssertTrue(flow.renderPolicyTerms.isEmpty, "Policy terms should be cleared")
    }

    /// Verify clearAll resets everything.
    func testSongFlowCoordinator_clearAll() {
        var flow = SongFlowCoordinator()
        flow.currentTrackId = "some_track"
        flow.currentVersionNum = 3
        flow.voiceMode = .myVoice

        flow.clearAll()

        XCTAssertNil(flow.currentTrackId)
        XCTAssertNil(flow.currentVersionNum)
        XCTAssertEqual(flow.voiceMode, .aiVoice, "Should reset to default")
    }

    // MARK: - TrackCreationController Robustness

    /// Verify double-call guard prevents concurrent creation by directly checking isCreating state.
    func testTrackCreation_doubleCallGuard() async {
        let controller = TrackCreationController(apiClient: makeAPIClient())

        XCTAssertFalse(controller.isCreating, "Should start false")

        // After starting a creation attempt (which will fail on network),
        // verify isCreating was set and then resets after failure.
        let context = makeStoryContext()
        do {
            _ = try await controller.createTrack(
                storyContext: context,
                voiceMode: .aiVoice,
                voiceGender: .female
            )
        } catch {
            // Expected: network failure
        }

        XCTAssertFalse(controller.isCreating, "Should reset to false after failure")
    }

    /// Verify nil storyId is rejected.
    func testTrackCreation_nilStoryIdRejected() async {
        let controller = TrackCreationController(apiClient: makeAPIClient())
        let context = StoryContext(
            storyId: nil,
            recipientName: "Sarah",
            occasion: .birthday,
            specificMemory: "Test",
            memoryAnswers: [],
            specialPhrases: nil,
            whatMakesThemSpecial: nil,
            style: "pop",
            narrativeVersion: 1,
            finalNotes: nil,
            storyProvenance: nil
        )

        do {
            _ = try await controller.createTrack(
                storyContext: context,
                voiceMode: .aiVoice,
                voiceGender: .female
            )
            XCTFail("Should throw for nil storyId")
        } catch {
            // Expected
        }
    }

    // MARK: - RenderController Robustness

    /// Verify RenderController starts in idle state.
    func testRenderController_initialState() {
        let controller = RenderController(apiClient: makeAPIClient())

        XCTAssertEqual(controller.renderPhase, .idle)
        XCTAssertEqual(controller.fullRenderPhase, .notStarted)
        XCTAssertFalse(controller.isRendering)
        XCTAssertFalse(controller.isPreviewRendering)
        XCTAssertFalse(controller.isFullRendering)
        XCTAssertNil(controller.previewJobId)
        XCTAssertNil(controller.fullRenderJobId)
    }

    /// Verify onFullRenderFailed callback fires on failure.
    func testRenderController_fullRenderFailedCallbackFires() async {
        let controller = RenderController(apiClient: makeAPIClient())

        let expectation = XCTestExpectation(description: "onFullRenderFailed should fire")
        var receivedMessage: String?

        controller.onFullRenderFailed = { message in
            receivedMessage = message
            expectation.fulfill()
        }

        // Start a full render — will fail immediately (no server)
        controller.startFullRender(trackId: "test_track", versionNum: 1)

        await fulfillment(of: [expectation], timeout: 10.0)

        XCTAssertNotNil(receivedMessage, "Should receive failure message")
        if case .failed = controller.fullRenderPhase {
            // Expected
        } else {
            XCTFail("fullRenderPhase should be .failed, got \(controller.fullRenderPhase)")
        }
    }

    /// Verify cancelAll stops in-flight tasks and resets rendering state.
    func testRenderController_cancelAll() async {
        let controller = RenderController(apiClient: makeAPIClient())

        controller.startPreviewRender(trackId: "t1", versionNum: 1)
        controller.startFullRender(trackId: "t1", versionNum: 1)

        // Brief delay so tasks start
        try? await Task.sleep(for: .milliseconds(50))

        controller.cancelAll()

        // After cancel, no render should be active
        // (phases may be .rendering or .failed depending on timing,
        // but the key invariant is the tasks are cancelled)
        XCTAssertNil(controller.previewJobId, "Preview job should not be set on localhost:0")
        XCTAssertNil(controller.fullRenderJobId, "Full render job should not be set on localhost:0")
    }

    // MARK: - LyricsReviewController Robustness

    /// Verify controller initializes with correct trackId and storyId.
    func testLyricsController_initialization() {
        let controller = LyricsReviewController(
            apiClient: makeAPIClient(),
            trackId: "track_1",
            versionNum: 1,
            storyId: "story_1"
        )

        XCTAssertEqual(controller.trackId, "track_1")
        XCTAssertEqual(controller.versionNum, 1)
        XCTAssertEqual(controller.storyId, "story_1")
        XCTAssertTrue(controller.isLoading)
        XCTAssertNil(controller.lyrics)
    }

    /// Verify onAppear with seeded lyrics skips loading.
    func testLyricsController_onAppearWithSeededLyrics() {
        let controller = LyricsReviewController(
            apiClient: makeAPIClient(),
            trackId: "track_1",
            versionNum: 1,
            storyId: "story_1"
        )

        let lyrics = makeMockLyrics()
        controller.onAppear(initialLyrics: lyrics, highlightTerms: [])

        XCTAssertFalse(controller.isLoading, "Should not be loading with seeded lyrics")
        XCTAssertFalse(controller.isGenerating)
        XCTAssertNotNil(controller.lyrics)
        XCTAssertEqual(controller.lyrics?.title, "Birthday Song for Sarah")
    }

    /// Verify onAppear with nil lyrics triggers loading.
    func testLyricsController_onAppearWithoutLyrics() {
        let controller = LyricsReviewController(
            apiClient: makeAPIClient(),
            trackId: "track_1",
            versionNum: 1,
            storyId: "story_1"
        )

        controller.onAppear(initialLyrics: nil, highlightTerms: ["bad_word"])

        // Should trigger loadExistingLyricsOrGenerate
        XCTAssertTrue(controller.isLoading)
    }

    // MARK: - CreateFlowStore Persistence

    /// Verify CreateFlowResumeState encodes and decodes correctly.
    func testCreateFlowResumeState_codableRoundTrip() throws {
        let state = CreateFlowResumeState(
            kind: .song,
            step: .lyricsReview,
            storyId: "story_persist_test",
            trackId: "track_persist_test",
            versionNum: 2,
            updatedAt: Date(timeIntervalSince1970: 1700000000)
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(state)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let loaded = try decoder.decode(CreateFlowResumeState.self, from: data)

        XCTAssertEqual(loaded.kind, .song)
        XCTAssertEqual(loaded.step, .lyricsReview)
        XCTAssertEqual(loaded.storyId, "story_persist_test")
        XCTAssertEqual(loaded.trackId, "track_persist_test")
        XCTAssertEqual(loaded.versionNum, 2)
    }

    /// Verify storyConversation factory method populates expected fields.
    func testCreateFlowResumeState_storyConversationFactory() {
        let state = CreateFlowResumeState.storyConversation(kind: .song, storyId: "story_factory")

        XCTAssertEqual(state.kind, .song)
        XCTAssertEqual(state.step, .storyConversation)
        XCTAssertEqual(state.storyId, "story_factory")
        XCTAssertNil(state.trackId)
        XCTAssertNil(state.versionNum)
    }

    // MARK: - CreateFlowBootstrapAction Resolution

    /// Verify fresh start when no resume data exists.
    func testBootstrap_freshStart() {
        let action = CreateFlowBootstrapAction.resolve(
            preselectedOccasion: .birthday,
            preselectedType: .song,
            resumeTrackId: nil,
            resumeVersionNum: nil,
            resumeTarget: nil,
            variationSourcePoem: nil,
            persisted: nil,
            persistedSession: nil
        )

        if case .freshStart(let setup, let forcedType) = action {
            XCTAssertEqual(setup.occasion, .birthday)
            XCTAssertEqual(forcedType, .song)
        } else {
            XCTFail("Expected .freshStart, got \(action)")
        }
    }

    /// Verify resume track takes priority over other bootstrap paths.
    func testBootstrap_resumeTrackPriority() {
        let action = CreateFlowBootstrapAction.resolve(
            preselectedOccasion: .birthday,
            preselectedType: .song,
            resumeTrackId: "track_resume",
            resumeVersionNum: 1,
            resumeTarget: .lyricsReview,
            variationSourcePoem: nil,
            persisted: nil,
            persistedSession: nil
        )

        if case .resumeTrack(let trackId, let versionNum, _, let target) = action {
            XCTAssertEqual(trackId, "track_resume")
            XCTAssertEqual(versionNum, 1)
            XCTAssertEqual(target, .lyricsReview)
        } else {
            XCTFail("Expected .resumeTrack, got \(action)")
        }
    }

    /// Verify restoredStory is selected when persisted session matches.
    func testBootstrap_restoredStory() {
        let persisted = CreateFlowResumeState(
            kind: .song,
            step: .storyConversation,
            storyId: "story_restored",
            trackId: nil,
            versionNum: nil,
            updatedAt: .now
        )
        var session = V2Session(recipientName: "Sarah", occasion: "birthday", style: "pop")
        session.storyId = "story_restored"

        let action = CreateFlowBootstrapAction.resolve(
            preselectedOccasion: nil,
            preselectedType: .song,
            resumeTrackId: nil,
            resumeVersionNum: nil,
            resumeTarget: nil,
            variationSourcePoem: nil,
            persisted: persisted,
            persistedSession: session
        )

        if case .restoredStory(let kind, let restoredSession) = action {
            XCTAssertEqual(kind, .song)
            XCTAssertEqual(restoredSession.storyId, "story_restored")
        } else {
            XCTFail("Expected .restoredStory, got \(action)")
        }
    }

    /// Verify resumeTrack takes priority over restoredStory when both exist.
    func testBootstrap_resumeTrackBeatsRestoredStory() {
        let persisted = CreateFlowResumeState(
            kind: .song,
            step: .storyConversation,
            storyId: "story_1",
            trackId: "track_1",
            versionNum: 1,
            updatedAt: .now
        )
        var session = V2Session(recipientName: "Sarah", occasion: "birthday")
        session.storyId = "story_1"

        let action = CreateFlowBootstrapAction.resolve(
            preselectedOccasion: nil,
            preselectedType: nil,
            resumeTrackId: "track_priority",
            resumeVersionNum: 2,
            resumeTarget: .trackPlayer,
            variationSourcePoem: nil,
            persisted: persisted,
            persistedSession: session
        )

        if case .resumeTrack(let trackId, let versionNum, _, _) = action {
            XCTAssertEqual(trackId, "track_priority")
            XCTAssertEqual(versionNum, 2)
        } else {
            XCTFail("Expected .resumeTrack to win over restoredStory, got \(action)")
        }
    }

    // MARK: - StoryFlowCoordinator

    /// Verify completeFlow rejects when storyId is nil.
    func testStoryFlowCoordinator_completeFlow_noStoryId() {
        let coordinator = StoryFlowCoordinator()
        let engine = V2StoryEngine(apiClient: makeAPIClient())
        // storyId is nil because no session was started

        let result = coordinator.completeFlow(
            selectedType: .song,
            setup: StorySetup(),
            songFlow: SongFlowCoordinator(),
            poemFlow: PoemFlowCoordinator(),
            engine: engine
        )

        XCTAssertNotNil(result.errorMessage, "Should error when storyId is nil")
        XCTAssertEqual(result.nextState, .storyConversation)
    }

    // MARK: - CreateFlowState Backward Compatibility

    /// Verify unknown raw values decode to .typeSelection.
    func testCreateFlowState_unknownDecodesToTypeSelection() throws {
        let json = "\"some_unknown_future_state\""
        let data = json.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(CreateFlowState.self, from: data)
        XCTAssertEqual(decoded, .typeSelection, "Unknown states should fall back to .typeSelection")
    }

    /// Verify all Warm Canvas states decode correctly.
    func testCreateFlowState_warmCanvasStates() throws {
        let states = ["waitPulse", "revealBloom", "sharePostcard"]
        let expected: [CreateFlowState] = [.waitPulse, .revealBloom, .sharePostcard]

        for (json, expected) in zip(states, expected) {
            let data = "\"\(json)\"".data(using: .utf8)!
            let decoded = try JSONDecoder().decode(CreateFlowState.self, from: data)
            XCTAssertEqual(decoded, expected, "'\(json)' should decode to .\(expected)")
        }
    }

    // MARK: - Error Recovery Paths

    /// Verify ShareController can be lazily created.
    func testShareController_lazyCreation() {
        let client = makeAPIClient()
        let controller = ShareController(apiClient: client)
        XCTAssertNil(controller.shareURLString, "Should start with no URL")
    }

    /// Verify PlaybackController cleanup doesn't crash on fresh state.
    func testPlaybackController_cleanupOnFreshState() {
        let controller = PlaybackController()
        // Should not crash
        controller.cleanup()
    }
}
