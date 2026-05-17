//
//  NowPlayingManager.swift
//  PorizoApp
//
//  Handles lock-screen Now Playing metadata and remote transport controls.
//

import Foundation
import MediaPlayer
import UIKit

struct NowPlayingMetadata {
    let title: String
    let artist: String?
    let artwork: UIImage?
    let artworkURL: URL?

    init(title: String, artist: String? = nil, artwork: UIImage? = nil, artworkURL: URL? = nil) {
        self.title = title
        self.artist = artist
        self.artwork = artwork
        self.artworkURL = artworkURL
    }

    init(title: String, artist: String? = nil, artworkURLString: String?) {
        self.title = title
        self.artist = artist
        self.artwork = nil
        self.artworkURL = artworkURLString.flatMap(URL.init(string:))
    }
}

@MainActor
final class NowPlayingManager {
    static let shared = NowPlayingManager()

    private var isConfigured = false
    private var onPlay: (() -> Void)?
    private var onPause: (() -> Void)?
    private var onToggle: (() -> Void)?
    private var onSeek: ((Double) -> Void)?
    private var artworkTask: Task<Void, Never>?
    private var activeArtworkURL: URL?
    private var artworkCache: [URL: UIImage] = [:]
    private weak var activeSession: MPNowPlayingSession?

    private init() {}

    func configureRemoteCommands(
        onPlay: @escaping () -> Void,
        onPause: @escaping () -> Void,
        onToggle: @escaping () -> Void,
        onSeek: @escaping (Double) -> Void
    ) {
        self.onPlay = onPlay
        self.onPause = onPause
        self.onToggle = onToggle
        self.onSeek = onSeek

        guard !isConfigured else { return }
        isConfigured = true

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.isEnabled = true
        UIApplication.shared.beginReceivingRemoteControlEvents()

        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.onPlay?()
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.onPause?()
            return .success
        }
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onToggle?()
            return .success
        }
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.onSeek?(event.positionTime)
            return .success
        }
    }

    func activateSession(_ session: MPNowPlayingSession) {
        activeSession = session
        session.automaticallyPublishesNowPlayingInfo = false
        syncActiveSession()
        session.becomeActiveIfPossible { didBecomeActive in
            #if DEBUG
            print("[NowPlayingManager] MPNowPlayingSession active=\(didBecomeActive)")
            #endif
        }
    }

    func deactivateSession(_ session: MPNowPlayingSession) {
        guard activeSession === session else { return }
        activeSession = nil
    }

    func updateMetadata(_ metadata: NowPlayingMetadata, duration: Double? = nil) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = metadata.title
        if let artist = metadata.artist {
            info[MPMediaItemPropertyArtist] = artist
            // Some iOS lockscreen presentations key off albumTitle. Reusing the
            // artist string ("For Chioma") keeps the metadata bundle complete
            // without inventing a fake album name.
            info[MPMediaItemPropertyAlbumTitle] = artist
        }
        info[MPMediaItemPropertyAlbumArtist] = "Porizo"
        // Tell the system this is on-demand music, not a live stream — this is
        // what iOS uses to decide whether to offer the rich lockscreen treatment
        // (ambient album-art background on iOS 18+, expanded NowPlaying card).
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPNowPlayingInfoPropertyIsLiveStream] = false
        if let duration {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        applyArtwork(from: metadata, to: &info)
        publish(info)
    }

    func updatePlaybackState(isPlaying: Bool, elapsed: Double, duration: Double? = nil) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        if let duration {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        publish(info)
        publishPlaybackState(isPlaying ? .playing : .paused)
    }

    func clear() {
        artworkTask?.cancel()
        artworkTask = nil
        activeArtworkURL = nil
        publishPlaybackState(.stopped)
        publish(nil)
    }

    private func publish(_ info: [String: Any]?) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        activeSession?.nowPlayingInfoCenter.nowPlayingInfo = info
    }

    private func publishPlaybackState(_ state: MPNowPlayingPlaybackState) {
        MPNowPlayingInfoCenter.default().playbackState = state
        activeSession?.nowPlayingInfoCenter.playbackState = state
    }

    private func syncActiveSession() {
        activeSession?.nowPlayingInfoCenter.nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo
        activeSession?.nowPlayingInfoCenter.playbackState = MPNowPlayingInfoCenter.default().playbackState
    }

    private func applyArtwork(from metadata: NowPlayingMetadata, to info: inout [String: Any]) {
        if let image = metadata.artwork {
            artworkTask?.cancel()
            artworkTask = nil
            activeArtworkURL = metadata.artworkURL
            setArtworkImage(image, in: &info)
            return
        }

        guard let url = metadata.artworkURL else {
            artworkTask?.cancel()
            artworkTask = nil
            activeArtworkURL = nil
            info.removeValue(forKey: MPMediaItemPropertyArtwork)
            return
        }

        if let cached = artworkCache[url] {
            activeArtworkURL = url
            setArtworkImage(cached, in: &info)
            return
        }

        if activeArtworkURL != url {
            artworkTask?.cancel()
            activeArtworkURL = url
            info.removeValue(forKey: MPMediaItemPropertyArtwork)
            fetchArtwork(from: url)
        }
    }

    private func setArtworkImage(_ artworkImage: UIImage, in info: inout [String: Any]) {
        // Honor the requested boundsSize by re-rendering: iOS asks for different
        // sizes for the compact tile and the expanded lock-screen presentation.
        let artwork = MPMediaItemArtwork(boundsSize: artworkImage.size) { requested in
            guard requested.width > 0, requested.height > 0 else { return artworkImage }
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = UIScreen.main.scale
            let renderer = UIGraphicsImageRenderer(size: requested, format: format)
            return renderer.image { _ in
                artworkImage.draw(in: CGRect(origin: .zero, size: requested))
            }
        }
        info[MPMediaItemPropertyArtwork] = artwork
    }

    private func fetchArtwork(from url: URL) {
        artworkTask = Task {
            do {
                var request = URLRequest(url: url)
                request.cachePolicy = .returnCacheDataElseLoad
                request.timeoutInterval = 10
                let (data, _) = try await URLSession.shared.data(for: request)
                if Task.isCancelled { return }
                guard let image = UIImage(data: data) else { return }
                await MainActor.run {
                    guard self.activeArtworkURL == url else { return }
                    self.artworkCache[url] = image
                    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                    self.setArtworkImage(image, in: &info)
                    self.publish(info)
                }
            } catch {
                // Keep title/artist controls alive if artwork cannot be fetched.
            }
        }
    }
}
