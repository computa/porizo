import Foundation

enum AndroidDeepLinkRoute: Equatable, Sendable {
    case share(String)
    case receiverHandoff(String)
    case poem(String)
    case unknown(String)

    var routeLabel: String {
        switch self {
        case .share(let id):
            return "Share \(id)"
        case .receiverHandoff(let id):
            return "Receiver handoff \(id)"
        case .poem(let id):
            return "Poem \(id)"
        case .unknown(let rawURL):
            return "Unsupported link: \(rawURL)"
        }
    }
}

struct AndroidDeepLinkParser: Sendable {
    func parse(_ rawURL: String) -> AndroidDeepLinkRoute {
        guard let components = URLComponents(string: rawURL) else {
            return .unknown(rawURL)
        }

        if components.scheme == "porizo", components.host == "receiver-handoff" {
            let id = components.path.split(separator: "/").first.map(String.init) ?? ""
            return id.isEmpty ? .unknown(rawURL) : .receiverHandoff(id)
        }

        guard components.scheme == "https", components.host == AndroidAppConfig.shareHost else {
            return .unknown(rawURL)
        }

        let parts = components.path.split(separator: "/").map(String.init)
        guard parts.count >= 2 else {
            return .unknown(rawURL)
        }

        switch parts[0] {
        case "s", "play":
            return .share(parts[1])
        case "poem":
            return .poem(parts[1])
        case "receiver-handoff":
            return .receiverHandoff(parts[1])
        default:
            return .unknown(rawURL)
        }
    }
}

struct AndroidDeepLinkStore: Sendable {
    private static let pendingURLKey = "porizo_android_pending_deep_link"

    func save(rawURL: String) {
        UserDefaults.standard.set(rawURL, forKey: Self.pendingURLKey)
    }

    func consume() -> AndroidDeepLinkRoute? {
        guard let rawURL = UserDefaults.standard.string(forKey: Self.pendingURLKey), !rawURL.isEmpty else {
            return nil
        }
        UserDefaults.standard.removeObject(forKey: Self.pendingURLKey)
        return AndroidDeepLinkParser().parse(rawURL)
    }
}
