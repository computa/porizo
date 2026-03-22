//
//  PlaybackController.swift
//  PorizoApp
//
//  Owns the AVPlayer lifecycle: setup, play/pause, seek, time observation,
//  AVAudioSession management, lock-screen Now Playing integration, retry
//  logic, and teardown.
//
//  Extracted from TrackPlayerFullView to enable reuse across the full player,
//  mini-player, share-claim playback, and notification-driven flows.
//

import AVFoundation
import Observation

// MARK: - Playback Controller

@Observable
@MainActor
final class PlaybackController {

    // MARK: - Published State

    /// Whether audio is currently playing.
    private(set) var isPlaying: Bool = false

    /// Current playback position in seconds.
    private(set) var currentTime: TimeInterval = 0

    /// Total duration of the loaded audio in seconds.
    private(set) var duration: TimeInterval = 0

    /// Normalised playback progress (0...1).
    private(set) var playbackProgress: Double = 0

    /// Human-readable error when playback fails, nil when healthy.
    private(set) var playbackError: String?

    // MARK: - Metadata (for Now Playing)

    /// Track title shown on the lock screen.
    var trackTitle: String = "" {
        didSet { pushNowPlayingMetadata() }
    }

    /// Artist / recipient name shown on the lock screen.
    var artistName: String? {
        didSet { pushNowPlayingMetadata() }
    }

    // MARK: - Callbacks

    /// Fired once each time the player item reaches its end.
    var onPlaybackFinished: (() -> Void)?

    /// Fired on every time-observer tick with the current time in seconds.
    /// Use this for lyric tracking or any time-dependent UI outside the controller.
    var onTimeUpdate: ((TimeInterval) -> Void)?

    // MARK: - Private State

    private var player: AVPlayer?
    private var timeObserverToken: Any?
    private var playbackEndObserver: NSObjectProtocol?
    private var playerItemStatusObserver: NSKeyValueObservation?

    // Retry state
    private var lastRetryTime: Date?
    private var retryAttemptCount: Int = 0
    private let minRetryIntervalSeconds: Double = 2.0

    /// The URL currently loaded (kept for retry).
    private var loadedURL: String?

    // MARK: - Lifecycle

    init() {}

    /// The caller **must** invoke ``cleanup()`` before releasing the
    /// controller (e.g. in `.onDisappear`). A `deinit` safety net is
    /// intentionally omitted because `@MainActor`-isolated properties
    /// cannot be accessed from a nonisolated `deinit` under strict
    /// concurrency.

    // MARK: - Public API

    /// Load an audio URL and prepare the player. Does **not** auto-play.
    func setupPlayer(url: String) {
        print("[PlaybackController] setupPlayer called with URL: \(url)")

        if !ensureAudioSessionActive() {
            print("[PlaybackController] WARNING: Could not configure audio session, playback may fail")
        }

        guard let audioUrl = URL(string: url) else {
            print("[PlaybackController] ERROR: Invalid URL string")
            playbackError = "Invalid audio URL"
            return
        }

        // Tear down any existing player first.
        tearDownObservers()

        let playerItem = AVPlayerItem(url: audioUrl)
        player = AVPlayer(playerItem: playerItem)
        loadedURL = url

        // Reset playback state.
        currentTime = 0
        playbackProgress = 0
        duration = 0
        playbackError = nil

        configureNowPlaying()
        pushNowPlayingMetadata()

        observePlayerItemStatus(playerItem)
        loadDurationAsync(playerItem)
        addPeriodicTimeObserver()
        observePlaybackEnd(playerItem)
    }

    /// Start or resume playback.
    func play() {
        guard let player else {
            playbackError = "Player not initialised"
            return
        }

        if !ensureAudioSessionActive() {
            playbackError = "Could not activate audio"
            return
        }

        if let error = player.currentItem?.error {
            playbackError = "Cannot play: \(error.localizedDescription)"
            return
        }

        player.play()
        isPlaying = true
        NowPlayingManager.shared.updatePlaybackState(
            isPlaying: true,
            elapsed: currentTime,
            duration: duration > 0 ? duration : nil
        )
    }

    /// Pause playback.
    func pause() {
        player?.pause()
        isPlaying = false
        NowPlayingManager.shared.updatePlaybackState(
            isPlaying: false,
            elapsed: currentTime,
            duration: duration > 0 ? duration : nil
        )
    }

    /// Toggle between play and pause.
    func togglePlayPause() {
        if isPlaying {
            pause()
        } else {
            play()
        }
    }

    /// Seek to a specific time in seconds.
    func seek(to time: TimeInterval) {
        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        player?.seek(to: cmTime)
    }

    /// Retry playback of the last loaded URL with exponential backoff.
    func retryPlayback() {
        if let lastRetry = lastRetryTime {
            let elapsed = Date.now.timeIntervalSince(lastRetry)
            let requiredInterval = min(
                minRetryIntervalSeconds * pow(2.0, Double(retryAttemptCount)),
                16.0
            )
            if elapsed < requiredInterval {
                let waitTime = Int(ceil(requiredInterval - elapsed))
                if let existing = playbackError, !existing.contains("wait") {
                    playbackError = "\(existing) (wait \(waitTime)s)"
                }
                return
            }
        }

        lastRetryTime = Date.now
        retryAttemptCount += 1
        playbackError = nil

        guard let url = loadedURL else {
            playbackError = "No audio URL available"
            return
        }

        setupPlayer(url: url)
    }

