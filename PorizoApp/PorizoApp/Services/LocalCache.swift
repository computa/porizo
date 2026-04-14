//
//  LocalCache.swift
//  PorizoApp
//
//  Lightweight JSON cache for lists and resume state.
//

import Foundation

struct CacheEnvelope<T: Codable>: Codable {
    let savedAt: Date
    let data: T
}

final class LocalCache {
    static let shared = LocalCache()

    private let queue = DispatchQueue(label: "com.porizo.localcache")
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let baseURL: URL

    private init() {
        baseURL = URL.cachesDirectory.appendingPathComponent("PorizoCache", isDirectory: true)
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    func loadTracks() -> CacheEnvelope<[Track]>? {
        loadEnvelope(name: "tracks.json")
    }

    func saveTracks(_ tracks: [Track]) {
        saveEnvelope(name: "tracks.json", data: tracks)
    }

    func invalidateTracks() {
        invalidateCache(name: "tracks.json")
        invalidateCache(name: "track-playable-audio-urls.json")
    }

    func loadPlayableAudioURLMap() -> [String: String]? {
        loadEnvelope(name: "track-playable-audio-urls.json")?.data
    }

    func playableAudioURL(for trackId: String) -> URL? {
        guard let urlString = loadPlayableAudioURLMap()?[trackId] else { return nil }
        return URL(string: urlString)
    }

    func savePlayableAudioURL(_ urlString: String, for trackId: String) {
        queue.async {
            do {
                if !FileManager.default.fileExists(atPath: self.baseURL.path()) {
                    try FileManager.default.createDirectory(
                        at: self.baseURL,
                        withIntermediateDirectories: true
                    )
                }
                let url = self.baseURL.appendingPathComponent("track-playable-audio-urls.json")
                var map: [String: String] = [:]
                if FileManager.default.fileExists(atPath: url.path()) {
                    let existingData = try Data(contentsOf: url)
                    if let envelope = try? self.decoder.decode(CacheEnvelope<[String: String]>.self, from: existingData) {
                        map = envelope.data
                    }
                }
                map[trackId] = urlString
                let envelope = CacheEnvelope(savedAt: Date.now, data: map)
                let encoded = try self.encoder.encode(envelope)
                try encoded.write(to: url, options: [.atomic])
            } catch {
                // Ignore cache failures to avoid blocking UX.
            }
        }
    }

    func loadPoems() -> CacheEnvelope<[Poem]>? {
        loadEnvelope(name: "poems.json")
    }

    func savePoems(_ poems: [Poem]) {
        saveEnvelope(name: "poems.json", data: poems)
    }

    func invalidatePoems() {
        invalidateCache(name: "poems.json")
    }

    private func invalidateCache(name: String) {
        queue.async {
            let url = self.baseURL.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func loadEnvelope<T: Codable>(name: String) -> CacheEnvelope<T>? {
        queue.sync {
            let url = baseURL.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path()) else { return nil }
            do {
                let data = try Data(contentsOf: url)
                return try decoder.decode(CacheEnvelope<T>.self, from: data)
            } catch {
                print("[LocalCache] Read failed for key: \(error.localizedDescription)")
                return nil
            }
        }
    }

    private func saveEnvelope<T: Codable>(name: String, data: T) {
        queue.async {
            do {
                if !FileManager.default.fileExists(atPath: self.baseURL.path()) {
                    try FileManager.default.createDirectory(
                        at: self.baseURL,
                        withIntermediateDirectories: true
                    )
                }
                let envelope = CacheEnvelope(savedAt: Date.now, data: data)
                let encoded = try self.encoder.encode(envelope)
                let url = self.baseURL.appendingPathComponent(name)
                try encoded.write(to: url, options: [.atomic])
            } catch {
                // Ignore cache failures to avoid blocking UX.
            }
        }
    }
}
