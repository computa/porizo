//
//  RenderPollingService.swift
//  PorizoApp
//
//  Provides automatic polling for track render status updates.
//  Uses Combine's Timer.publish for integration with SwiftUI lifecycle.
//

import Foundation
import Combine

/// Service for automatic polling of track render status.
/// Designed to work with SwiftUI views that need periodic refresh.
@MainActor
final class RenderPollingService: ObservableObject {

    // MARK: - Published State

    @Published private(set) var isPolling = false

    // MARK: - Private Properties

    private var timerCancellable: AnyCancellable?
    private var refreshHandler: (() -> Void)?

    // MARK: - Initialization

    init() {}

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
            print("[RenderPolling] Skipping polling - Low Power Mode active")
            return
        }

        self.refreshHandler = onRefresh
        self.isPolling = true

        // Use Timer.publish for Combine integration
        timerCancellable = Timer.publish(every: interval, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.refreshHandler?()
            }
    }

    /// Stops the polling timer and cleans up resources.
    func stopPolling() {
        timerCancellable?.cancel()
        timerCancellable = nil
        refreshHandler = nil
        isPolling = false
    }
}
