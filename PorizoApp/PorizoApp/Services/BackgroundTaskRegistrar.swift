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
@MainActor
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
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: refreshTaskId,
            using: nil
        ) { task in
            handleAppRefresh(task: task as! BGAppRefreshTask)
        }

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: renderCheckTaskId,
            using: nil
        ) { task in
            handleRenderCheck(task: task as! BGProcessingTask)
        }

        print("[BGTask] Registered background tasks: \(refreshTaskId), \(renderCheckTaskId)")
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
        print("[BGTask] Running app refresh")

        // Schedule the next refresh before doing work
        scheduleAppRefresh()

        let refreshOperation = Task {
            // TODO: Add actual refresh logic when APIClient is accessible
            // Candidates: token refresh, entitlements sync, cache cleanup
            try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds placeholder
        }

        task.expirationHandler = {
            print("[BGTask] App refresh expired - cancelling")
            refreshOperation.cancel()
        }

        Task {
            _ = await refreshOperation.result
            let success = !refreshOperation.isCancelled
            print("[BGTask] App refresh completed: success=\(success)")
            task.setTaskCompleted(success: success)
        }
    }

    private static func handleRenderCheck(task: BGProcessingTask) {
        print("[BGTask] Running render check")

        // Schedule next check (will be enhanced to only schedule if renders pending)
        scheduleRenderCheck()

        let checkOperation = Task {
            // TODO: Add actual render status check and notification logic
            // Steps:
            // 1. Fetch tracks with status == "rendering"
            // 2. Check if any completed
            // 3. Send local notification for completed tracks
            try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds placeholder
        }

        task.expirationHandler = {
            print("[BGTask] Render check expired - cancelling")
            checkOperation.cancel()
        }

        Task {
            _ = await checkOperation.result
            let success = !checkOperation.isCancelled
            print("[BGTask] Render check completed: success=\(success)")
            task.setTaskCompleted(success: success)
        }
    }
}
