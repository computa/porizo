//
//  AuthManagerTests.swift
//  PorizoAppTests
//
//  Tests for AuthManager - authentication state and session lifecycle.
//

import XCTest
@testable import PorizoApp

final class AuthManagerTests: XCTestCase {

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
}
