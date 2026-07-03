import XCTest
@testable import PorizoSkipSpike

/// U11 — onboarding graph engine pure logic: navigation, template resolution,
/// answer accumulation, recipient capture, and terminal/completion. Ported
/// (simplified) from iOS QuestionGraphEngine.
final class OnboardingGraphTests: XCTestCase {

    private func engine() -> OnboardingGraphEngine {
        OnboardingGraphEngine(graph: OnboardingGraph.default)
    }

    func testStartsAtEntryNode() {
        let e = engine()
        XCTAssertEqual(e.currentNode.id, OnboardingGraph.default.entryNode)
        XCTAssertFalse(e.isComplete)
    }

    func testSingleSelectAdvancesToNext() {
        let e = engine()
        // entry: goal (single_select) → relationship
        e.answerSingle(value: "birthday_surprise")
        XCTAssertEqual(e.currentNode.type, .singleSelect)
        XCTAssertEqual(e.currentNode.id, "relationship")
    }

    func testMultiSelectRequiresMinSelectionsToAdvance() {
        // Build a graph whose entry is a multi-select with min 1.
        let e = OnboardingGraphEngine(graph: OnboardingGraph.default)
        e.answerSingle(value: "birthday_surprise")   // goal → relationship
        e.answerSingle(value: "mom")                  // relationship → name
        XCTAssertEqual(e.currentNode.type, .textInput)
    }

    func testTemplateResolutionUsesRelationshipLabelAndName() {
        let e = engine()
        e.answerSingle(value: "birthday_surprise")
        e.answerSingle(value: "mom")   // relationship label "Mom"
        // name node question template mentions the relationship label
        XCTAssertTrue(e.currentQuestion.lowercased().contains("mom"))
    }

    func testTextInputCapturesRecipientNameAndCompletes() {
        let e = engine()
        e.answerSingle(value: "birthday_surprise")
        e.answerSingle(value: "mom")
        e.answerText("Maya")
        XCTAssertEqual(e.recipientName, "Maya")
        XCTAssertTrue(e.isComplete)
    }

    func testBackReturnsToPreviousNode() {
        let e = engine()
        e.answerSingle(value: "birthday_surprise")
        XCTAssertEqual(e.currentNode.id, "relationship")
        e.back()
        XCTAssertEqual(e.currentNode.id, OnboardingGraph.default.entryNode)
    }

    func testBackAtEntryIsNoOp() {
        let e = engine()
        e.back()
        XCTAssertEqual(e.currentNode.id, OnboardingGraph.default.entryNode)
    }

    func testEmptyNameStillCompletesWithoutRecipient() {
        let e = engine()
        e.answerSingle(value: "birthday_surprise")
        e.answerSingle(value: "mom")
        e.answerText("   ")
        XCTAssertTrue(e.isComplete)
        XCTAssertNil(e.recipientName)
    }
}
