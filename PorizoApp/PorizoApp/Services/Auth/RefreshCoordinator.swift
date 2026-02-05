//
//  RefreshCoordinator.swift
//  PorizoApp
//
//  Coordinates token refresh across concurrent API requests.
//

import Foundation

// MARK: - Refresh Coordinator

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
    private var refreshTask: Task<Void, Error>?

    /// Performs a coordinated refresh, ensuring only one refresh per epoch.
    /// - Parameter refreshClosure: The actual refresh implementation
    /// - Returns: Whether this call performed the refresh (true) or piggybacked (false)
    func coordinatedRefresh(using refreshClosure: @escaping @Sendable () async throws -> Void) async throws -> Bool {
        // If a refresh is already in flight, just wait for it
        if let existingTask = refreshTask {
            print("[RefreshCoordinator] Awaiting existing refresh (epoch \(epoch))")
            try await existingTask.value
            return false  // We piggybacked on another refresh
        }

        // No refresh in progress - we're the one to do it
        let startEpoch = epoch
        print("[RefreshCoordinator] Starting refresh (epoch \(startEpoch))")

        let task = Task<Void, Error> {
            try await refreshClosure()
        }
        refreshTask = task

        do {
            try await task.value
            epoch += 1
            refreshTask = nil
            print("[RefreshCoordinator] Refresh completed (new epoch \(epoch))")
            return true  // We performed the refresh
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
