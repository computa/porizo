//
//  CreateFlowStore.swift
//  PorizoApp
//
//  Persists in-flight creation state for resume after app restarts.
//

import Foundation

struct CreateFlowResumeState: Codable {
    let kind: CreateFlowKind
    let step: CreateFlowState
    let storyId: String?
    let trackId: String?
    let versionNum: Int?
    let updatedAt: Date
}

final class CreateFlowStore {
    static let shared = CreateFlowStore()

    private let fileURL: URL
    private let queue = DispatchQueue(label: "com.porizo.createflow.store")
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = baseURL.appendingPathComponent("Porizo", isDirectory: true)
        self.fileURL = directory.appendingPathComponent("create-flow.json")
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    func load() -> CreateFlowResumeState? {
        queue.sync {
            guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
            do {
                let data = try Data(contentsOf: fileURL)
                return try decoder.decode(CreateFlowResumeState.self, from: data)
            } catch {
                return nil
            }
        }
    }

    func save(_ state: CreateFlowResumeState) {
        queue.async {
            do {
                let directory = self.fileURL.deletingLastPathComponent()
                if !FileManager.default.fileExists(atPath: directory.path) {
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                }
                let data = try self.encoder.encode(state)
                try data.write(to: self.fileURL, options: [.atomic])
            } catch {
                // Ignore persistence errors
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
