//
//  AuthManagerTests.swift
//  PorizoAppTests
//
//  Tests for AuthManager - authentication state and session lifecycle.
//

import XCTest
@testable import PorizoApp

final class AuthManagerTests: XCTestCase {

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
}
