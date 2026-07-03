import XCTest
@testable import PorizoSkipSpike

/// U13 — poem claim + poem create pure logic: poem-share state mapping and the
/// verses shown on reveal.
final class PoemClaimTests: XCTestCase {

    private func info(status: String, canAccess: Bool? = true, pin: Bool? = nil, verses: [String]? = nil) -> PorizoPoemShareInfoResponse {
        PorizoPoemShareInfoResponse(
            status: status, canAccess: canAccess,
            poem: PorizoPoemBody(id: "p1", title: "For Mom", recipientName: "Mom", verses: verses, previewLines: nil),
            requiresPin: pin, requiresPinForClaim: pin
        )
    }

    func testUnboundPoemIsClaimable() {
        XCTAssertEqual(PoemClaimLogic.state(for: info(status: "unbound")), .claimable(needsPin: false))
    }

    func testUnboundWithPinRequiresPin() {
        XCTAssertEqual(PoemClaimLogic.state(for: info(status: "unbound", pin: true)), .claimable(needsPin: true))
    }

    func testClaimedPoem() {
        XCTAssertEqual(PoemClaimLogic.state(for: info(status: "claimed")), .claimed)
    }

    func testRevokedPoemUnavailable() {
        XCTAssertEqual(PoemClaimLogic.state(for: info(status: "revoked")), .unavailable)
    }

    func testVersesFromInfo() {
        let i = info(status: "unbound", verses: ["Line one", "Line two"])
        XCTAssertEqual(PoemClaimLogic.verses(from: i), ["Line one", "Line two"])
    }

    func testVersesFallBackToPreviewLines() {
        let i = PorizoPoemShareInfoResponse(
            status: "unbound", canAccess: true,
            poem: PorizoPoemBody(id: "p", title: "T", recipientName: "R", verses: nil, previewLines: ["Peek one"]),
            requiresPin: nil, requiresPinForClaim: nil
        )
        XCTAssertEqual(PoemClaimLogic.verses(from: i), ["Peek one"])
    }

    func testVersesFromCreatedPoemBody() {
        let poem = PorizoPoemBody(id: "p", title: "T", recipientName: "R", verses: ["A", "B"], previewLines: nil)
        XCTAssertEqual(PoemClaimLogic.verses(from: poem), ["A", "B"])
    }
}
