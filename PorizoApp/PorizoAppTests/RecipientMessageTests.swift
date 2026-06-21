import XCTest
@testable import PorizoApp

final class RecipientMessageTests: XCTestCase {

    func testBodyExactString() {
        let body = RecipientMessage.body(
            recipientName: "Sarah",
            link: "https://porizo.co/s/abc123"
        )
        XCTAssertEqual(
            body,
            "I made you a song 🎵 Sarah — open it here: https://porizo.co/s/abc123"
        )
    }

    func testWhatsAppURLStripsPlusAndPercentEncodesText() {
        let body = RecipientMessage.body(
            recipientName: "Sarah",
            link: "https://porizo.co/s/abc123"
        )
        let url = RecipientMessage.whatsAppURL(phoneE164: "+61412345678", body: body)
        XCTAssertNotNil(url)
        let absolute = url!.absoluteString
        XCTAssertTrue(absolute.hasPrefix("https://wa.me/61412345678?text="))
        // Spaces become %20 (or +); ensure raw spaces aren't present in the query.
        let query = url!.query ?? ""
        XCTAssertFalse(query.contains(" "))
    }

    func testWhatsAppURLNilForNonPlusInput() {
        XCTAssertNil(
            RecipientMessage.whatsAppURL(phoneE164: "61412345678", body: "hi")
        )
    }
}
