import XCTest
@testable import PorizoSkipSpike

/// U7 — create-flow entry state machine.
@MainActor
final class CreateFlowTests: XCTestCase {

    func testStartsAtNameStep() {
        let m = AndroidCreateFlowModel()
        XCTAssertEqual(m.moment, .entry(.name))
        XCTAssertFalse(m.canStartConversation, "no name yet")
    }

    func testConfirmNameRequiresAName() {
        let m = AndroidCreateFlowModel()
        m.confirmName()
        XCTAssertEqual(m.moment, .entry(.name), "blank name does not advance")

        m.recipientName = "  "
        m.confirmName()
        XCTAssertEqual(m.moment, .entry(.name), "whitespace-only does not advance")

        m.recipientName = "Sarah"
        m.confirmName()
        XCTAssertEqual(m.moment, .entry(.details))
    }

    func testAdoptContactCapturesNameAndPhoneAndAdvances() {
        let m = AndroidCreateFlowModel()
        m.adoptContact(name: "Sarah", phone: "+14155551234")
        XCTAssertEqual(m.recipientName, "Sarah")
        XCTAssertEqual(m.recipientPhone, "+14155551234")
        XCTAssertEqual(m.moment, .entry(.details))
    }

    func testStartConversationRequiresNameAndAdvancesToConversing() {
        let m = AndroidCreateFlowModel()
        m.startConversation()
        XCTAssertEqual(m.moment, .entry(.name), "cannot start without a name")

        m.recipientName = "Sarah"
        m.confirmName()
        m.startConversation()
        XCTAssertEqual(m.moment, .conversing)
    }

    func testBackToNameReturnsToNameStep() {
        let m = AndroidCreateFlowModel()
        m.recipientName = "Sarah"
        m.confirmName()
        m.backToName()
        XCTAssertEqual(m.moment, .entry(.name))
    }

    func testResetSeedsOccasionAndTypeAndReturnsToName() {
        let m = AndroidCreateFlowModel()
        m.recipientName = "Old"
        m.confirmName()
        m.reset(occasion: .anniversary, type: .poem)
        XCTAssertEqual(m.moment, .entry(.name))
        XCTAssertEqual(m.recipientName, "")
        XCTAssertNil(m.recipientPhone)
        XCTAssertEqual(m.occasion, .anniversary)
        XCTAssertEqual(m.contentType, .poem)
    }

    func testContentTypeLabels() {
        XCTAssertEqual(CreateContentType.song.label, "Song")
        XCTAssertEqual(CreateContentType.poem.label, "Poem")
    }
}
