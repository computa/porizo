import Foundation
import Observation
import SkipFuse

/// A track the player can load. Kept minimal and value-typed so both the
/// library rows (PorizoTrackSummary) and the create-flow reveal can build one.
struct AndroidPlayableTrack: Equatable, Sendable {
    let id: String
    let title: String
    let recipientName: String?
    let artworkURL: String?
    /// Stream URL (relative or absolute). For owned content this is the
    /// track's preview/full URL; for shared content it is the pre-signed URL.
    let streamURL: String
    /// Whether the stream is owned (Bearer auth) or pre-signed (no auth).
    let isOwnedContent: Bool
}

/// Shared, app-wide playback state (U3, KTD4 exception).
///
/// One instance is injected at the ContentView root so the mini-player persists
/// across tabs and the NowPlaying sheet reflects the same state — mirroring iOS
/// `PlayerState` + `MiniPlayerBar` + `NowPlayingView`.
@MainActor
@Observable
final class AndroidPlayerModel {
    private(set) var currentTrack: AndroidPlayableTrack?
    private(set) var isPlaying: Bool = false
    /// Playback position in seconds.
    private(set) var positionSeconds: Double = 0
    /// Total duration in seconds (0 until known).
    private(set) var durationSeconds: Double = 0
    private(set) var lastError: String?

    /// Fraction 0...1 of the track elapsed; 0 when duration is unknown.
    var progressFraction: Double {
        guard durationSeconds > 0 else { return 0 }
        return min(1, max(0, positionSeconds / durationSeconds))
    }

    var hasTrack: Bool { currentTrack != nil }

    private let player: AudioPlaybackEngine
    /// Supplies the current access token for owned-content Bearer auth.
    private let accessTokenProvider: () -> String?
    private var pollTimer: Timer?

    init(
        player: AudioPlaybackEngine = AndroidAudioPlayerProvider(),
        accessTokenProvider: @escaping () -> String? = { nil }
    ) {
        self.player = player
        self.accessTokenProvider = accessTokenProvider
    }

    /// Load and start playing a track. Replaces any current track.
    func play(_ track: AndroidPlayableTrack) {
        let headers: [String: String]
        if track.isOwnedContent, let token = accessTokenProvider() {
            headers = AndroidAudioPlayerProvider.ownedContentHeaders(accessToken: token)
        } else {
            headers = AndroidAudioPlayerProvider.sharedContentHeaders()
        }

        switch player.prepare(url: track.streamURL, headers: headers) {
        case .success:
            currentTrack = track
            positionSeconds = 0
            durationSeconds = 0
            lastError = nil
            player.play()
            isPlaying = true
            startPolling()
        case .failure(let error):
            lastError = error.description
            isPlaying = false
        }
    }

    /// Toggle play/pause for the loaded track. No-op if nothing is loaded.
    func toggle() {
        guard hasTrack else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
            startPolling()
        }
    }

    /// Seek to a fraction (0...1) of the current track's duration.
    func seek(toFraction fraction: Double) {
        guard durationSeconds > 0 else { return }
        let clamped = min(1, max(0, fraction))
        let ms = Int(clamped * durationSeconds * 1000)
        player.seek(toMs: ms)
        positionSeconds = clamped * durationSeconds
    }

    /// Stop playback and clear the current track (hides the mini-player).
    func clear() {
        stopPolling()
        player.release()
        currentTrack = nil
        isPlaying = false
        positionSeconds = 0
        durationSeconds = 0
    }

    /// Pull the latest position/duration/isPlaying from the native adapter.
    /// Exposed for the poll timer and for tests (deterministic, no timer needed).
    func refreshFromPlayer() {
        positionSeconds = Double(player.currentPositionMs()) / 1000.0
        let dur = Double(player.durationMs()) / 1000.0
        if dur > 0 { durationSeconds = dur }
        isPlaying = player.isPlaying()
        if !isPlaying { stopPolling() }
    }

    private func startPolling() {
        stopPolling()
        let timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshFromPlayer()
            }
        }
        pollTimer = timer
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}
