import Foundation
import Observation

struct AppClipGift {
    let shareId: String
    let title: String
    let senderName: String?
    let artworkURL: URL?
    let appDownloadURL: URL?
}

@MainActor
@Observable
final class AppClipReceiverModel {
    private(set) var gift: AppClipGift?
    private(set) var errorMessage: String?
    private(set) var isPreparingHandoff = false

    private let api = AppClipAPI()
    private var invocationURL: URL?
    private var session: ReceiverSession?

    var fullAppURL: URL? {
        session?.saveURL ?? gift?.appDownloadURL ?? URL(string: "https://porizo.co/download")
    }

    func load(invocationURL: URL) async {
        self.invocationURL = invocationURL
        errorMessage = nil
        do {
            let shareId = try Self.shareId(from: invocationURL)
            async let info = api.fetchGift(shareId: shareId)
            async let receiverSession = api.record(shareId: shareId, event: "receiver_link_opened", session: nil)
            let (gift, openedSession) = try await (info, receiverSession)
            self.gift = gift
            self.session = openedSession
        } catch {
            errorMessage = "This link could not be opened. Ask the sender for a fresh share link."
        }
    }

    func reload() async {
        guard let invocationURL else { return }
        await load(invocationURL: invocationURL)
    }

    func prepareFullAppHandoff() async -> URL? {
        guard let gift else { return fullAppURL }
        isPreparingHandoff = true
        defer { isPreparingHandoff = false }
        do {
            session = try await api.record(
                shareId: gift.shareId,
                event: "receiver_save_cta_clicked",
                session: session,
                placement: "app_clip_primary"
            )
        } catch {
            // Keep the generic download fallback available if attribution fails.
        }
        return fullAppURL
    }

    static func shareId(from url: URL) throws -> String {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let marker = parts.firstIndex(where: { $0 == "play" || $0 == "s" }), parts.indices.contains(marker + 1) else {
            throw URLError(.badURL)
        }
        return parts[marker + 1]
    }
}

private struct ShareResponse: Decodable {
    struct Track: Decodable {
        let title: String
        let senderName: String?
        let playerArtworkURL: URL?

        enum CodingKeys: String, CodingKey {
            case title
            case senderName = "sender_name"
            case playerArtworkURL = "player_artwork_url"
        }
    }

    let track: Track
    let appDownloadURL: URL?

    enum CodingKeys: String, CodingKey {
        case track
        case appDownloadURL = "app_download_url"
    }
}

private struct ReceiverSession: Decodable {
    let id: String
    let secret: String
    let saveURL: URL?

    enum CodingKeys: String, CodingKey {
        case id = "receiver_session_id"
        case secret = "receiver_session_secret"
        case saveURL = "receiver_save_url"
    }
}

private struct ReceiverEventBody: Encodable {
    let eventName: String
    let receiverSessionId: String?
    let receiverSessionSecret: String?
    let metadata: [String: String]

    enum CodingKeys: String, CodingKey {
        case eventName = "event_name"
        case receiverSessionId = "receiver_session_id"
        case receiverSessionSecret = "receiver_session_secret"
        case metadata
    }
}

private struct AppClipAPI {
    private let baseURL = URL(string: "https://porizo.co")!
    private let deviceId = UUID().uuidString

    func fetchGift(shareId: String) async throws -> AppClipGift {
        var request = URLRequest(url: baseURL.appending(path: "share/\(shareId)"))
        request.setValue(deviceId, forHTTPHeaderField: "x-device-id")
        request.setValue("ios", forHTTPHeaderField: "x-platform")
        request.setValue("PorizoAppClip/1", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response)
        let payload = try JSONDecoder().decode(ShareResponse.self, from: data)
        return AppClipGift(
            shareId: shareId,
            title: payload.track.title,
            senderName: payload.track.senderName,
            artworkURL: payload.track.playerArtworkURL,
            appDownloadURL: payload.appDownloadURL
        )
    }

    func record(
        shareId: String,
        event: String,
        session: ReceiverSession?,
        placement: String = "app_clip_open"
    ) async throws -> ReceiverSession {
        var request = URLRequest(url: baseURL.appending(path: "share/\(shareId)/receiver-session"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("PorizoAppClip/1", forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(ReceiverEventBody(
            eventName: event,
            receiverSessionId: session?.id,
            receiverSessionSecret: session?.secret,
            metadata: ["surface": "app_clip", "placement": placement]
        ))
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response)
        return try JSONDecoder().decode(ReceiverSession.self, from: data)
    }

    private func validate(_ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
