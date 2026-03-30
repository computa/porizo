//
//  V2StoryEngineGuidanceTests.swift
//  PorizoAppTests
//
//  Regression tests for confirm-time guidance recovery in the V2 story engine.
//

import XCTest
@testable import PorizoApp

@MainActor
final class V2StoryEngineGuidanceTests: XCTestCase {

    func testApplyConfirmGuidance_reopensConversationAndAppendsPrompt() {
        let engine = V2StoryEngine(
            apiClient: APIClient(baseURL: "http://localhost", userId: "test-user"),
            recipientName: "Chioma",
            occasion: "mother's_day",
            style: "afro-soul"
        )
        engine.storyId = "story_123"
        engine.narrative = "Chioma carried the family with courage."
        engine.isComplete = true
        engine.currentResponse = V2EngineResponse(
            sessionId: "story_123",
            action: .confirm,
            question: nil,
            confirmation: "Ready to confirm",
            narrative: "Chioma carried the family with courage.",
            completionScore: 92,
            beats: [],
            userModel: .initial,
            turnCount: 4
        )

        let guidance = StoryGuidanceResponse(
            error: "STORY_NEEDS_INPUT",
            message: "Before I lock this in, tell me one line about how this changed them.",
            recovery: StoryGuidanceRecovery(
                question: "Before I lock this in, tell me one line about how this changed them.",
                suggestions: ["Talk about how they grew"],
                missingBlocks: ["transformation"],
                sessionVersion: 5
            )
        )

        engine.applyConfirmGuidance(guidance)

        XCTAssertFalse(engine.isComplete)
        XCTAssertEqual(engine.currentResponse?.action, .ask)
        XCTAssertEqual(engine.currentResponse?.question, guidance.recovery.question)
        XCTAssertEqual(engine.messages.last?.role, .ai)
        XCTAssertEqual(engine.messages.last?.content, guidance.recovery.question)
        XCTAssertEqual(engine.messages.last?.suggestions ?? [], ["Talk about how they grew"])
    }

    // MARK: - Stale-guidance persistence

    func testPendingGuidanceSessionVersion_survivesV2SessionCodableRoundTrip() throws {
        // Proves: version survives app restart (encode → disk → decode)
        var session = V2Session(recipientName: "Chioma", occasion: "mother's_day")
        session.storyId = "story_123"
        session.pendingGuidanceSessionVersion = 7

        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(V2Session.self, from: data)

        XCTAssertEqual(decoded.pendingGuidanceSessionVersion, 7,
                       "pendingGuidanceSessionVersion must survive JSON round-trip (app restart)")
    }

    func testPendingGuidanceSessionVersion_retainedInDraftStoreSnapshotAndRestore() {
        // Proves: version survives failed /continue (snapshot captures it, restore puts it back)
        var draftStore = StoryDraftStore(recipientName: "Chioma", occasion: "mother's_day")
        draftStore.storyId = "story_123"
        draftStore.pendingGuidanceSessionVersion = 5

        // Snapshot (what schedulePersistence writes to disk)
        let conversationStore = StoryConversationStore()
        let snapshot = draftStore.makeSessionSnapshot(conversation: conversationStore)
        XCTAssertEqual(snapshot.pendingGuidanceSessionVersion, 5,
                       "Snapshot must capture pendingGuidanceSessionVersion")

        // Restore into a fresh store (simulating app relaunch)
        var freshStore = StoryDraftStore(recipientName: "", occasion: "")
        XCTAssertNil(freshStore.pendingGuidanceSessionVersion)
        freshStore.restore(from: snapshot)
        XCTAssertEqual(freshStore.pendingGuidanceSessionVersion, 5,
                       "Restore must recover pendingGuidanceSessionVersion from snapshot")
    }

    // MARK: - Async failure retention (mock sync service)

    func testContinueStory_retainsGuidanceVersionOnFailure() async throws {
        // Proves: pendingGuidanceSessionVersion survives a failed /continue through the real async path.
        let mock = FailingSyncServiceMock(errorToThrow: APIClientError.networkError(underlying: URLError(.notConnectedToInternet)))
        let engine = V2StoryEngine(syncService: mock, recipientName: "Chioma", occasion: "mother's_day", style: "afro-soul")
        engine.storyId = "story_123"
        engine.pendingGuidanceSessionVersion = 9

        do {
            try await engine.continueStory(answer: "She changed everything.")
            XCTFail("Expected continueStory to throw")
        } catch {
            // Expected failure
        }

        XCTAssertEqual(engine.pendingGuidanceSessionVersion, 9,
                       "pendingGuidanceSessionVersion must survive a failed /continue — not cleared in catch block")
    }

    func testContinueStory_clearsGuidanceVersionOnSuccess() async throws {
        // Proves: pendingGuidanceSessionVersion is cleared only after a successful /continue.
        let mock = SucceedingSyncServiceMock()
        let engine = V2StoryEngine(syncService: mock, recipientName: "Chioma", occasion: "mother's_day", style: "afro-soul")
        engine.storyId = "story_123"
        engine.pendingGuidanceSessionVersion = 9

        try await engine.continueStory(answer: "She changed everything.")

        XCTAssertNil(engine.pendingGuidanceSessionVersion,
                     "pendingGuidanceSessionVersion must be cleared after a successful /continue")
    }

