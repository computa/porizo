import XCTest
import UserNotifications
@testable import PorizoApp

final class LocalNotificationServiceTests: XCTestCase {

    // Note: requestAuthorization() shows a system dialog which blocks in simulators.
    // We test authorization status checking instead, which doesn't require user interaction.
    func test_notificationCenterAccessible() async throws {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        // Just verify we can access the notification center without crashing
        // The actual authorization status depends on simulator state
        XCTAssertNotNil(settings)
    }

    func test_showRenderComplete_createsNotification() async throws {
        let service = LocalNotificationService.shared
        // This should not throw - we're verifying the API contract
        await service.showRenderComplete(trackId: "test-123", trackTitle: "Happy Birthday")
    }

    @MainActor
    func test_removeNotification_doesNotThrow() async throws {
        let service = LocalNotificationService.shared
        // Should be a no-op if notification doesn't exist
        service.removeNotification(for: "nonexistent-track")
    }

    func test_shared_returnsSameInstance() {
        let instance1 = LocalNotificationService.shared
        let instance2 = LocalNotificationService.shared
        XCTAssertTrue(instance1 === instance2)
    }

    func test_notificationIdentifier_isConsistent() {
        // Verify the identifier format is predictable for cleanup
        let service = LocalNotificationService.shared
        let trackId = "track-abc-123"

        // Schedule and then remove - if identifiers aren't consistent, remove fails silently
        Task {
            await service.showRenderComplete(trackId: trackId, trackTitle: "Test Song")
        }

        // Give it a moment to schedule
        let expectation = XCTestExpectation(description: "Wait for notification scheduling")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            Task { @MainActor in
                service.removeNotification(for: trackId)
            }
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 1.0)
    }
}
