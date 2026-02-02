//
//  BackgroundTaskRegistrar.swift
//  PorizoApp
//
//  Registers and schedules BGTaskScheduler tasks for periodic background work.
//  Complements BackgroundTaskManager which handles immediate background execution time.
//

import BackgroundTasks
import Foundation

/// Registers and schedules iOS BGTaskScheduler tasks for background execution.
///
/// BGTaskScheduler allows the app to perform work when fully suspended, unlike
/// `BackgroundTaskManager` which only extends execution during the background transition.
///
/// Task identifiers must match Info.plist's `BGTaskSchedulerPermittedIdentifiers`.
struct BackgroundTaskRegistrar {

    // MARK: - Task Identifiers

    /// App refresh task - periodic lightweight refresh (e.g., token refresh, cache update)
    static let refreshTaskId = "com.porizo.refresh"

    /// Render check task - processing task to check render status and send notifications
    static let renderCheckTaskId = "com.porizo.render-check"

    // MARK: - Registration

    /// Register all background tasks with the scheduler.
    ///
    /// Call this from the app's `init()` before the app finishes launching.
    /// Registration must happen during app launch - registering later will fail silently.
    static func registerTasks() {
        let refreshOk = registerTask(refreshTaskId, as: BGAppRefreshTask.self, handler: handleAppRefresh)
        let renderOk = registerTask(renderCheckTaskId, as: BGProcessingTask.self, handler: handleRenderCheck)

        print("[BGTask] Registered background tasks: refresh=\(refreshOk), renderCheck=\(renderOk)")
    }

    /// Registers a single background task with type-safe casting.
    private static func registerTask<T: BGTask>(
        _ identifier: String,
        as type: T.Type,
        handler: @escaping (T) -> Void
    ) -> Bool {
        let success = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let typedTask = task as? T else {
                print("[BGTask] Unexpected task type for \(identifier): \(Swift.type(of: task))")
                task.setTaskCompleted(success: false)
                return
            }
            handler(typedTask)
        }

        if !success {
            print("[BGTask] CRITICAL: Failed to register \(identifier)")
        }
        return success
    }

    // MARK: - Scheduling

    /// Schedule an app refresh task.
    ///
    /// Call when the app enters background. The system will wake the app
    /// at some point after `earliestBeginDate` to perform the refresh.
    ///
    /// - Note: The system decides when to actually run the task based on
    ///   device usage patterns and system conditions.
    static func scheduleAppRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BGTask] Scheduled app refresh for ~15 minutes from now")
        } catch {
            print("[BGTask] Failed to schedule app refresh: \(error.localizedDescription)")
        }
    }

    /// Schedule a render check task.
    ///
    /// Call when there are tracks actively rendering. This schedules a processing
    /// task that can check render status and send local notifications.
    ///
    /// - Note: Processing tasks have more execution time than refresh tasks but
    ///   are subject to stricter scheduling constraints.
    static func scheduleRenderCheck() {
        let request = BGProcessingTaskRequest(identifier: renderCheckTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 5 * 60) // 5 minutes

        do {
            try BGTaskScheduler.shared.submit(request)
            print("[BGTask] Scheduled render check for ~5 minutes from now")
        } catch {
            print("[BGTask] Failed to schedule render check: \(error.localizedDescription)")
        }
    }

    /// Cancel all pending background tasks.
    ///
    /// Call when background work is no longer needed (e.g., no pending renders).
    static func cancelAllTasks() {
        BGTaskScheduler.shared.cancelAllTaskRequests()
        print("[BGTask] Cancelled all pending background tasks")
    }

    // MARK: - Task Handlers

    private static func handleAppRefresh(task: BGAppRefreshTask) {
        scheduleAppRefresh()
        runBackgroundWork(task: task, name: "app refresh") {
            // TODO: Add actual refresh logic when APIClient is accessible
            // Candidates: token refresh, entitlements sync, cache cleanup
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    private static func handleRenderCheck(task: BGProcessingTask) {
        scheduleRenderCheck()
        runBackgroundWork(task: task, name: "render check") {
            // TODO: Add actual render status check and notification logic
            // 1. Fetch tracks with status == "rendering"
            // 2. Check if any completed
            // 3. Send local notification for completed tracks
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    /// Runs async work with proper expiration handling and completion reporting.
    private static func runBackgroundWork(
        task: BGTask,
        name: String,
        work: @escaping () async -> Void
    ) {
        print("[BGTask] Running \(name)")

        let operation = Task { await work() }

        task.expirationHandler = {
            print("[BGTask] \(name.capitalized) expired - cancelling")
            operation.cancel()
        }

        Task {
            _ = await operation.result
            let success = !operation.isCancelled
            print("[BGTask] \(name.capitalized) completed: success=\(success)")
            task.setTaskCompleted(success: success)
        }
    }
}
