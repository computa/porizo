import XCTest
@testable import PorizoApp

final class ProfileNameContractTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testMissingDisplayNameUsesTrimmedLocalRule() throws {
        let missing = try decoder.decode(
            AuthUser.self,
            from: Data(#"{"user_id":"usr_missing","display_name":"  \n "}"#.utf8)
        )
        let named = try decoder.decode(
            AuthUser.self,
            from: Data(#"{"user_id":"usr_named","display_name":"  Ambrose  "}"#.utf8)
        )

        XCTAssertTrue(missing.isDisplayNameMissing)
        XCTAssertNil(missing.trimmedDisplayName)
        XCTAssertFalse(named.isDisplayNameMissing)
        XCTAssertEqual(named.trimmedDisplayName, "Ambrose")
    }

    func testProfileNameValidationTrimsAndEnforcesLength() {
        XCTAssertEqual(validateProfileName(" \n "), .empty)
        XCTAssertEqual(validateProfileName("  Ambrose  "), .valid("Ambrose"))
        XCTAssertEqual(validateProfileName(String(repeating: "a", count: 100)), .valid(String(repeating: "a", count: 100)))
        XCTAssertEqual(validateProfileName(String(repeating: "a", count: 101)), .tooLong)
        XCTAssertEqual(validateProfileName(String(repeating: "😀", count: 50)), .valid(String(repeating: "😀", count: 50)))
        XCTAssertEqual(validateProfileName(String(repeating: "😀", count: 51)), .tooLong)
        XCTAssertEqual(validateProfileName(String(repeating: "e\u{301}", count: 50)), .valid(String(repeating: "e\u{301}", count: 50)))
        XCTAssertEqual(validateProfileName(String(repeating: "e\u{301}", count: 51)), .tooLong)
    }

    func testProfileNameUpdateRequestEncodesDisplayName() throws {
        let request = APIClient.UpdateProfileRequest(
            expectedUserId: "usr_a",
            contactEmail: nil,
            displayName: "Ambrose"
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )

        XCTAssertEqual(object["display_name"] as? String, "Ambrose")
        XCTAssertEqual(object["expected_user_id"] as? String, "usr_a")
        XCTAssertFalse(object.keys.contains("contact_email"))
    }

    func testProfileNameResponseIsRejectedAfterAccountSwitch() {
        XCTAssertTrue(shouldApplyProfileNameUpdate(
            expectedUserID: "usr_a",
            currentUserID: "usr_a",
            responseUserID: "usr_a"
        ))
        XCTAssertFalse(shouldApplyProfileNameUpdate(
            expectedUserID: "usr_a",
            currentUserID: "usr_b",
            responseUserID: "usr_a"
        ))
        XCTAssertFalse(shouldApplyProfileNameUpdate(
            expectedUserID: "usr_a",
            currentUserID: nil,
            responseUserID: "usr_a"
        ))
        XCTAssertFalse(shouldApplyProfileNameUpdate(
            expectedUserID: "usr_a",
            currentUserID: "usr_a",
            responseUserID: "usr_b"
        ))
    }
}
