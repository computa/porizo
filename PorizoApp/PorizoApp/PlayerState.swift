import SwiftUI
import AVFoundation
import Observation
import UIKit

@MainActor
@Observable
class PlayerState {
    var currentTrack: Track?
    var currentVersion: TrackVersion?
    var isPlaying = false
    var isLoading = false
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var lyrics: Lyrics?

    // Vocal onset detection via audio metering
    private(set) var detectedIntroEnd: TimeInterval?
    @ObservationIgnored private(set) var introDetected = false
    @ObservationIgnored private var baselinePowerSamples: [Float] = []
    @ObservationIgnored private var baselinePower: Float = -160.0
    @ObservationIgnored private var baselineReady = false
    @ObservationIgnored private var consecutiveOnsetFrames = 0

    // Audio player (managed internally)
    @ObservationIgnored private var audioPlayer: AVAudioPlayer?
    @ObservationIgnored private var playbackTimer: Timer?

    // Lockscreen / MPNowPlayingInfoCenter artwork (fetched async from the best
    // available per-song image URL).
    @ObservationIgnored private var artworkFetchTask: Task<Void, Never>?
    @ObservationIgnored private var cachedArtworkUrl: String?
    @ObservationIgnored private var cachedArtworkImage: UIImage?

    var progress: Double {
        guard duration > 0 else { return 0 }
        return currentTime / duration
    }

    var formattedCurrentTime: String {
        formatTime(currentTime)
    }

    var formattedDuration: String {
        formatTime(duration)
    }

    // MARK: - Playback Control

