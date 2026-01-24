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

    init(title: String, artist: String? = nil, artwork: UIImage? = nil) {
        self.title = title
        self.artist = artist
        self.artwork = artwork
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

    func updateMetadata(_ metadata: NowPlayingMetadata, duration: Double? = nil) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = metadata.title
        if let artist = metadata.artist {
            info[MPMediaItemPropertyArtist] = artist
        }
        if let duration {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        if let artworkImage = metadata.artwork {
            let artwork = MPMediaItemArtwork(boundsSize: artworkImage.size) { _ in artworkImage }
            info[MPMediaItemPropertyArtwork] = artwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func updatePlaybackState(isPlaying: Bool, elapsed: Double, duration: Double? = nil) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        if let duration {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}