    /// Full teardown: stop playback, remove all observers, release the player.
    func cleanup() {
        tearDownObservers()
        player?.pause()
        player = nil
        isPlaying = false
        currentTime = 0
        playbackProgress = 0
        duration = 0
        playbackError = nil
        loadedURL = nil
        NowPlayingManager.shared.updatePlaybackState(
            isPlaying: false, elapsed: 0, duration: nil
        )
    }

    /// Replace the loaded URL without rebuilding the player. Useful when
    /// switching from preview to full render audio.
    func switchAudio(url: String) {
        let wasPlaying = isPlaying
        cleanup()
        setupPlayer(url: url)
        if wasPlaying {
            play()
        }
    }

    // MARK: - Audio Session

    @discardableResult
    private func ensureAudioSessionActive() -> Bool {
        do {
            let session = AVAudioSession.sharedInstance()
            if session.category != .playback {
                try session.setCategory(.playback, mode: .default, options: [])
            }
            try session.setActive(true)
            return true
        } catch {
            print("[PlaybackController] Failed to configure audio session: \(error)")
            return false
        }
    }

    // MARK: - Now Playing Integration

    private func configureNowPlaying() {
        NowPlayingManager.shared.configureRemoteCommands(
            onPlay: { [weak self] in
                guard let self else { return }
                Task { @MainActor in self.play() }
            },
            onPause: { [weak self] in
                guard let self else { return }
                Task { @MainActor in self.pause() }
            },
            onToggle: { [weak self] in
                guard let self else { return }
                Task { @MainActor in self.togglePlayPause() }
            },
            onSeek: { [weak self] time in
                guard let self else { return }
                Task { @MainActor in self.seek(to: time) }
            }
        )
    }

    private func pushNowPlayingMetadata() {
        let effectiveArtist = {
            let trimmed = (artistName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "Porizo" : trimmed
        }()
        let metadata = NowPlayingMetadata(title: trackTitle, artist: effectiveArtist)
        NowPlayingManager.shared.updateMetadata(
            metadata, duration: duration > 0 ? duration : nil
        )
    }

    // MARK: - Observer Setup

    private func observePlayerItemStatus(_ item: AVPlayerItem) {
        playerItemStatusObserver?.invalidate()
        playerItemStatusObserver = item.observe(
            \.status, options: [.initial, .new]
        ) { [weak self] observedItem, _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch observedItem.status {
                case .readyToPlay:
                    let itemDuration = observedItem.duration.seconds
                    if itemDuration.isFinite && itemDuration > 0 {
                        self.duration = itemDuration
                        self.pushNowPlayingMetadata()
                        self.resetRetryState()
                    }

                case .failed:
                    let userMessage = self.describePlayerError(observedItem.error)
                    self.isPlaying = false
                    self.playbackError = userMessage

                case .unknown:
                    break

                @unknown default:
                    break
                }
            }
        }
    }

    private func loadDurationAsync(_ item: AVPlayerItem) {
        Task {
            do {
                let loaded = try await item.asset.load(.duration)
                let seconds = loaded.seconds
                if seconds.isFinite && seconds > 0 {
                    self.duration = seconds
                }
            } catch {
                print("[PlaybackController] Could not load duration: \(error.localizedDescription)")
            }
        }
    }

    private func addPeriodicTimeObserver() {
        timeObserverToken = player?.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            guard let self else { return }
            let seconds = time.seconds
            guard seconds.isFinite else { return }

            Task { @MainActor [weak self] in
                guard let self else { return }
                self.currentTime = seconds
                if self.duration > 0 {
                    self.playbackProgress = min(1, seconds / self.duration)
                }
                self.onTimeUpdate?(seconds)

                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: self.isPlaying,
                    elapsed: seconds,
                    duration: self.duration > 0 ? self.duration : nil
                )
            }
        }
    }

    private func observePlaybackEnd(_ item: AVPlayerItem) {
        playbackEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isPlaying = false
                self.playbackProgress = 0
                self.currentTime = 0
                self.player?.seek(to: .zero)

                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: false,
                    elapsed: 0,
                    duration: self.duration > 0 ? self.duration : nil
                )

                self.onPlaybackFinished?()
            }
        }
    }

    // MARK: - Helpers

    private func tearDownObservers() {
        if let token = timeObserverToken, let p = player {
            p.removeTimeObserver(token)
        }
        timeObserverToken = nil

        playerItemStatusObserver?.invalidate()
        playerItemStatusObserver = nil

        if let observer = playbackEndObserver {
            NotificationCenter.default.removeObserver(observer)
            playbackEndObserver = nil
        }
    }

    private func resetRetryState() {
        retryAttemptCount = 0
        lastRetryTime = nil
    }

    private func describePlayerError(_ error: Error?) -> String {
        guard let nsError = error as NSError? else {
            return "Unable to play this audio."
        }
        print("[PlaybackController] PlayerItem FAILED: \(nsError.localizedDescription)")

        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorNotConnectedToInternet:
                return "No internet connection. Check your network and try again."
            case NSURLErrorTimedOut:
                return "Connection timed out. Try again."
            default:
                return "Network error (\(nsError.code)). Try again."
            }
        }
        return "Unable to play audio (Error \(nsError.code))."
    }
}
