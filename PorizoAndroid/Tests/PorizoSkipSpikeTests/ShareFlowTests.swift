import XCTest
@testable import PorizoSkipSpike

/// U10 — share/send pure logic: message copy (no expiry urgency), the
/// SMS-vs-sheet decision, and the smsto: URI. Mirrors iOS RecipientMessage +
/// DirectSendModel's present() branch.
final class ShareFlowTests: XCTestCase {

    // MARK: - Message body (ports iOS RecipientMessage.body)

    func testMessageBodyWithName() {
        let body = ShareLogic.messageBody(recipientName: "Maya", link: "https://porizo.co/s/abc", contentType: .song)
        XCTAssertEqual(body, "I made you a song 🎵 Maya — open it here: https://porizo.co/s/abc")
    }

    func testMessageBodyWithoutName() {
        let body = ShareLogic.messageBody(recipientName: "  ", link: "https://porizo.co/s/abc", contentType: .song)
        XCTAssertEqual(body, "I made you a song 🎵 — open it here: https://porizo.co/s/abc")
    }

    func testMessageBodyForPoem() {
        let body = ShareLogic.messageBody(recipientName: "Sam", link: "L", contentType: .poem)
        XCTAssertTrue(body.contains("poem"))
        XCTAssertTrue(body.contains("Sam"))
    }

    func testMessageBodyHasNoExpiryUrgency() {
        // Share links are LIFETIME — never ship "expires in N days" urgency.
        let body = ShareLogic.messageBody(recipientName: "Maya", link: "L", contentType: .song).lowercased()
        XCTAssertFalse(body.contains("expire"))
        XCTAssertFalse(body.contains("days"))
        XCTAssertFalse(body.contains("hurry"))
        XCTAssertFalse(body.contains("soon"))
    }

    // MARK: - Send-channel decision (SMS if phone captured, else share sheet)

    func testSendChannelUsesSmsWhenPhonePresent() {
        XCTAssertEqual(ShareLogic.sendChannel(phone: "+15551234567"), .sms(phone: "+15551234567"))
    }

    func testSendChannelFallsBackToSheetWhenPhoneMissing() {
        XCTAssertEqual(ShareLogic.sendChannel(phone: nil), .shareSheet)
        XCTAssertEqual(ShareLogic.sendChannel(phone: "   "), .shareSheet)
    }

    // MARK: - smsto: URI

    func testSmsUriEncodesBody() {
        let uri = ShareLogic.smsURI(phone: "+15551234567", body: "hi there & you")
        XCTAssertTrue(uri.hasPrefix("smsto:+15551234567?body="))
        XCTAssertTrue(uri.contains("%26"))       // & encoded
        XCTAssertFalse(uri.contains(" hi there")) // no raw spaces
    }

    // MARK: - Share-response decode tolerates null claim_pin

    func testShareResponseDecodesWithNullPin() throws {
        let json = Data(#"{"share_id":"s1","share_url":"https://porizo.co/s/s1","claim_pin":null,"expires_at":"9999-12-31"}"#.utf8)
        let response = try JSONDecoder().decode(PorizoCreateShareResponse.self, from: json)
        XCTAssertEqual(response.shareId, "s1")
        XCTAssertEqual(response.shareUrl, "https://porizo.co/s/s1")
        XCTAssertNil(response.claimPin)
    }

    func testShareResponseDecodesWithPin() throws {
        let json = Data(#"{"share_id":"s1","share_url":"U","claim_pin":"482913","expires_at":"9999-12-31"}"#.utf8)
        let response = try JSONDecoder().decode(PorizoCreateShareResponse.self, from: json)
        XCTAssertEqual(response.claimPin, "482913")
    }
}
