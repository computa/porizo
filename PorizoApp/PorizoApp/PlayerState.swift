import SwiftUI
import AVFoundation
import Observation

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
    }

    func seekTo(time: TimeInterval) {
        audioPlayer?.currentTime = time
        currentTime = time
    }

    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        stopPlaybackTimer()

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
            }
        }
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
    }

    nonisolated deinit {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
