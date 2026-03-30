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
}
