//
//  AudioPlayerService.swift
//  PorizoApp
//
//  Centralized audio playback service.
//  Manages a single AVPlayer instance with observable state for UI binding.
//  Properly handles observer lifecycle to prevent memory leaks.
//

import SwiftUI
import AVFoundation
import Combine

/// Observable audio player service for centralized playback management
///
/// Usage:
/// ```swift
/// @StateObject private var audioPlayer = AudioPlayerService.shared
///
/// // Play audio
/// audioPlayer.play(url: "https://example.com/audio.aac")
///
/// // UI bindings
/// Text("\(audioPlayer.currentTime) / \(audioPlayer.duration)")
/// Button(audioPlayer.isPlaying ? "Pause" : "Play") {
///     audioPlayer.togglePlayback()
/// }
/// ```
@MainActor
final class AudioPlayerService: ObservableObject {

    // MARK: - Singleton

    /// Shared instance for app-wide playback
    static let shared = AudioPlayerService()

    // MARK: - Published State

    /// Whether audio is currently playing
    @Published private(set) var isPlaying = false

    /// Current playback time in seconds
    @Published private(set) var currentTime: Double = 0

    /// Total duration in seconds (0 if unknown)
    @Published private(set) var duration: Double = 0

    /// Progress as fraction 0.0 - 1.0
    var progress: Double {
        guard duration > 0 else { return 0 }
        return currentTime / duration
    }

    /// URL of currently loaded audio (nil if nothing loaded)
    @Published private(set) var currentURL: String?

    /// Loading state
    @Published private(set) var isLoading = false

    /// Error message if playback failed
    @Published private(set) var errorMessage: String?

    // MARK: - Private Properties

    private var player: AVPlayer?
    private var timeObserverToken: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?

    // MARK: - Initialization

    private init() {}

    // Note: deinit cannot call @MainActor methods directly.
    // Since this is a singleton, deinit is never called in practice.
    // If needed, call stop() explicitly before releasing.

    // MARK: - Public Methods

    /// Load and play audio from URL
    /// - Parameter url: Audio URL string
    func play(url: String) {
        // If same URL, just resume
        if url == currentURL, let player = player {
            resume()
            return
        }

        // Clean up previous player
        cleanup()

        guard let audioURL = URL(string: url) else {
            errorMessage = "Invalid audio URL"
            return
        }

        isLoading = true
        errorMessage = nil
        currentURL = url

        // Configure audio session
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            errorMessage = "Failed to configure audio: \(error.localizedDescription)"
            isLoading = false
            return
        }

        // Create player
        let playerItem = AVPlayerItem(url: audioURL)
        player = AVPlayer(playerItem: playerItem)

        // Observe status changes
        statusObserver = playerItem.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    self.isLoading = false
                    self.loadDuration(from: item)
                    self.player?.play()
                    self.isPlaying = true
                case .failed:
                    self.isLoading = false
                    self.errorMessage = item.error?.localizedDescription ?? "Failed to load audio"
                default:
                    break
                }
            }
        }

        // Add time observer
        timeObserverToken = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                self?.currentTime = time.seconds
            }
        }

        // Observe end of playback
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: playerItem,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.isPlaying = false
                self.currentTime = 0
                self.player?.seek(to: .zero)
            }
        }
    }

    /// Resume playback if paused
    func resume() {
        guard let player = player else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        isPlaying = true
    }

    /// Pause playback
    func pause() {
        player?.pause()
        isPlaying = false
    }

    /// Toggle between play and pause
    func togglePlayback() {
        if isPlaying {
            pause()
        } else if currentURL != nil {
            resume()
        }
    }

    /// Seek to specific time
    /// - Parameter time: Time in seconds
    func seek(to time: Double) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime)
        currentTime = time
    }

    /// Seek to progress fraction (0.0 - 1.0)
    /// - Parameter progress: Progress as fraction
    func seek(toProgress progress: Double) {
        guard duration > 0 else { return }
        seek(to: progress * duration)
    }

    /// Stop playback and release resources
    func stop() {
        cleanup()
        currentURL = nil
        currentTime = 0
        duration = 0
        isPlaying = false
        isLoading = false
        errorMessage = nil
    }

    // MARK: - Private Methods

    private func loadDuration(from item: AVPlayerItem) {
        Task {
            do {
                let loadedDuration = try await item.asset.load(.duration)
                let seconds = loadedDuration.seconds
                if !seconds.isNaN && seconds.isFinite {
                    await MainActor.run {
                        self.duration = seconds
                    }
                }
            } catch {
                // Duration unavailable - not critical for playback
            }
        }
    }

    private func cleanup() {
        // Remove time observer
        if let token = timeObserverToken, let currentPlayer = player {
            currentPlayer.removeTimeObserver(token)
            timeObserverToken = nil
        }

        // Remove end observer
        if let observer = endObserver {
            NotificationCenter.default.removeObserver(observer)
            endObserver = nil
        }

        // Cancel status observation
        statusObserver?.invalidate()
        statusObserver = nil

        // Stop and release player
        player?.pause()
        player = nil
    }
}

// MARK: - Time Formatting Extension

extension AudioPlayerService {
    /// Format seconds as "M:SS"
    static func formatTime(_ seconds: Double) -> String {
        guard !seconds.isNaN && seconds.isFinite else { return "0:00" }
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
