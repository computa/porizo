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
}

/// Production conformance: reads from LocalCache.shared.
struct LiveLaunchFlashContentSource: LaunchFlashContentSource {
    func loadTracks() -> [Track] {
        LocalCache.shared.loadTracks()?.data ?? []
    }
}
