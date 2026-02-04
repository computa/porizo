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
    static func checkPendingRenders() async {
        print("[JobRecovery] Checking for pending renders...")

        // Load auth token from Keychain
        guard let accessToken = KeychainHelper.loadString(key: "porizo_access_token") else {
            print("[JobRecovery] No auth token available - skipping check")
            return
        }

        // Load previously pending render IDs
        let previouslyPending = loadPendingRenderIds()

        do {
            // Fetch current tracks
            let tracks = try await fetchTracksWithToken(accessToken)

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
            print("[JobRecovery] Tracks fetch failed with status: \(httpResponse.statusCode)")
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        let tracksResponse = try decoder.decode(GetTracksResponse.self, from: data)
        return tracksResponse.tracks
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
