//
//  RefreshCoordinator.swift
//  PorizoApp
//
//  Coordinates token refresh across concurrent API requests.
//

import Foundation

// MARK: - Refresh Coordinator

/// Result of a coordinated refresh operation.
struct CoordinatedRefreshResult {
    /// True when this caller executed the refresh closure.
    let didRefresh: Bool
    /// Access token returned by the successful refresh flow.
    let accessToken: String
}

/// Coordinates token refresh across concurrent 401 handlers to prevent race conditions.
///
/// Problem: When multiple API calls are in-flight and token expires, each 401 triggers
/// an independent refresh. With token rotation (gen 2 -> gen 3), the first retry using
/// gen 2 fails because gen 3 invalidated it.
///
/// Solution: This coordinator ensures:
/// 1. Only ONE refresh happens at a time (via refreshTask)
/// 2. All concurrent 401s share the SAME refresh result
/// 3. The "epoch" tracks refresh generations so late arrivals know to just retry
actor RefreshCoordinator {
    /// Shared singleton instance
    static let shared = RefreshCoordinator()

    /// Current refresh epoch - incremented after each successful refresh
    private var epoch: UInt64 = 0

    /// In-flight refresh task (if any)
    private var refreshTask: Task<String, Error>?

    /// Performs a coordinated refresh, ensuring only one refresh per epoch.
    /// - Parameter refreshClosure: The actual refresh implementation, returning the new access token
    /// - Returns: Whether this call performed the refresh and the refreshed access token
    func coordinatedRefresh(
        using refreshClosure: @escaping @Sendable () async throws -> String
    ) async throws -> CoordinatedRefreshResult {
        // If a refresh is already in flight, just wait for it
        if let existingTask = refreshTask {
            print("[RefreshCoordinator] Awaiting existing refresh (epoch \(epoch))")
            let token = try await existingTask.value
            return CoordinatedRefreshResult(didRefresh: false, accessToken: token)
        }

        // No refresh in progress - we're the one to do it
        let startEpoch = epoch
        print("[RefreshCoordinator] Starting refresh (epoch \(startEpoch))")

        let task = Task<String, Error> {
            try await refreshClosure()
        }
        refreshTask = task

        do {
            let token = try await task.value
            epoch += 1
            refreshTask = nil
            print("[RefreshCoordinator] Refresh completed (new epoch \(epoch))")
            return CoordinatedRefreshResult(didRefresh: true, accessToken: token)
        } catch {
            refreshTask = nil
            print("[RefreshCoordinator] Refresh failed: \(error.localizedDescription)")
            throw error
        }
    }

    /// Gets the current epoch (for logging/debugging)
    func currentEpoch() -> UInt64 {
        return epoch
    }
}
