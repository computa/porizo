import Foundation

struct ReceiverDeepLinkPayload: Equatable, Sendable {
    let receiverHandoffId: String
    let receiverSessionId: String?
    let contentKind: String
}

struct ReceiverClaimDraft: Codable, Equatable, Sendable {
    let claimToken: String
    let receiverSessionId: String?
    let contentKind: String
    let expiresAt: String?
}

extension Notification.Name {
    static let receiverDeepLinkResolved = Notification.Name("receiverDeepLinkResolved")
}

enum ReceiverDeepLinkService {
    @MainActor private static var pendingPayload: ReceiverDeepLinkPayload?

    static func post(_ payload: ReceiverDeepLinkPayload) {
        Task { @MainActor in
            pendingPayload = payload
            NotificationCenter.default.post(
                name: .receiverDeepLinkResolved,
                object: nil,
                userInfo: payload.userInfo
            )
        }
    }

    @MainActor
    static func consumePendingPayload() -> ReceiverDeepLinkPayload? {
        defer { pendingPayload = nil }
        return pendingPayload
    }

    static func payload(from userInfo: [AnyHashable: Any]) -> ReceiverDeepLinkPayload? {
        guard let handoffId = (userInfo["receiverHandoffId"] as? String)?.nilIfEmpty else {
            return nil
        }
        return payload(
            receiverHandoffId: handoffId,
            receiverSessionId: userInfo["receiverSessionId"] as? String,
            contentKind: userInfo["contentKind"] as? String
        )
    }

    static func payload(
        receiverHandoffId: String?,
        receiverSessionId: String?,
        contentKind: String?
    ) -> ReceiverDeepLinkPayload? {
        guard let handoffId = receiverHandoffId?.nilIfEmpty else { return nil }
        return ReceiverDeepLinkPayload(
            receiverHandoffId: handoffId,
            receiverSessionId: receiverSessionId?.nilIfEmpty,
            contentKind: contentKind == "poem" ? "poem" : "song"
        )
    }
}

enum ReceiverClaimDraftStore {
    private static let key = "pending_receiver_claim_draft"

    static func save(_ draft: ReceiverClaimDraft) {
        guard let data = try? JSONEncoder().encode(draft) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static func load() -> ReceiverClaimDraft? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let draft = try? JSONDecoder().decode(ReceiverClaimDraft.self, from: data) else {
            return nil
        }
        if draft.isExpired {
            clear()
            return nil
        }
        return draft
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}

private extension ReceiverDeepLinkPayload {
    var userInfo: [String: String] {
        [
            "receiverHandoffId": receiverHandoffId,
            "receiverSessionId": receiverSessionId ?? "",
            "contentKind": contentKind
        ]
    }
}

private extension ReceiverClaimDraft {
    var isExpired: Bool {
        guard let expiresAt,
              let expiry = try? Date(expiresAt, strategy: .iso8601) else {
            return false
        }
        return expiry <= Date()
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
