//
//  LaunchFlashViewModel.swift
//  PorizoApp
//
//  Owns the AVPlayer lifecycle for the launch flash.
//
//  Per design doc § "AVPlayer Lifecycle Contract":
//  - Uses AVAudioSession.Category.playback so the launch flash remains audible
//    on physical devices even when the silent switch is enabled.
//  - Cleans up KVO observers, NotificationCenter observers, periodic time observers
//  - Synchronously pauses + nils out player on dismiss, BEFORE starting fade
//  - Deactivates session AFTER fade completes
//

import Foundation
import AVFoundation
import SwiftUI

@MainActor
@Observable
final class LaunchFlashViewModel {
    let content: LaunchFlashContent

    private(set) var isAudioPlaying = false
    private(set) var audioLoadFailed = false
    private(set) var firstFrameDelayMs: Int?
    private(set) var hasDismissed = false
    private(set) var didFinishNaturally = false
    private(set) var canResumePlayback = false

    private var player: AVPlayer?
    private var statusObserver: NSKeyValueObservation?
    private var interruptionObserver: NSObjectProtocol?
    private var routeChangeObserver: NSObjectProtocol?
    private var didPlayToEndObserver: NSObjectProtocol?
    private var fadeTask: Task<Void, Never>?
    private var sessionActivated = false
    private var audioStartTime: Date?
    private var hasReportedAudioStart = false

    /// Called once the player produces its first audio frame.
    var onAudioStarted: ((_ delayMs: Int) -> Void)?

    /// Called once when audio fails to load (404, offline, etc).
    var onAudioFailed: (() -> Void)?

    init(content: LaunchFlashContent) {
        self.content = content
    }

    // Cleanup happens in `dismiss()` (called from view's onDisappear).
    // No deinit body — Swift 6 strict concurrency forbids touching @MainActor
    // properties from a nonisolated deinit.

    // MARK: - Lifecycle

    /// Begin audio playback (if `content.audioURL` exists). Visual-only mode otherwise.
    func startAudio() {
        guard let url = content.audioURL, !hasDismissed else { return }
        startAudio(with: url)
    }

    /// Begin playback with an explicit URL — used when the URL was lazy-fetched
    /// after the view appeared (e.g., owned tracks where the URL lives on TrackVersion).
    func startAudio(with url: URL) {
        guard !hasDismissed, player == nil else { return }

        guard configureAudioSession() else { return }
        audioStartTime = Date()

        let item = AVPlayerItem(url: url)
        let avPlayer = AVPlayer(playerItem: item)
        avPlayer.volume = 0.6
        player = avPlayer
        canResumePlayback = true

        // KVO: track readiness + first frame
        statusObserver = item.observe(\.status, options: [.new]) { [weak self] observed, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch observed.status {
                case .readyToPlay:
                    if !self.hasReportedAudioStart {
                        self.hasReportedAudioStart = true
                        let delay = Int((Date().timeIntervalSince(self.audioStartTime ?? Date())) * 1000)
                        self.firstFrameDelayMs = delay
                        self.onAudioStarted?(delay)
                    }
                case .failed:
                    self.audioLoadFailed = true
                    self.isAudioPlaying = false
                    self.onAudioFailed?()
                default:
                    break
                }
            }
        }

        registerInterruptionObserver()
        registerRouteChangeObserver()

        // Track natural finish (audio reached duration) for analytics
        didPlayToEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, !self.hasDismissed else { return }
                self.didFinishNaturally = true
                self.isAudioPlaying = false
            }
        }

        avPlayer.play()
        isAudioPlaying = true
    }

    /// Tap-to-dismiss flow:
    ///  1. Synchronous pause + volume zero (prevents "audio blasts after dismiss")
    ///  2. Cancel any pending fade task
    ///  3. Replace item with nil (final teardown)
    ///  4. Deactivate session (notifyOthersOnDeactivation)
    func dismiss() {
        guard !hasDismissed else { return }
        hasDismissed = true

        fadeTask?.cancel()
        fadeTask = nil

        if let player {
            player.volume = 0
            player.pause()
            player.replaceCurrentItem(with: nil)
        }
        player = nil
        isAudioPlaying = false
        canResumePlayback = false

        statusObserver?.invalidate()
        statusObserver = nil

        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
            interruptionObserver = nil
        }
        if let observer = routeChangeObserver {
            NotificationCenter.default.removeObserver(observer)
            routeChangeObserver = nil
        }
        if let observer = didPlayToEndObserver {
            NotificationCenter.default.removeObserver(observer)
            didPlayToEndObserver = nil
        }

        if sessionActivated {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActivated = false
        }
    }

    // MARK: - Audio Session

    private func configureAudioSession() -> Bool {
        do {
            // Launch flash is the product reveal. Keep it audible on device in the
            // same way onboarding now is, instead of disappearing behind silent mode.
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            sessionActivated = true
            return true
        } catch {
            #if DEBUG
            print("[LaunchFlash] Audio session setup failed: \(error.localizedDescription)")
            #endif
            audioLoadFailed = true
            onAudioFailed?()
            return false
        }
    }

    // MARK: - Interruption Handling

    private func registerInterruptionObserver() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            let userInfo = notification.userInfo
            let typeValue = userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let optionsValue = userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt
            Task { @MainActor [weak self] in
                self?.handleInterruption(typeValue: typeValue, optionsValue: optionsValue)
            }
        }
    }

    private func handleInterruption(typeValue: UInt?, optionsValue: UInt?) {
        guard let typeValue,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else { return }

        switch type {
        case .began:
            player?.pause()
            isAudioPlaying = false
        case .ended:
            guard let optionsValue else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
            if options.contains(.shouldResume), !hasDismissed {
                player?.play()
                isAudioPlaying = true
            }
        @unknown default:
            break
        }
    }

    private func registerRouteChangeObserver() {
        routeChangeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            Task { @MainActor [weak self] in
                self?.handleRouteChange(reasonValue: reasonValue)
            }
        }
    }

    private func handleRouteChange(reasonValue: UInt?) {
        guard let reasonValue,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else { return }

        // Headphones unplugged → iOS already paused; reflect state in UI
        if reason == .oldDeviceUnavailable {
            isAudioPlaying = false
        }
    }

    // MARK: - Manual Play (when autoplay was blocked or audio was paused)

    func resumePlayback() {
        guard !hasDismissed, let player else { return }
        player.play()
        isAudioPlaying = true
    }
}
