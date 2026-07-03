import XCTest
@testable import PorizoSkipSpike

/// U8 — story conversation pure logic: transcript building + finish-gating.
final class StoryEngineTests: XCTestCase {

    private func cont(canFinish: Bool? = nil, isComplete: Bool? = nil) -> PorizoContinueStoryResponse {
        PorizoContinueStoryResponse(question: "Anything else?", sessionVersion: 2, canFinish: canFinish, isComplete: isComplete)
    }

    func testAppendAssistantAddsBubble() {
        let msgs = StoryEngine.appendingAssistant("Who is it for?", to: [])
        XCTAssertEqual(msgs.count, 1)
        XCTAssertEqual(msgs[0].role, .assistant)
        XCTAssertEqual(msgs[0].text, "Who is it for?")
    }

    func testAppendAssistantSkipsEmpty() {
        XCTAssertTrue(StoryEngine.appendingAssistant(nil, to: []).isEmpty)
        XCTAssertTrue(StoryEngine.appendingAssistant("   ", to: []).isEmpty)
    }

    func testAppendUserAddsTrimmedBubble() {
        let msgs = StoryEngine.appendingUser("  a memory  ", to: [])
        XCTAssertEqual(msgs.count, 1)
        XCTAssertEqual(msgs[0].role, .user)
        XCTAssertEqual(msgs[0].text, "a memory")
    }

    func testAppendUserSkipsEmpty() {
        XCTAssertTrue(StoryEngine.appendingUser("   ", to: []).isEmpty)
    }

    func testMessageIdsAreStableAndUnique() {
        var msgs = StoryEngine.appendingAssistant("Q1", to: [])
        msgs = StoryEngine.appendingUser("A1", to: msgs)
        msgs = StoryEngine.appendingAssistant("Q2", to: msgs)
        XCTAssertEqual(msgs.map(\.id), ["msg-0", "msg-1", "msg-2"])
    }

    func testCanFinishWhenServerSignals() {
        XCTAssertTrue(StoryEngine.canOfferFinish(response: cont(canFinish: true), userTurns: 0))
        XCTAssertTrue(StoryEngine.canOfferFinish(response: cont(isComplete: true), userTurns: 0))
    }

    func testCanFinishAtTurnFloorEvenWithoutServerSignal() {
        XCTAssertFalse(StoryEngine.canOfferFinish(response: cont(), userTurns: 2))
        XCTAssertTrue(StoryEngine.canOfferFinish(response: cont(), userTurns: 3))
    }

    func testIsSendable() {
        XCTAssertTrue(StoryEngine.isSendable("hi"))
        XCTAssertFalse(StoryEngine.isSendable("   "))
        XCTAssertFalse(StoryEngine.isSendable(""))
    }

    /// Confirm-outcome enum shape is exercised at the API layer (status-code
    /// switch); here we assert the guidance model decodes both fields.
    func testGuidanceModelDecodes() throws {
        let json = Data("{\"message\":\"Tell me more\",\"question\":\"What happened?\"}".utf8)
        let g = try JSONDecoder().decode(PorizoStoryGuidanceResponse.self, from: json)
        XCTAssertEqual(g.message, "Tell me more")
        XCTAssertEqual(g.question, "What happened?")
    }
}
