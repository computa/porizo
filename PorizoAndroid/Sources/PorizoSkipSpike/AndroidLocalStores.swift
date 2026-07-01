import Foundation

struct PorizoCreateDraft: Codable, Equatable, Sendable {
    var recipientName: String
    var occasionRawValue: String
    var voiceSourceRawValue: String
    var tone: String
    var message: String
    var targetDuration: Double
    var includeNameHook: Bool
    var appOnlySave: Bool
    var updatedAt: String
}

struct PorizoPendingRender: Codable, Equatable, Sendable {
    var trackId: String
    var versionNum: Int
    var jobId: String
    var renderType: String
    var updatedAt: String
}

struct AndroidCreateDraftStore: Sendable {
    private static let draftKey = "porizo_android_create_draft"

    func load() -> PorizoCreateDraft? {
        guard let data = UserDefaults.standard.data(forKey: Self.draftKey) else {
            return nil
        }
        return try? JSONDecoder().decode(PorizoCreateDraft.self, from: data)
    }

    func save(_ draft: PorizoCreateDraft) {
        guard let data = try? JSONEncoder().encode(draft) else {
            return
        }
        UserDefaults.standard.set(data, forKey: Self.draftKey)
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.draftKey)
    }
}

struct AndroidRenderPollStore: Sendable {
    private static let pendingKey = "porizo_android_pending_render"

    func load() -> PorizoPendingRender? {
        guard let data = UserDefaults.standard.data(forKey: Self.pendingKey) else {
            return nil
        }
        return try? JSONDecoder().decode(PorizoPendingRender.self, from: data)
    }

    func save(_ pending: PorizoPendingRender) {
        guard let data = try? JSONEncoder().encode(pending) else {
            return
        }
        UserDefaults.standard.set(data, forKey: Self.pendingKey)
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.pendingKey)
    }
}
