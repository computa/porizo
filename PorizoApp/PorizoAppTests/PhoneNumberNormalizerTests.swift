import XCTest
@testable import PorizoApp

final class PhoneNumberNormalizerTests: XCTestCase {

    func testAlreadyE164PassesThrough() {
        XCTAssertEqual(
            PhoneNumberNormalizer.e164("+61412345678", defaultRegion: "AU"),
            "+61412345678"
        )
    }

    func testLocalNumberUsesDefaultRegion() {
        XCTAssertEqual(
            PhoneNumberNormalizer.e164("0412 345 678", defaultRegion: "AU"),
            "+61412345678"
        )
    }

    func testUnparseableReturnsNil() {
        XCTAssertNil(PhoneNumberNormalizer.e164("not a number", defaultRegion: "US"))
    }
}