    func testContinueStory_autoRetriesOnVersionConflict() async throws {
        // Proves: STORY_VERSION_CONFLICT with a stale expectedSessionVersion auto-retries without it.
        let mock = VersionConflictThenSucceedMock()
        let engine = V2StoryEngine(syncService: mock, recipientName: "Chioma", occasion: "mother's_day", style: "afro-soul")
        engine.storyId = "story_123"
        engine.pendingGuidanceSessionVersion = 5

        try await engine.continueStory(answer: "She changed everything.")

        XCTAssertEqual(mock.callCount, 2, "Should call continueStory twice: first with version (fails), retry without")
        XCTAssertNil(engine.pendingGuidanceSessionVersion, "Version cleared after successful retry")
        XCTAssertNil(mock.lastExpectedVersion, "Retry must send nil expectedSessionVersion")
    }
}

// MARK: - Test doubles

/// Throws the configured error on continueStory; stubs all other methods.
@MainActor
private final class FailingSyncServiceMock: StorySyncServiceProtocol {
    nonisolated init(errorToThrow: Error) { self._errorToThrow = errorToThrow }
    private let _errorToThrow: Error

    func continueStory(storyId: String, answer: String, expectedSessionVersion: Int?) async throws -> ContinueStoryV2Response {
        throw _errorToThrow
    }

    // Stubs — not exercised by these tests
    func startStory(initialPrompt: String, recipientName: String, occasion: String, style: String?) async throws -> StartStoryV2Response { fatalError("not called") }
    func updateStoryStyle(storyId: String, style: String?) async throws -> StoryStyleUpdateResponse { fatalError("not called") }
    func reviseStory(storyId: String, revisionRequest: String, source: String, operation: StoryRevisionOperation?) async throws -> ContinueStoryV2Response { fatalError("not called") }
    func prepareStoryReview(storyId: String) async throws -> ContinueStoryV2Response { fatalError("not called") }
    func getStorySession(storyId: String) async throws -> StorySessionStateResponse { fatalError("not called") }
    func fetchElementGuidance(storyId: String, elementId: String) async throws -> ElementGuidance { fatalError("not called") }
    func loadPersistedSession() -> V2Session? { nil }
    func savePersistedSession(_ session: V2Session) {}
    func clearPersistedSession() {}
}

/// Returns a minimal successful ContinueStoryV2Response.
@MainActor
private final class SucceedingSyncServiceMock: StorySyncServiceProtocol {
    nonisolated init() {}

    func continueStory(storyId: String, answer: String, expectedSessionVersion: Int?) async throws -> ContinueStoryV2Response {
        ContinueStoryV2Response.stubSuccess()
    }

    func startStory(initialPrompt: String, recipientName: String, occasion: String, style: String?) async throws -> StartStoryV2Response { fatalError("not called") }
    func updateStoryStyle(storyId: String, style: String?) async throws -> StoryStyleUpdateResponse { fatalError("not called") }
    func reviseStory(storyId: String, revisionRequest: String, source: String, operation: StoryRevisionOperation?) async throws -> ContinueStoryV2Response { fatalError("not called") }
    func prepareStoryReview(storyId: String) async throws -> ContinueStoryV2Response { fatalError("not called") }
    func getStorySession(storyId: String) async throws -> StorySessionStateResponse { fatalError("not called") }
    func fetchElementGuidance(storyId: String, elementId: String) async throws -> ElementGuidance { fatalError("not called") }
    func loadPersistedSession() -> V2Session? { nil }
    func savePersistedSession(_ session: V2Session) {}
    func clearPersistedSession() {}
}

/// First call throws STORY_VERSION_CONFLICT, second succeeds. Tracks call count and last expectedVersion.
@MainActor
private final class VersionConflictThenSucceedMock: StorySyncServiceProtocol {
    nonisolated init() {}
    var callCount = 0
    var lastExpectedVersion: Int?

    func continueStory(storyId: String, answer: String, expectedSessionVersion: Int?) async throws -> ContinueStoryV2Response {
        callCount += 1
        lastExpectedVersion = expectedSessionVersion
        if callCount == 1 {
            throw APIClientError.serverError(message: "Session was modified by another request. Please retry.", code: "STORY_VERSION_CONFLICT", details: nil)
        }
        return ContinueStoryV2Response.stubSuccess()
    }

    func startStory(initialPrompt: String, recipientName: String, occasion: String, style: String?) async throws -> StartStoryV2Response { fatalError("not called") }
    func updateStoryStyle(storyId: String, style: String?) async throws -> StoryStyleUpdateResponse { fatalError("not called") }
    func reviseStory(storyId: String, revisionRequest: String, source: String, operation: StoryRevisionOperation?) async throws -> ContinueStoryV2Response { fatalError("not called") }
    func prepareStoryReview(storyId: String) async throws -> ContinueStoryV2Response { fatalError("not called") }
    func getStorySession(storyId: String) async throws -> StorySessionStateResponse { fatalError("not called") }
    func fetchElementGuidance(storyId: String, elementId: String) async throws -> ElementGuidance { fatalError("not called") }
    func loadPersistedSession() -> V2Session? { nil }
    func savePersistedSession(_ session: V2Session) {}
    func clearPersistedSession() {}
}

// MARK: - Response stub

private extension ContinueStoryV2Response {
    static func stubSuccess() -> ContinueStoryV2Response {
        ContinueStoryV2Response(
            complete: false,
            nextQuestion: "What happened next?",
            action: "ask",
            progress: nil,
            questionsAsked: 2,
            narrative: nil,
            narrativeVersion: 1,
            integrationDelta: nil,
            storySummary: "A story about Chioma.",
            soulOfStory: nil,
            readyForConfirmation: nil,
            suggestions: nil,
            slotGuidance: nil,
            draftLifecycle: nil,
            factInventory: nil,
            openConflicts: nil,
            revisionHistory: nil,
            draftDiff: nil,
            pendingRevision: nil,
            storyProvenance: nil,
            storyElements: nil,
            readiness: nil,
            revisionRequest: nil
        )
    }
}
