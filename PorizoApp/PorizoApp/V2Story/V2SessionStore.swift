//
//  V2SessionStore.swift
//  PorizoApp
//
//  Persists the active V2 story session for resume after app restarts.
//

import Foundation

final class V2SessionStore: @unchecked Sendable {
    static let shared = V2SessionStore()

    private let fileURL: URL
    private let queue = DispatchQueue(label: "com.porizo.v2session.store")
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    private init() {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = baseURL.appendingPathComponent("Porizo", isDirectory: true)
        self.fileURL = directory.appendingPathComponent("v2-session.json")

        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .iso8601
    }

    func load() -> V2Session? {
        queue.sync {
            guard FileManager.default.fileExists(atPath: fileURL.path) else {
                return nil
            }
            do {
                let data = try Data(contentsOf: fileURL)
                return try decoder.decode(V2Session.self, from: data)
            } catch {
                return nil
            }
        }
    }

    func save(_ session: V2Session) {
        queue.async {
            do {
                let directory = self.fileURL.deletingLastPathComponent()
                if !FileManager.default.fileExists(atPath: directory.path) {
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                }
                let data = try self.encoder.encode(session)
                try data.write(to: self.fileURL, options: [.atomic])
            } catch {
                // Intentionally ignore persistence errors to avoid blocking UX
            }
        }
    }

    func clear() {
        queue.async {
            guard FileManager.default.fileExists(atPath: self.fileURL.path) else { return }
            try? FileManager.default.removeItem(at: self.fileURL)
        }
    }
}
