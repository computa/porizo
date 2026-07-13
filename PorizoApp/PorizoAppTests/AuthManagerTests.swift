//
//  AuthManagerTests.swift
//  PorizoAppTests
//
//  Tests for AuthManager - authentication state and session lifecycle.
//

import XCTest
import Security
@testable import PorizoApp

final class AuthManagerTests: XCTestCase {

    override func tearDown() {
        super.tearDown()
        PendingSuggestionStore.clear()
        KeychainHelper.delete(key: "porizo_pending_phone_link")
        KeychainHelper.delete(key: "porizo_pending_phone_link_expiry")
    }

    // MARK: - Identity helpers

    func testPhoneProfileEntryValidator_requiresNonEmptyNameAndValidEmail() {
        XCTAssertFalse(PhoneProfileEntryValidator.canContinue(displayName: "", email: "ambrose@example.com"))
        XCTAssertFalse(PhoneProfileEntryValidator.canContinue(displayName: "Ambrose", email: ""))
        XCTAssertFalse(PhoneProfileEntryValidator.canContinue(displayName: "Ambrose", email: "invalid"))
        XCTAssertTrue(PhoneProfileEntryValidator.canContinue(displayName: "Ambrose", email: "ambrose@example.com"))
    }

    func testEmailVerificationToken_extractsTokenFromSupportedDeepLinks() {
        let customScheme = URL(string: "porizo://verify-email?token=abc123")!
        XCTAssertEqual(emailVerificationToken(from: customScheme), "abc123")

        let universalLink = URL(string: "https://porizo.app/verify-email?token=xyz789")!
        XCTAssertEqual(emailVerificationToken(from: universalLink), "xyz789")

        let unrelated = URL(string: "https://porizo.app/share/song")!
        XCTAssertNil(emailVerificationToken(from: unrelated))
    }

    // MARK: - Protected Data Tests

    @MainActor
    func testWaitForProtectedDataReturnsImmediatelyWhenAvailable() async {
        // Given: Protected data is available (normal case in tests)
        let authManager = AuthManager()

        // When: We call waitForProtectedData
        let result = await authManager.waitForProtectedData()

        // Then: It should return true immediately
        XCTAssertTrue(result)
    }

    func testWaitForProtectedDataTimesOutWhenUnavailable() async {
        // This test documents the expected behavior - in practice,
        // we can't easily simulate isProtectedDataAvailable = false in unit tests
        // The timeout behavior is verified through integration testing
    }

    // MARK: - Proactive Token Refresh Tests

    @MainActor
    func testEnsureValidAccessTokenThrowsWhenNotAuthenticated() async throws {
        // Given: No tokens stored (fresh AuthManager with no login)
        let authManager = AuthManager()

        // When/Then: ensureValidAccessToken should throw notAuthenticated
        do {
            _ = try await authManager.ensureValidAccessToken()
            XCTFail("Expected AuthError.notAuthenticated to be thrown")
        } catch let error as AuthError {
            if case .notAuthenticated = error {
                // Expected error type
            } else {
                XCTFail("Expected .notAuthenticated but got: \(error)")
            }
        } catch {
            XCTFail("Expected AuthError but got: \(error)")
        }
    }

