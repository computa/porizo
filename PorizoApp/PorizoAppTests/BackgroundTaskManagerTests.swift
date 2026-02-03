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

    // MARK: - Cancellation Tests

    @MainActor
    func test_cancelTask_stopsInFlightWork() async throws {
        let manager = BackgroundTaskManager.shared
        let taskStarted = XCTestExpectation(description: "Task started")
        let taskCancelled = XCTestExpectation(description: "Task was cancelled")
        var wasCompleted = false

        // Start a long-running task
        Task {
            do {
                try await manager.executeWithBackgroundTime(taskName: "cancel-test") {
                    taskStarted.fulfill()
                    // Simulate long work that checks for cancellation
                    for _ in 0..<100 {
                        try Task.checkCancellation()
                        try await Task.sleep(nanoseconds: 50_000_000) // 50ms per iteration
                    }
                    wasCompleted = true
                }
            } catch is CancellationError {
                taskCancelled.fulfill()
            }
        }

        // Wait for task to start
        await fulfillment(of: [taskStarted], timeout: 2.0)

        // Cancel the task
        manager.cancelTask(named: "cancel-test")

        // Wait for cancellation to take effect
        await fulfillment(of: [taskCancelled], timeout: 2.0)

        XCTAssertFalse(wasCompleted, "Task should not complete after cancellation")
    }

    @MainActor
    func test_hasActiveTask_returnsCorrectState() async throws {
        let manager = BackgroundTaskManager.shared
        let taskStarted = XCTestExpectation(description: "Task started")
        let taskCompleted = XCTestExpectation(description: "Task completed")

        XCTAssertFalse(manager.hasActiveTask(named: "active-test"), "Should not have task before starting")

        // Start a task with a short duration
        Task {
            await manager.executeWithBackgroundTime(taskName: "active-test") {
                taskStarted.fulfill()
                try? await Task.sleep(nanoseconds: 200_000_000) // 200ms
            }
            taskCompleted.fulfill()
        }

        // Wait for task to start
        await fulfillment(of: [taskStarted], timeout: 2.0)

        XCTAssertTrue(manager.hasActiveTask(named: "active-test"), "Should have task while running")

        // Wait for task to complete naturally
        await fulfillment(of: [taskCompleted], timeout: 2.0)

        // After completion, task should be removed
        XCTAssertFalse(manager.hasActiveTask(named: "active-test"), "Should not have task after completion")
    }

    @MainActor
    func test_cancelTask_isThreadSafe() async throws {
        let manager = BackgroundTaskManager.shared
        var cancellationCount = 0
        let lock = NSLock()

        // Start multiple tasks and cancel them concurrently
        await withTaskGroup(of: Void.self) { group in
            for i in 0..<5 {
                group.addTask {
                    Task {
                        try? await manager.executeWithBackgroundTime(taskName: "threadsafe-\(i)") {
                            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1s
                        }
                    }
                }
            }

            // Small delay to let tasks register
            try? await Task.sleep(nanoseconds: 100_000_000) // 100ms

            // Cancel all from multiple threads concurrently
            for i in 0..<5 {
                group.addTask {
                    manager.cancelTask(named: "threadsafe-\(i)")
                    lock.lock()
                    cancellationCount += 1
                    lock.unlock()
                }
            }
        }

        XCTAssertEqual(cancellationCount, 5, "All cancellation attempts should complete without crash")
    }
}

// MARK: - Test Helpers

private enum TestError: Error {
    case intentional
}
