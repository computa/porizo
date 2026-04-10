//
//  JobRecoveryService.swift
//  PorizoApp
//
//  Polls for rendering job status on app launch to recover any renders
//  that completed while the app was suspended.
//

import Foundation
import UserNotifications

/// Service for checking pending render status on app launch.
///
/// This handles the case where renders completed while the app was suspended
/// and push notifications were missed. On launch, it fetches the current
/// track list and notifies about any completed renders.
struct JobRecoveryService {

    // MARK: - Persistence Keys

    private static let pendingRenderIdsKey = "com.porizo.pendingRenderIds"

    // MARK: - Public API

    /// Checks for pending renders that may have completed while the app was suspended.
    ///
    /// Call this from `PorizoAppApp.swift` on app launch, typically in the `.task` modifier
    /// after notification authorization is requested.
    ///
    /// The service:
    /// 1. Loads the auth token from Keychain
    /// 2. Fetches the current track list from the server
    /// 3. Compares against previously-known rendering tracks
    /// 4. Shows local notifications for any newly completed renders
    /// 5. Posts `.trackRenderCompleted` notifications for UI updates
    static func checkPendingRenders(using apiClient: APIClient) async {
        print("[JobRecovery] Checking for pending renders...")

        // Avoid authenticated work if there is nothing to recover.
        let previouslyPending = loadPendingRenderIds()
        guard !previouslyPending.isEmpty else {
            print("[JobRecovery] No pending renders recorded - skipping check")
            return
        }

        do {
            // Fetch current tracks through the shared API client so auth refresh/retry
            // behavior matches the rest of the app.
            let tracks = try await apiClient.getTracks(limit: 50).tracks

            // Find tracks currently rendering
            let currentlyRendering = Set(tracks.filter {
                $0.status == "rendering" || $0.status == "processing"
            }.map { $0.id })

            // Find tracks that were pending but are now complete
            let completedTrackIds = previouslyPending.subtracting(currentlyRendering)

            var notifiedCount = 0
            for trackId in completedTrackIds {
                if let track = tracks.first(where: { $0.id == trackId }),
                   track.status == "preview_ready" || track.status == "full_ready" {
                    print("[JobRecovery] Track completed: \(track.title)")

                    // Show local notification
                    await showRenderCompleteNotification(trackId: track.id, title: track.title)

                    // Post notification for UI refresh
                    NotificationCenter.default.post(
                        name: .trackRenderCompleted,
                        object: nil,
                        userInfo: ["trackId": track.id]
                    )

                    notifiedCount += 1
                }
            }

            // Update stored pending IDs for next check
            savePendingRenderIds(currentlyRendering)

            print("[JobRecovery] Check complete: \(currentlyRendering.count) rendering, \(notifiedCount) newly completed")

        } catch {
            print("[JobRecovery] Failed to check renders: \(error.localizedDescription)")
        }
    }

    /// Records a track as pending render.
    ///
    /// Call this when starting a new render so the recovery service
    /// knows to check for its completion on next launch.
    ///
    /// - Parameter trackId: The ID of the track being rendered.
    static func markTrackAsRendering(_ trackId: String) {
        var pending = loadPendingRenderIds()
        pending.insert(trackId)
        savePendingRenderIds(pending)
        print("[JobRecovery] Marked track as rendering: \(trackId)")
    }

    /// Removes a track from the pending render list.
    ///
    /// Call this when a render completes or fails so it's no longer
    /// tracked for recovery.
    ///
    /// - Parameter trackId: The ID of the track to remove.
    static func clearTrackFromPending(_ trackId: String) {
        var pending = loadPendingRenderIds()
        pending.remove(trackId)
        savePendingRenderIds(pending)
        print("[JobRecovery] Cleared track from pending: \(trackId)")
    }

    // MARK: - Notification

    /// Shows a local notification for a completed render.
    private static func showRenderCompleteNotification(trackId: String, title: String) async {
        await LocalNotificationService.shared.showRenderComplete(
            trackId: trackId,
            trackTitle: title
        )
    }

    // MARK: - Persistence

    /// Loads the set of track IDs that were pending render.
    private static func loadPendingRenderIds() -> Set<String> {
        guard let array = UserDefaults.standard.stringArray(forKey: pendingRenderIdsKey) else {
            return []
        }
        return Set(array)
    }

    /// Saves the set of currently pending render track IDs.
    private static func savePendingRenderIds(_ ids: Set<String>) {
        UserDefaults.standard.set(Array(ids), forKey: pendingRenderIdsKey)
    }
}