    func loadAndPlay(data: Data, track: Track, version: TrackVersion?) {
        // Stop any existing playback
        stopPlayback()

        do {
            // Configure audio session
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)

            // Create player
            let player = try AVAudioPlayer(data: data)
            player.isMeteringEnabled = true
            player.prepareToPlay()
            audioPlayer = player

            // Reset vocal onset detection
            detectedIntroEnd = nil
            introDetected = false
            baselinePowerSamples = []
            baselinePower = -160.0
            baselineReady = false
            consecutiveOnsetFrames = 0

            // Update state
            currentTrack = track
            currentVersion = version
            duration = player.duration
            lyrics = version?.lyricsJson
            isLoading = false

            // Start playback
            if player.play() {
                isPlaying = true
                startPlaybackTimer()
                print("[PlayerState] Playback started")
                configureRemoteCommands()
                pushNowPlayingMetadata()
                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: true,
                    elapsed: 0,
                    duration: duration > 0 ? duration : nil
                )
                fetchArtworkIfNeeded()
            } else {
                print("[PlayerState] play() returned false")
                Task { @MainActor in
                    ToastService.shared.error("Failed to start playback")
                }
            }
        } catch {
            print("[PlayerState] Error: \(error.localizedDescription)")
            Task { @MainActor in
                ToastService.shared.error("Audio error: \(error.localizedDescription)")
            }
            isLoading = false
        }
    }

    func togglePlayback() {
        guard let player = audioPlayer else {
            print("[PlayerState] No player available")
            return
        }

        if isPlaying {
            player.pause()
            isPlaying = false
            stopPlaybackTimer()
            print("[PlayerState] Paused")
        } else {
            if player.play() {
                isPlaying = true
                startPlaybackTimer()
                print("[PlayerState] Resumed")
            }
        }
        NowPlayingManager.shared.updatePlaybackState(
            isPlaying: isPlaying,
            elapsed: currentTime,
            duration: duration > 0 ? duration : nil
        )
    }

    func seekTo(time: TimeInterval) {
        audioPlayer?.currentTime = time
        currentTime = time
        NowPlayingManager.shared.updatePlaybackState(
            isPlaying: isPlaying,
            elapsed: time,
            duration: duration > 0 ? duration : nil
        )
    }

    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        stopPlaybackTimer()

        artworkFetchTask?.cancel()
        artworkFetchTask = nil
        cachedArtworkUrl = nil
        cachedArtworkImage = nil
        NowPlayingManager.shared.clear()

        currentTrack = nil
        currentVersion = nil
        isPlaying = false
        isLoading = false
        currentTime = 0
        duration = 0
        lyrics = nil
    }

    func setLoading(track: Track) {
        isLoading = true
        currentTrack = track
    }

    // MARK: - Timer

    private func startPlaybackTimer() {
        stopPlaybackTimer()
        playbackTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self, let player = self.audioPlayer else { return }
                self.currentTime = player.currentTime

                // Vocal onset detection via audio metering
                if !self.introDetected {
                    player.updateMeters()
                    let power = player.averagePower(forChannel: 0)
                    self.updateOnsetDetection(power: power, time: self.currentTime)
                }

                // Check if playback ended
                if !player.isPlaying && self.currentTime >= self.duration - 0.1 {
                    self.isPlaying = false
                    self.currentTime = 0
                    self.stopPlaybackTimer()
                }

                NowPlayingManager.shared.updatePlaybackState(
                    isPlaying: self.isPlaying,
                    elapsed: self.currentTime,
                    duration: self.duration > 0 ? self.duration : nil
                )
            }
        }
    }

    // MARK: - Now Playing (Lockscreen) Wiring

    /// Push current track metadata to MPNowPlayingInfoCenter. Artwork is whatever
    /// we have cached so far (nil until fetchArtworkIfNeeded resolves), and the
    /// underlying updateMetadata leaves the existing artwork field intact when
    /// metadata.artwork is nil so the placeholder push doesn't clobber a later
    /// image push.
    private func pushNowPlayingMetadata() {
        guard let track = currentTrack else { return }
        let recipient = track.recipientName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let artist: String? = recipient.isEmpty ? nil : "For \(recipient)"
        let metadata = NowPlayingMetadata(
            title: track.title,
            artist: artist,
            artwork: cachedArtworkImage,
            artworkURL: currentNowPlayingArtworkURL()
        )
        NowPlayingManager.shared.updateMetadata(
            metadata,
            duration: duration > 0 ? duration : nil
        )
    }

    /// Fetch the per-song artwork bitmap on a background task and re-push
    /// MPNowPlayingInfoCenter metadata once it arrives. Cancels any in-flight
    /// fetch from a prior track.
    private func fetchArtworkIfNeeded() {
        artworkFetchTask?.cancel()
        guard let urlString = currentNowPlayingArtworkURLString(),
              let url = URL(string: urlString) else {
            cachedArtworkUrl = nil
            cachedArtworkImage = nil
            return
        }
        if cachedArtworkUrl == urlString, cachedArtworkImage != nil {
            // Already loaded for this URL — just re-push to ensure it's live.
            pushNowPlayingMetadata()
            return
        }
        cachedArtworkUrl = urlString
        cachedArtworkImage = nil
        artworkFetchTask = Task { [weak self] in
            do {
                var request = URLRequest(url: url)
                request.cachePolicy = .returnCacheDataElseLoad
                request.timeoutInterval = 10
                let (data, _) = try await URLSession.shared.data(for: request)
                if Task.isCancelled { return }
                guard let image = UIImage(data: data) else { return }
                guard let self else { return }
                // Drop the result if the user switched tracks while we were fetching.
                guard self.cachedArtworkUrl == urlString else { return }
                self.cachedArtworkImage = image
                self.pushNowPlayingMetadata()
            } catch {
                // Quietly fall through — title/artist already pushed
            }
        }
    }

    private func currentNowPlayingArtworkURLString() -> String? {
        currentTrack?.artworkUrl
            ?? currentVersion?.nowPlayingArtworkUrl
            ?? currentTrack?.nowPlayingArtworkUrl
    }

    private func currentNowPlayingArtworkURL() -> URL? {
        currentNowPlayingArtworkURLString().flatMap(URL.init(string:))
    }

    private func configureRemoteCommands() {
        NowPlayingManager.shared.configureRemoteCommands(
            onPlay: { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self, !self.isPlaying else { return }
                    self.togglePlayback()
                }
            },
            onPause: { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self, self.isPlaying else { return }
                    self.togglePlayback()
                }
            },
            onToggle: { [weak self] in
                Task { @MainActor [weak self] in self?.togglePlayback() }
            },
            onSeek: { [weak self] time in
                Task { @MainActor [weak self] in self?.seekTo(time: time) }
            }
        )
    }

    private func stopPlaybackTimer() {
        playbackTimer?.invalidate()
        playbackTimer = nil
    }

    // MARK: - Vocal Onset Detection

    private func updateOnsetDetection(power: Float, time: TimeInterval) {
        if time < 1.0 {
            // Collect baseline power during first second (instrumental intro)
            baselinePowerSamples.append(power)
        } else {
            if !baselineReady {
                if !baselinePowerSamples.isEmpty {
                    baselinePower = baselinePowerSamples.reduce(0, +) / Float(baselinePowerSamples.count)
                }
                baselineReady = true
                baselinePowerSamples = []
            }

            // Detect sustained power increase above baseline (vocals are louder)
            if power > baselinePower + 8.0 {
                consecutiveOnsetFrames += 1
                if consecutiveOnsetFrames >= 9 { // ~300ms at 30fps
                    detectedIntroEnd = max(0, time - 0.3)
                    introDetected = true
                }
            } else {
                consecutiveOnsetFrames = 0
            }
        }

        // Safety: stop trying after 20s -- fall back to heuristic
        if time > 20.0 {
            introDetected = true
        }
    }

    // MARK: - Audio Interruption Handling

    @ObservationIgnored private var interruptionObserver: NSObjectProtocol?

    func setupInterruptionHandling() {
        // Idempotent: tear down any prior observer before re-registering.
        // Without this, a second call (e.g., MainTabView re-creation after
        // sign-out → sign-in) would orphan the previous observer in
        // NotificationCenter — leaking memory and causing the old closure
        // to fire on every interruption forever.
        if let existing = interruptionObserver {
            NotificationCenter.default.removeObserver(existing)
            interruptionObserver = nil
        }

        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            guard let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

            if type == .began {
                Task { @MainActor [weak self] in
                    self?.pausePlayback()
                }
            }
        }
    }

    func pausePlayback() {
        audioPlayer?.pause()
        isPlaying = false
        stopPlaybackTimer()
        NowPlayingManager.shared.updatePlaybackState(
            isPlaying: false,
            elapsed: currentTime,
            duration: duration > 0 ? duration : nil
        )
    }

    nonisolated deinit {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
