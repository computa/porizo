//
//  LaunchFlashContentSource.swift
//  PorizoApp
//
//  Protocol abstraction over LocalCache for the resolver.
//  Enables dependency injection in unit tests.
//

import Foundation

protocol LaunchFlashContentSource {
    /// Returns the cached track list, or empty array if no cache exists.
    /// Synchronous — must be safe to call on any queue.
    func loadTracks() -> [Track]

    /// Returns a locally cached resolved playable audio URL for a track, if any.
    func loadPlayableAudioURL(for trackId: String) -> URL?
}

/// Production conformance: reads from LocalCache.shared.
struct LiveLaunchFlashContentSource: LaunchFlashContentSource {
    func loadTracks() -> [Track] {
        LocalCache.shared.loadTracks()?.data ?? []
    }

    func loadPlayableAudioURL(for trackId: String) -> URL? {
        LocalCache.shared.playableAudioURL(for: trackId)
    }
}