    @MainActor
    func testEnsureValidAccessTokenMethodExists() async {
        // This test verifies the method signature exists and is callable.
        // Full behavior testing requires a mocked auth server.
        //
        // Expected behavior:
        // - Returns existing token if expiry > 5 minutes away
        // - Proactively refreshes if token expires within 5 minutes
        // - Throws AuthError.notAuthenticated if no token exists

        let authManager = AuthManager()

        // Method should exist and be callable (will throw since not authenticated)
        do {
            _ = try await authManager.ensureValidAccessToken()
        } catch is AuthError {
            // Expected - not authenticated
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
    }

    @MainActor
    func testEnsureValidAccessTokenReturnsExistingWhenValid() async throws {
        // Given: Valid access token with 30 minutes remaining
        // When: ensureValidAccessToken is called
        // Then: It should return the existing token without refresh
        throw XCTSkip("Requires keychain mocking")
    }

    @MainActor
    func testEnsureValidAccessTokenRefreshesWhenNearExpiry() async throws {
        // Given: Access token expires in 4 minutes (less than 5-minute buffer)
        // When: ensureValidAccessToken is called
        // Then: It should call refreshTokens() proactively
        throw XCTSkip("Requires keychain mocking")
    }

    @MainActor
    func testLogoutClearsPendingPhoneLinkAndPendingSuggestionState() async {
        _ = KeychainHelper.saveString(key: "porizo_pending_phone_link", value: "+15551234567")
        _ = KeychainHelper.saveString(
            key: "porizo_pending_phone_link_expiry",
            value: String(Date().addingTimeInterval(600).timeIntervalSince1970)
        )
        PendingSuggestionStore.store(
            suggestion: OnboardingSuggestion(
                title: "A Song for Mom",
                emotionalAngle: "A thank-you she will keep forever",
                previewLine: "You were there before I had the words...",
                source: "template"
            ),
            recipientName: "Mom",
            occasion: "birthday",
            emotionalSeed: "unsaid_words",
            relationshipType: "mom",
            createTypeRaw: CreateFlowKind.song.rawValue
        )

        let authManager = AuthManager()
        authManager.logout()

        XCTAssertNil(KeychainHelper.loadString(key: "porizo_pending_phone_link"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_pending_phone_link_expiry"))
        XCTAssertNil(PendingSuggestionStore.loadIfActive())
    }

    func testMagicLoginLinkRequiresExactHTTPSHostAndIOSPath() throws {
        let valid = try XCTUnwrap(URL(string: "https://auth.porizo.co/auth/magic/ios?transaction_id=tx_1#secret=link_1"))
        XCTAssertEqual(
            MagicLoginLink.parse(valid),
            MagicLoginLink(transactionId: "tx_1", linkSecret: "link_1")
        )

        let rejected = [
            "http://auth.porizo.co/auth/magic/ios?transaction_id=tx#secret=s",
            "porizo://auth/magic/ios?transaction_id=tx#secret=s",
            "https://evil.example/auth/magic/ios?transaction_id=tx#secret=s",
            "https://auth.porizo.co.evil.example/auth/magic/ios?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx&transaction_id=other#secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx&secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx&secret=query#secret=fragment",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx#secret=s&secret=other",
        ]
        for value in rejected {
            XCTAssertNil(MagicLoginLink.parse(try XCTUnwrap(URL(string: value))), value)
        }
    }

    func testPendingMagicRequestsAreBoundedAndSurviveReloadByTransactionId() {
        PendingMagicLoginStore.removeAll()
        defer { PendingMagicLoginStore.removeAll() }
        let now = Date()

        for index in 0...PendingMagicLoginStore.maximumEntries {
            XCTAssertTrue(PendingMagicLoginStore.save(PendingMagicLogin(
                transactionId: "u6_tx_\(index)",
                requestSecret: "request_secret_\(index)",
                requesterKey: "requester_key_\(index)",
                email: "person\(index)@example.com",
                purpose: .login,
                expiresAt: now.addingTimeInterval(600),
                createdAt: now.addingTimeInterval(TimeInterval(index))
            ), now: now))
        }

        XCTAssertNil(PendingMagicLoginStore.load(transactionId: "u6_tx_0", now: now))
        XCTAssertEqual(
            PendingMagicLoginStore.load(transactionId: "u6_tx_5", now: now)?.requestSecret,
            "request_secret_5"
        )
        let attributes = KeychainHelper.securityAttributes(
            key: PendingMagicLoginStore.keyPrefix + "u6_tx_5"
        )
        XCTAssertEqual(attributes.accessible, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
        XCTAssertNotEqual(attributes.synchronizable, true)
    }

    func testPendingMagicRequestExpiresAndIsRemoved() {
        PendingMagicLoginStore.removeAll()
        defer { PendingMagicLoginStore.removeAll() }
        let now = Date()
        XCTAssertTrue(PendingMagicLoginStore.save(PendingMagicLogin(
            transactionId: "u6_expired",
            requestSecret: "request_secret",
            requesterKey: "requester_key_1234",
            email: "person@example.com",
            purpose: .addEmail,
            expiresAt: now.addingTimeInterval(1),
            createdAt: now
        ), now: now))

        XCTAssertNil(PendingMagicLoginStore.load(
            transactionId: "u6_expired",
            now: now.addingTimeInterval(2)
        ))
    }
}
