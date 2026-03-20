//
//  BackgroundTaskRegistrar.swift
//  PorizoApp
//
//  Registers and schedules BGTaskScheduler tasks for periodic background work.
//  Complements BackgroundTaskManager which handles immediate background execution time.
//

import BackgroundTasks
import Foundation
import UserNotifications

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
        guard !ProcessInfo.processInfo.isLowPowerModeEnabled else {
            print("[BGTask] Skipping app refresh - Low Power Mode active")
            return
        }

        let request = BGAppRefreshTaskRequest(identifier: refreshTaskId)
        request.earliestBeginDate = Date.now.addingTimeInterval(15 * 60) // 15 minutes

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
        guard !ProcessInfo.processInfo.isLowPowerModeEnabled else {
            print("[BGTask] Skipping render check - Low Power Mode active")
            return
        }

        let request = BGProcessingTaskRequest(identifier: renderCheckTaskId)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date.now.addingTimeInterval(5 * 60) // 5 minutes

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
        // Schedule next refresh first (in case this one fails)
        scheduleAppRefresh()

        runBackgroundWork(task: task, name: "app refresh") {
            // Actually validate token accessibility in background context.
            // Full token refresh requires AuthManager which needs MainActor,
            // so for now we validate Keychain is accessible when app is suspended.

            guard KeychainHelper.loadString(key: "porizo_refresh_token") != nil else {
                print("[BGTask] No refresh token - skipping background token validation")
                return
            }

            // Validate we can read Keychain in background context
            if KeychainHelper.loadString(key: "porizo_access_token") != nil {
                print("[BGTask] Auth tokens accessible in background - state preserved")
            } else {
                print("[BGTask] Access token not readable in background (may need refresh on foreground)")
            }
        }
    }

    private static func handleRenderCheck(task: BGProcessingTask) {
        scheduleRenderCheck()
        runBackgroundWork(task: task, name: "render check") {
            await checkRenderStatus()
        }
    }

    // MARK: - Render Status Check

    /// Checks for completed renders and sends notifications.
    ///
    /// This runs in a background task context without access to the main app's
    /// APIClient instance. It creates a temporary client using Keychain-stored credentials.
    private static func checkRenderStatus() async {
        // Load auth token from Keychain (same keys used by AuthManager)
        guard let accessToken = KeychainHelper.loadString(key: "porizo_access_token") else {
            print("[BGTask] No auth token available - skipping render check")
            return
        }

        // Load previously rendering track IDs from persistent storage
        let previouslyRendering = loadRenderingTrackIds()

        do {
            // Fetch current tracks using a simple network request
            let tracks = try await fetchTracksWithToken(accessToken)

            // Find tracks currently rendering
            let currentlyRendering = Set(tracks.filter {
                $0.status == "rendering" || $0.status == "processing"
            }.map { $0.id })

            // Find tracks that completed (were rendering, now ready)
            let completedTrackIds = previouslyRendering.subtracting(currentlyRendering)

            for trackId in completedTrackIds {
                if let track = tracks.first(where: { $0.id == trackId }),
                   track.status == "preview_ready" || track.status == "full_ready" {
                    print("[BGTask] Track completed: \(track.title)")

                    // Show local notification
                    await showRenderCompleteNotification(trackId: track.id, title: track.title)

                    // Post notification for UI refresh when app becomes active
                    NotificationCenter.default.post(
                        name: .trackRenderCompleted,
                        object: nil,
                        userInfo: ["trackId": track.id]
                    )
                }
            }

            // Save current rendering state for next check
            saveRenderingTrackIds(currentlyRendering)

            print("[BGTask] Render check complete: \(currentlyRendering.count) rendering, \(completedTrackIds.count) completed")

        } catch {
            print("[BGTask] Render check failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Network Request

    /// Fetches tracks using a direct network request with the provided auth token.
    private static func fetchTracksWithToken(_ token: String) async throws -> [Track] {
        guard let url = URL(string: "\(AppConfig.apiBaseURL)/tracks?limit=50") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        guard httpResponse.statusCode == 200 else {
            print("[BGTask] Tracks fetch failed with status: \(httpResponse.statusCode)")
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        let tracksResponse = try decoder.decode(GetTracksResponse.self, from: data)
        return tracksResponse.tracks
    }

    // MARK: - Notification

    /// Shows a local notification for a completed render.
    private static func showRenderCompleteNotification(trackId: String, title: String) async {
        let content = UNMutableNotificationContent()
        content.title = "Song Ready!"
        content.body = "\"\(title)\" is ready to play."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "render-complete-\(trackId)",
            content: content,
            trigger: nil  // Deliver immediately
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            print("[BGTask] Failed to show notification: \(error.localizedDescription)")
        }
    }

    // MARK: - Persistence

    private static let renderingTrackIdsKey = "com.porizo.renderingTrackIds"

    /// Loads the set of track IDs that were rendering in the last check.
    private static func loadRenderingTrackIds() -> Set<String> {
        guard let array = UserDefaults.standard.stringArray(forKey: renderingTrackIdsKey) else {
            return []
        }
        return Set(array)
    }

    /// Saves the set of currently rendering track IDs for the next check.
    private static func saveRenderingTrackIds(_ ids: Set<String>) {
        UserDefaults.standard.set(Array(ids), forKey: renderingTrackIdsKey)
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
