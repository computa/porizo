//
//  RenderPollingService.swift
//  PorizoApp
//
//  Provides automatic polling for track render status updates.
//

import Foundation
import Observation

@Observable
@MainActor
final class RenderPollingService {

    private(set) var isPolling = false
    private(set) var isLowPowerModeActive = false

    @ObservationIgnored
    private var timerTask: Task<Void, Never>?
    @ObservationIgnored
    private var refreshHandler: (() -> Void)?

    // MARK: - Initialization

    init() {}

    deinit {
        timerTask?.cancel()
    }

    // MARK: - Public Methods

    /// Starts polling at the specified interval.
    /// - Parameters:
    ///   - interval: Time between refresh calls in seconds. Default is 5 seconds.
    ///   - onRefresh: Closure called on each timer tick.
    /// - Note: If already polling, this method does nothing (guards against duplicate timers).
    func startPolling(interval: TimeInterval = 5.0, onRefresh: @escaping () -> Void) {
        // Guard against starting when already polling
        guard !isPolling else { return }

        // Skip polling in Low Power Mode to preserve battery
        guard !ProcessInfo.processInfo.isLowPowerModeEnabled else {
            isLowPowerModeActive = true
            print("[RenderPolling] Skipping polling - Low Power Mode active")
            return
        }
        isLowPowerModeActive = false

        self.refreshHandler = onRefresh
        self.isPolling = true

        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { break }
                self?.refreshHandler?()
            }
        }
    }

    func stopPolling() {
        timerTask?.cancel()
        timerTask = nil
        refreshHandler = nil
        isPolling = false
        isLowPowerModeActive = false
    }
}
