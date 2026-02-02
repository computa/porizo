//
//  PushNotificationTests.swift
//  PorizoAppTests
//
//  Tests for push notification registration, token storage, and handling.
//

import XCTest
@testable import PorizoApp

final class PushNotificationTests: XCTestCase {

    override func tearDown() {
        // Clean up test data
        PushTokenManager.clearPushToken()
        super.tearDown()
    }

    // MARK: - Token Storage Tests

    func test_savePushToken_storesToken() {
        let testToken = "abc123def456"
        PushTokenManager.savePushToken(testToken)

        let retrieved = PushTokenManager.getPushToken()
        XCTAssertEqual(retrieved, testToken)
    }

    func test_clearPushToken_removesToken() {
        let testToken = "abc123def456"
        PushTokenManager.savePushToken(testToken)

        PushTokenManager.clearPushToken()

        let retrieved = PushTokenManager.getPushToken()
        XCTAssertNil(retrieved)
    }

    func test_getPushToken_returnsNilWhenNotSet() {
        PushTokenManager.clearPushToken()

        let retrieved = PushTokenManager.getPushToken()
        XCTAssertNil(retrieved)
    }

    // MARK: - Token Conversion Tests

    func test_deviceTokenToString_convertsCorrectly() {
        // Create a sample device token (8 bytes for simplicity)
        let bytes: [UInt8] = [0xAB, 0xCD, 0xEF, 0x12, 0x34, 0x56, 0x78, 0x9A]
        let tokenData = Data(bytes)

        let tokenString = PushTokenManager.tokenToString(tokenData)

        XCTAssertEqual(tokenString, "abcdef123456789a")
    }

    func test_deviceTokenToString_emptyData() {
        let emptyData = Data()

        let tokenString = PushTokenManager.tokenToString(emptyData)

        XCTAssertEqual(tokenString, "")
    }

    // MARK: - Notification Name Extension Tests

    func test_trackRenderCompleted_notificationName_exists() {
        // Verify the notification name constant exists
        let name = Notification.Name.trackRenderCompleted
        XCTAssertEqual(name.rawValue, "trackRenderCompleted")
    }

    // MARK: - Push Payload Parsing Tests

    func test_parseRenderCompletePayload_validPayload() {
        let payload: [AnyHashable: Any] = [
            "type": "render_complete",
            "trackId": "track-123",
            "trackTitle": "Happy Birthday Song"
        ]

        let parsed = PushPayloadParser.parseRenderComplete(from: payload)

        XCTAssertNotNil(parsed)
        XCTAssertEqual(parsed?.trackId, "track-123")
        XCTAssertEqual(parsed?.trackTitle, "Happy Birthday Song")
    }

    func test_parseRenderCompletePayload_wrongType() {
        let payload: [AnyHashable: Any] = [
            "type": "other_notification",
            "trackId": "track-123",
            "trackTitle": "Happy Birthday Song"
        ]

        let parsed = PushPayloadParser.parseRenderComplete(from: payload)

        XCTAssertNil(parsed)
    }

    func test_parseRenderCompletePayload_missingTrackId() {
        let payload: [AnyHashable: Any] = [
            "type": "render_complete",
            "trackTitle": "Happy Birthday Song"
        ]

        let parsed = PushPayloadParser.parseRenderComplete(from: payload)

        XCTAssertNil(parsed)
    }

    func test_parseRenderCompletePayload_missingTrackTitle() {
        let payload: [AnyHashable: Any] = [
            "type": "render_complete",
            "trackId": "track-123"
        ]

        let parsed = PushPayloadParser.parseRenderComplete(from: payload)

        XCTAssertNil(parsed)
    }

    func test_parseRenderCompletePayload_emptyPayload() {
        let payload: [AnyHashable: Any] = [:]

        let parsed = PushPayloadParser.parseRenderComplete(from: payload)

        XCTAssertNil(parsed)
    }
}
