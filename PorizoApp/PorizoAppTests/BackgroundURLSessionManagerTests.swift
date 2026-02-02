//
//  BackgroundURLSessionManagerTests.swift
//  PorizoAppTests
//
//  Tests for BackgroundURLSessionManager - persistent uploads that survive app suspension.
//

import XCTest
@testable import PorizoApp

final class BackgroundURLSessionManagerTests: XCTestCase {

    // MARK: - Configuration Tests

    func test_session_hasBackgroundConfiguration() {
        let manager = BackgroundURLSessionManager.shared
        let config = manager.session.configuration

        XCTAssertNotNil(config.identifier)
        XCTAssertTrue(config.identifier?.contains("porizo") ?? false)
        XCTAssertTrue(config.sessionSendsLaunchEvents)
    }

    func test_sessionIdentifier_isConsistent() {
        XCTAssertEqual(
            BackgroundURLSessionManager.sessionIdentifier,
            "com.porizo.background-upload"
        )
    }

    // MARK: - Singleton Tests

    func test_shared_returnsSameInstance() {
        let instance1 = BackgroundURLSessionManager.shared
        let instance2 = BackgroundURLSessionManager.shared

        XCTAssertTrue(instance1 === instance2, "shared should return the same instance")
    }

    // MARK: - Configuration Details

    func test_configuration_isNotDiscretionary() {
        let config = BackgroundURLSessionManager.shared.session.configuration

        // isDiscretionary = false means uploads happen immediately, not when system decides
        XCTAssertFalse(config.isDiscretionary)
    }
}
