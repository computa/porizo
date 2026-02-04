//
//  BackgroundTaskManager.swift
//  PorizoApp
//
//  Utility for wrapping work with iOS background execution time.
//  Provides ~30 seconds of additional execution time when the app backgrounds.
//

import UIKit

/// Protocol for type-erased task cancellation.
private protocol CancellableTask {
    func cancel()
}

extension Task: CancellableTask {}

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

    /// Active Swift Tasks keyed by task name for cancellation support.
    /// When iOS calls the expiration handler, we can cancel in-flight work gracefully.
    /// Stores type-erased tasks that can be cancelled.
    /// Thread safety is managed via `lock` - marked nonisolated(unsafe) to allow
    /// access from both MainActor and the iOS expiration handler (background thread).
    private nonisolated(unsafe) var activeTasks: [String: any CancellableTask] = [:]

    /// Lock for thread-safe access to activeTasks dictionary.
    private nonisolated(unsafe) var lock = NSLock()

    // MARK: - Initialization

    private init() {}

    // MARK: - Public API

    /// Execute work with iOS background execution time protection.
    ///
    /// Requests background execution time from iOS before running the work closure.
    /// If the system cannot grant background time (taskId is invalid), the work
    /// still executes but without the extended execution protection.
    ///
    /// The work closure should periodically check `Task.isCancelled` to respond
    /// to cancellation when iOS reclaims background time.
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

        // Use a Task so we can cancel it from the expiration handler
        // @MainActor ensures the work runs on the main actor
        let workTask = Task { @MainActor in
            await work()
        }

        // Register the actual work task for cancellation support
        registerTask(workTask, named: taskName)

        await workTask.value

        removeTask(named: taskName)
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
    /// The work closure should periodically check `Task.checkCancellation()` to
    /// respond to cancellation when iOS reclaims background time.
    ///
    /// - Parameters:
    ///   - taskName: A descriptive name for debugging (appears in system logs).
    ///   - work: The async throwing work to execute with background time protection.
    /// - Returns: The value returned by the work closure.
    /// - Throws: Any error thrown by the work closure, or CancellationError if cancelled.
    func executeWithBackgroundTime<T: Sendable>(
        taskName: String,
        work: @escaping () async throws -> T
    ) async throws -> T {
        let taskId = beginBackgroundTask(named: taskName)

        activeTaskCount += 1
        print("[BackgroundTaskManager] Started '\(taskName)' (active: \(activeTaskCount))")

        // Use a Task so we can cancel it from the expiration handler
        // @MainActor ensures the work runs on the main actor
        let workTask = Task { @MainActor in
            try await work()
        }

        // Register the actual work task for cancellation support
        registerTask(workTask, named: taskName)

        do {
            let result = try await workTask.value

            removeTask(named: taskName)
            activeTaskCount -= 1
            print("[BackgroundTaskManager] Completed '\(taskName)' (active: \(activeTaskCount))")
            endBackgroundTask(taskId, named: taskName)
            return result
        } catch is CancellationError {
            removeTask(named: taskName)
            activeTaskCount -= 1
            print("[BackgroundTaskManager] Cancelled '\(taskName)' (active: \(activeTaskCount))")
            endBackgroundTask(taskId, named: taskName)
            throw CancellationError()
        } catch {
            removeTask(named: taskName)
            activeTaskCount -= 1
            print("[BackgroundTaskManager] Failed '\(taskName)': \(error) (active: \(activeTaskCount))")
            endBackgroundTask(taskId, named: taskName)
            throw error
        }
    }

    // MARK: - Task Management

    /// Check if a task with the given name is currently active.
    ///
    /// - Parameter name: The task name to check.
    /// - Returns: True if the task is currently running.
    nonisolated func hasActiveTask(named name: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return activeTasks[name] != nil
    }

    /// Cancel an active task by name.
    ///
    /// Called by the expiration handler when iOS reclaims background time,
    /// or manually to stop in-flight work. The work closure should check
    /// `Task.checkCancellation()` or `Task.isCancelled` to respond promptly.
    ///
    /// This method is nonisolated so it can be called from the iOS expiration
    /// handler which runs on a background thread.
    ///
    /// - Parameter name: The task name to cancel.
    nonisolated func cancelTask(named name: String) {
        lock.lock()
        let task = activeTasks.removeValue(forKey: name)
        lock.unlock()

        task?.cancel()
        if task != nil {
            print("[BackgroundTaskManager] Cancelled task '\(name)'")
        }
    }

    // MARK: - Private Helpers

    /// Register an active task for cancellation support.
    private func registerTask(_ task: any CancellableTask, named name: String) {
        lock.lock()
        defer { lock.unlock() }
        activeTasks[name] = task
    }

    /// Remove a task from the active tasks dictionary.
    private func removeTask(named name: String) {
        lock.lock()
        defer { lock.unlock() }
        activeTasks.removeValue(forKey: name)
    }

    /// Holder class for capturing taskId in expiration handler.
    private final class TaskHolder {
        var taskId: UIBackgroundTaskIdentifier = .invalid
    }

    /// Request background execution time from iOS.
    ///
    /// - Parameter name: Task name for debugging.
    /// - Returns: The background task identifier, or `.invalid` if not granted.
    private func beginBackgroundTask(named name: String) -> UIBackgroundTaskIdentifier {
        let holder = TaskHolder()

        holder.taskId = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            // Expiration handler - called when time is about to expire
            // Cancel in-flight work before iOS kills it
            self?.cancelTask(named: name)
            print("[BackgroundTaskManager] EXPIRED '\(name)' - iOS reclaiming background time")
            UIApplication.shared.endBackgroundTask(holder.taskId)
            holder.taskId = .invalid
        }

        if holder.taskId == .invalid {
            print("[BackgroundTaskManager] WARNING: Could not begin background task '\(name)' (running anyway)")
        }

        return holder.taskId
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
