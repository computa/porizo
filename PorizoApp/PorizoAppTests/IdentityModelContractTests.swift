//
//  IdentityModelContractTests.swift
//  PorizoAppTests
//
//  Identity model contract tests — verifies iOS models correctly decode
//  the authoritative identity API response shape from /auth/me.
//
//  Covers:
//  - AuthUser new identity fields (auth_methods, contacts, primary_*, missing_*)
//  - AuthMethod decoding (linked_at, last_used_at, subject_masked)
//  - ContactInfo decoding (verified, is_primary, is_relay)
//  - Backward compat: old server responses without identity fields
//  - AccountManagementView computed state (hasApple, hasPhone)
//

import XCTest
@testable import PorizoApp

final class IdentityModelContractTests: XCTestCase {

    private let decoder = JSONDecoder()

    // MARK: - Full /auth/me Response

    /// The canonical /auth/me response with all identity fields present.
    private let fullAuthMeJSON = """
    {
        "user_id": "usr_abc123",
        "email": "ambrose@example.com",
        "display_name": "Ambrose",
        "avatar_url": null,
        "email_verified": true,
        "providers": ["apple", "phone"],
        "created_at": "2026-01-15T10:00:00Z",
        "phone_number": "+2348101234567",
        "username": null,
        "needs_profile_completion": false,
        "auth_methods": [
            {
                "type": "apple",
                "linked_at": "2026-01-15T10:00:00Z",
                "last_used_at": "2026-04-14T08:30:00Z"
            },
            {
                "type": "phone",
                "linked_at": "2026-02-01T14:00:00Z",
                "last_used_at": "2026-04-13T09:00:00Z",
                "subject_masked": "+23***4567"
            }
        ],
        "contacts": [
            {
                "type": "email",
                "value_display": "ambrose@example.com",
                "verified": true,
                "is_primary": true,
                "is_relay": false
            },
            {
                "type": "phone",
                "value_display": "+2348101234567",
                "verified": true,
                "is_primary": true,
                "is_relay": false
            },
            {
                "type": "email",
                "value_display": "xxxxxx@privaterelay.appleid.com",
                "verified": true,
                "is_primary": false,
                "is_relay": true
            }
        ],
        "primary_email": "ambrose@example.com",
        "primary_phone": "+2348101234567",
        "missing_profile_requirements": []
    }
    """.data(using: .utf8)!

    func testAuthUser_decodesFullIdentityResponse() throws {
        let user = try decoder.decode(AuthUser.self, from: fullAuthMeJSON)

        XCTAssertEqual(user.id, "usr_abc123")
        XCTAssertEqual(user.email, "ambrose@example.com")
        XCTAssertEqual(user.displayName, "Ambrose")
        XCTAssertTrue(user.emailVerified)
        XCTAssertEqual(user.providers, ["apple", "phone"])
        XCTAssertEqual(user.phoneNumber, "+2348101234567")
        XCTAssertFalse(user.needsProfileCompletion)

        // Identity fields
        XCTAssertEqual(user.authMethods.count, 2)
        XCTAssertEqual(user.contacts.count, 3)
        XCTAssertEqual(user.primaryEmail, "ambrose@example.com")
        XCTAssertEqual(user.primaryPhone, "+2348101234567")
        XCTAssertTrue(user.missingProfileRequirements.isEmpty)
    }

    // MARK: - AuthMethod Decoding

    func testAuthMethod_decodesAppleMethod() throws {
        let json = Data("""
        {"type": "apple", "linked_at": "2026-01-15T10:00:00Z", "last_used_at": "2026-04-14T08:30:00Z"}
        """.utf8)
        let method = try decoder.decode(AuthMethod.self, from: json)

        XCTAssertEqual(method.type, "apple")
        XCTAssertEqual(method.linkedAt, "2026-01-15T10:00:00Z")
        XCTAssertEqual(method.lastUsedAt, "2026-04-14T08:30:00Z")
        XCTAssertNil(method.subjectMasked)
    }

    func testAuthMethod_decodesPhoneWithMaskedSubject() throws {
        let json = Data("""
        {"type": "phone", "linked_at": "2026-02-01T14:00:00Z", "last_used_at": null, "subject_masked": "+23***4567"}
        """.utf8)
        let method = try decoder.decode(AuthMethod.self, from: json)

        XCTAssertEqual(method.type, "phone")
        XCTAssertEqual(method.subjectMasked, "+23***4567")
        XCTAssertNil(method.lastUsedAt)
    }

    func testAuthMethod_decodesMinimalFields() throws {
        let json = Data("""
        {"type": "email"}
        """.utf8)
        let method = try decoder.decode(AuthMethod.self, from: json)

        XCTAssertEqual(method.type, "email")
        XCTAssertNil(method.linkedAt)
        XCTAssertNil(method.lastUsedAt)
        XCTAssertNil(method.subjectMasked)
    }

    // MARK: - ContactInfo Decoding

    func testContactInfo_decodesVerifiedPrimaryEmail() throws {
        let json = Data("""
        {"type": "email", "value_display": "ambrose@example.com", "verified": true, "is_primary": true, "is_relay": false}
        """.utf8)
        let contact = try decoder.decode(ContactInfo.self, from: json)

        XCTAssertEqual(contact.type, "email")
        XCTAssertEqual(contact.valueDisplay, "ambrose@example.com")
        XCTAssertTrue(contact.verified)
        XCTAssertTrue(contact.isPrimary)
        XCTAssertFalse(contact.isRelay)
    }

