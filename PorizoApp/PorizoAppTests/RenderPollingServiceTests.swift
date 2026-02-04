import XCTest
@testable import PorizoApp

final class RenderPollingServiceTests: XCTestCase {

    @MainActor
    func test_startPolling_callsRefreshHandler() async throws {
        let service = RenderPollingService()
        var refreshCount = 0
        service.startPolling(interval: 0.1) {
            refreshCount += 1
        }
        try await Task.sleep(nanoseconds: 350_000_000)
        service.stopPolling()
        XCTAssertGreaterThanOrEqual(refreshCount, 3)
    }

    @MainActor
    func test_stopPolling_stopsRefreshCalls() async throws {
        let service = RenderPollingService()
        var refreshCount = 0
        service.startPolling(interval: 0.1) {
            refreshCount += 1
        }
        try await Task.sleep(nanoseconds: 150_000_000)
        service.stopPolling()
        let countAtStop = refreshCount
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertEqual(refreshCount, countAtStop)
    }

    @MainActor
    func test_isPolling_reflectsState() async throws {
        let service = RenderPollingService()
        XCTAssertFalse(service.isPolling)

        service.startPolling(interval: 0.1) { }
        XCTAssertTrue(service.isPolling)

        service.stopPolling()
        XCTAssertFalse(service.isPolling)
    }

    @MainActor
    func test_startPolling_whileAlreadyPolling_doesNothing() async throws {
        let service = RenderPollingService()
        var refreshCount = 0

        service.startPolling(interval: 0.1) {
            refreshCount += 1
        }

        // Try to start again with a different handler - should be ignored
        var secondHandlerCount = 0
        service.startPolling(interval: 0.1) {
            secondHandlerCount += 1
        }

        try await Task.sleep(nanoseconds: 250_000_000)
        service.stopPolling()

        // Original handler should have been called, second should not
        XCTAssertGreaterThan(refreshCount, 0)
        XCTAssertEqual(secondHandlerCount, 0)
    }

    @MainActor
    func test_stopPolling_whenNotPolling_isNoOp() async throws {
        let service = RenderPollingService()
        // Should not crash or cause issues
        service.stopPolling()
        XCTAssertFalse(service.isPolling)
    }
}
