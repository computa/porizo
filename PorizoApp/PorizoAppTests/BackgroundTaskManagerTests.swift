//
//  BackgroundTaskManagerTests.swift
//  PorizoAppTests
//
//  Tests for BackgroundTaskManager - iOS background execution support.
//

import XCTest
@testable import PorizoApp

final class BackgroundTaskManagerTests: XCTestCase {

    // MARK: - Basic Execution Tests

    @MainActor
    func test_executeWithBackgroundTime_completesTask() async throws {
        let manager = BackgroundTaskManager.shared
        var completed = false

        await manager.executeWithBackgroundTime(taskName: "test-complete") {
            completed = true
        }

        XCTAssertTrue(completed, "Task should complete execution")
    }

    @MainActor
    func test_executeWithBackgroundTime_handlesAsyncWork() async throws {
        let manager = BackgroundTaskManager.shared
        var result: String?

        await manager.executeWithBackgroundTime(taskName: "async-test") {
            try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
            result = "done"
        }

        XCTAssertEqual(result, "done", "Async work should complete and set result")
    }

    // MARK: - Return Value Tests

    @MainActor
    func test_executeWithBackgroundTime_returnsValue() async throws {
        let manager = BackgroundTaskManager.shared

        let result: Int = try await manager.executeWithBackgroundTime(taskName: "return-test") {
            return 42
        }

        XCTAssertEqual(result, 42, "Should return value from work closure")
    }

    @MainActor
    func test_executeWithBackgroundTime_throwsError() async throws {
        let manager = BackgroundTaskManager.shared

        do {
            let _: Int = try await manager.executeWithBackgroundTime(taskName: "error-test") {
                throw TestError.intentional
            }
            XCTFail("Should have thrown an error")
        } catch {
            XCTAssertTrue(error is TestError, "Should propagate the thrown error")
        }
    }

    // MARK: - Concurrent Execution Tests

    @MainActor
    func test_executeWithBackgroundTime_handlesConcurrentTasks() async throws {
        let manager = BackgroundTaskManager.shared
        var results: [Int] = []
        let lock = NSLock()

        await withTaskGroup(of: Void.self) { group in
            for i in 1...3 {
                group.addTask {
                    await manager.executeWithBackgroundTime(taskName: "concurrent-\(i)") {
                        try? await Task.sleep(nanoseconds: 50_000_000) // 50ms
                        lock.lock()
                        results.append(i)
                        lock.unlock()
                    }
                }
            }
        }

        XCTAssertEqual(results.sorted(), [1, 2, 3], "All concurrent tasks should complete")
    }

    // MARK: - Singleton Tests

    @MainActor
    func test_shared_returnsSameInstance() {
        let instance1 = BackgroundTaskManager.shared
        let instance2 = BackgroundTaskManager.shared

        XCTAssertTrue(instance1 === instance2, "shared should return the same instance")
    }
}

// MARK: - Test Helpers

private enum TestError: Error {
    case intentional
}
