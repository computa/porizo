//
//  BackgroundTaskManager.swift
//  PorizoApp
//
//  Utility for wrapping work with iOS background execution time.
//  Provides ~30 seconds of additional execution time when the app backgrounds.
//

import UIKit

/// Manages iOS background task execution time for long-running operations.
///
/// Use this to wrap API calls and other operations that might fail if the app
/// backgrounds during execution. iOS grants approximately 30 seconds of
/// background execution time when requested.
///
/// Usage:
/// ```swift
/// await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "api-call") {
///     try await networkClient.performRequest()
/// }
/// ```
@MainActor
final class BackgroundTaskManager {

    // MARK: - Singleton

    /// Shared instance for app-wide background task management.
    static let shared = BackgroundTaskManager()

    // MARK: - Properties

    /// Track active background tasks for debugging.
    private var activeTaskCount: Int = 0

    // MARK: - Initialization

    private init() {}

    // MARK: - Public API

    /// Execute work with iOS background execution time protection.
    ///
    /// Requests background execution time from iOS before running the work closure.
    /// If the system cannot grant background time (taskId is invalid), the work
    /// still executes but without the extended execution protection.
    ///
    /// - Parameters:
    ///   - taskName: A descriptive name for debugging (appears in system logs).
    ///   - work: The async work to execute with background time protection.
    func executeWithBackgroundTime(
        taskName: String,
        work: @escaping () async -> Void
    ) async {
        let taskId = beginBackgroundTask(named: taskName)

        activeTaskCount += 1
        print("[BackgroundTaskManager] Started '\(taskName)' (active: \(activeTaskCount))")

        await work()

        activeTaskCount -= 1
        print("[BackgroundTaskManager] Completed '\(taskName)' (active: \(activeTaskCount))")

        endBackgroundTask(taskId, named: taskName)
    }

    /// Execute work with iOS background execution time protection, returning a value.
    ///
    /// Requests background execution time from iOS before running the work closure.
    /// If the system cannot grant background time (taskId is invalid), the work
    /// still executes but without the extended execution protection.
    ///
    /// - Parameters:
    ///   - taskName: A descriptive name for debugging (appears in system logs).
    ///   - work: The async throwing work to execute with background time protection.
    /// - Returns: The value returned by the work closure.
    /// - Throws: Any error thrown by the work closure.
    func executeWithBackgroundTime<T>(
        taskName: String,
        work: @escaping () async throws -> T
    ) async throws -> T {
        let taskId = beginBackgroundTask(named: taskName)

        activeTaskCount += 1
        print("[BackgroundTaskManager] Started '\(taskName)' (active: \(activeTaskCount))")

        do {
            let result = try await work()
            activeTaskCount -= 1
            print("[BackgroundTaskManager] Completed '\(taskName)' (active: \(activeTaskCount))")
            endBackgroundTask(taskId, named: taskName)
            return result
        } catch {
            activeTaskCount -= 1
            print("[BackgroundTaskManager] Failed '\(taskName)': \(error) (active: \(activeTaskCount))")
            endBackgroundTask(taskId, named: taskName)
            throw error
        }
    }

    // MARK: - Private Helpers

    /// Request background execution time from iOS.
    ///
    /// - Parameter name: Task name for debugging.
    /// - Returns: The background task identifier, or `.invalid` if not granted.
    private func beginBackgroundTask(named name: String) -> UIBackgroundTaskIdentifier {
        let taskId = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            // Expiration handler - called when time is about to expire
            print("[BackgroundTaskManager] EXPIRED '\(name)' - iOS reclaiming background time")
            // Note: We don't decrement activeTaskCount here because the work may still be running
            // The task will be ended by the normal completion path
        }

        if taskId == .invalid {
            print("[BackgroundTaskManager] WARNING: Could not begin background task '\(name)' (running anyway)")
        }

        return taskId
    }

    /// End a background task.
    ///
    /// - Parameters:
    ///   - taskId: The task identifier from beginBackgroundTask.
    ///   - name: Task name for debugging.
    private func endBackgroundTask(_ taskId: UIBackgroundTaskIdentifier, named name: String) {
        guard taskId != .invalid else {
            return
        }

        UIApplication.shared.endBackgroundTask(taskId)
        print("[BackgroundTaskManager] Released background time for '\(name)'")
    }
}