    func testContactInfo_decodesRelayEmail() throws {
        let json = Data("""
        {"type": "email", "value_display": "xxx@privaterelay.appleid.com", "verified": true, "is_primary": false, "is_relay": true}
        """.utf8)
        let contact = try decoder.decode(ContactInfo.self, from: json)

        XCTAssertTrue(contact.isRelay)
        XCTAssertFalse(contact.isPrimary)
        XCTAssertTrue(contact.verified)
    }

    func testContactInfo_decodesUnverifiedPhone() throws {
        let json = Data("""
        {"type": "phone", "value_display": "+2348101234567", "verified": false, "is_primary": false}
        """.utf8)
        let contact = try decoder.decode(ContactInfo.self, from: json)

        XCTAssertEqual(contact.type, "phone")
        XCTAssertFalse(contact.verified)
        XCTAssertFalse(contact.isPrimary)
        XCTAssertFalse(contact.isRelay) // Defaults to false when missing
    }

    func testContactInfo_defaultsWhenFieldsMissing() throws {
        let json = Data("""
        {"type": "email"}
        """.utf8)
        let contact = try decoder.decode(ContactInfo.self, from: json)

        XCTAssertEqual(contact.type, "email")
        XCTAssertNil(contact.valueDisplay)
        XCTAssertFalse(contact.verified)
        XCTAssertFalse(contact.isPrimary)
        XCTAssertFalse(contact.isRelay)
    }

    // MARK: - Backward Compatibility

    func testAuthUser_decodesLegacyResponseWithoutIdentityFields() throws {
        let legacyJSON = Data("""
        {
            "user_id": "usr_old123",
            "email": "old@example.com",
            "display_name": "Old User",
            "email_verified": false,
            "providers": ["phone"],
            "created_at": "2025-06-01T00:00:00Z",
            "phone_number": "+1234567890"
        }
        """.utf8)

        let user = try decoder.decode(AuthUser.self, from: legacyJSON)

        XCTAssertEqual(user.id, "usr_old123")
        XCTAssertEqual(user.email, "old@example.com")
        XCTAssertFalse(user.emailVerified)

        // New identity fields should default gracefully
        XCTAssertTrue(user.authMethods.isEmpty)
        XCTAssertTrue(user.contacts.isEmpty)
        XCTAssertNil(user.primaryEmail)
        XCTAssertNil(user.primaryPhone)
        XCTAssertTrue(user.missingProfileRequirements.isEmpty)
        XCTAssertFalse(user.needsProfileCompletion)
    }

    // MARK: - Profile Completeness Contract

    func testAuthUser_needsProfileCompletionWithMissingRequirements() throws {
        let json = Data("""
        {
            "user_id": "usr_incomplete",
            "needs_profile_completion": true,
            "missing_profile_requirements": ["display_name", "verified_email"],
            "auth_methods": [{"type": "phone", "linked_at": "2026-04-01T00:00:00Z"}],
            "contacts": [{"type": "phone", "value_display": "+1234567890", "verified": true, "is_primary": true}]
        }
        """.utf8)

        let user = try decoder.decode(AuthUser.self, from: json)

        XCTAssertTrue(user.needsProfileCompletion)
        XCTAssertEqual(user.missingProfileRequirements, ["display_name", "verified_email"])
        XCTAssertEqual(user.authMethods.count, 1)
        XCTAssertEqual(user.contacts.count, 1)
    }

    // MARK: - AccountManagementView State Logic

    func testAccountManagement_hasAppleDetection() throws {
        let user = try decoder.decode(AuthUser.self, from: fullAuthMeJSON)

        // Uses the same production predicates as AccountManagementView
        XCTAssertTrue(user.hasAppleMethod)
        XCTAssertTrue(user.hasPhoneMethod)
    }

    func testAccountManagement_phoneOnlyUser() throws {
        let json = Data("""
        {
            "user_id": "usr_phone",
            "providers": ["phone"],
            "auth_methods": [{"type": "phone", "linked_at": "2026-03-01T00:00:00Z", "subject_masked": "+23***4567"}],
            "contacts": [{"type": "phone", "value_display": "+2348101234567", "verified": true, "is_primary": true}],
            "needs_profile_completion": true,
            "missing_profile_requirements": ["verified_email"]
        }
        """.utf8)

        let user = try decoder.decode(AuthUser.self, from: json)

        XCTAssertFalse(user.hasAppleMethod, "Phone-only user should not have Apple method")
        XCTAssertTrue(user.hasPhoneMethod)
        XCTAssertFalse(user.hasRealVerifiedEmail, "Phone-only user should lack verified email")
        XCTAssertTrue(user.needsProfileCompletion)
        XCTAssertEqual(user.missingProfileRequirements, ["verified_email"])
    }

    func testAccountManagement_relayEmailDoesNotSatisfyVerifiedEmail() throws {
        let json = Data("""
        {
            "user_id": "usr_relay",
            "providers": ["apple"],
            "auth_methods": [{"type": "apple", "linked_at": "2026-01-01T00:00:00Z"}],
            "contacts": [
                {"type": "email", "value_display": "xxx@privaterelay.appleid.com", "verified": true, "is_primary": true, "is_relay": true}
            ],
            "needs_profile_completion": true,
            "missing_profile_requirements": ["verified_real_email"]
        }
        """.utf8)

        let user = try decoder.decode(AuthUser.self, from: json)

        XCTAssertFalse(user.hasRealVerifiedEmail, "Relay email should not count as real verified email")
        XCTAssertTrue(user.needsProfileCompletion)
    }
}
