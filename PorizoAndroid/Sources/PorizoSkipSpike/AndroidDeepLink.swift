import Foundation
import Observation
import SkipFuse

/// Bridges an incoming deep link to the mounted root view at any lifecycle
/// timing (cold / warm-from-background / warm-while-active — the last has no
/// scenePhase transition to pull on).
///
/// Skip caveat (verified on-device): neither `.onChange(of:)` on a nested
/// @Observable's property nor a foreign singleton assigned to `@State` reliably
/// fires the observer here. So instead of a reactive signal, the view registers
/// a direct main-actor callback (`onLink`); `onOpenURL` invokes it, which
/// mutates the view's own @State route synchronously. Simple and lifecycle-proof.
@MainActor
enum AndroidDeepLinkInbox {
    /// The mounted root view's consume closure. Called by onOpenURL.
    static var onLink: (() -> Void)?
}

enum AndroidDeepLinkRoute: Equatable, Sendable {
    case share(String)
    case receiverHandoff(String)
    case poem(String)
    case poemShare(String)
    case unknown(String)

    var routeLabel: String {
        switch self {
        case .share(let id):
            return "Share \(id)"
        case .receiverHandoff(let id):
            return "Receiver handoff \(id)"
        case .poem(let id):
            return "Poem \(id)"
        case .poemShare(let id):
            return "Poem share \(id)"
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

        // Custom scheme: porizo://<host>/<id> — the host names the route.
        if components.scheme == "porizo" {
            let id = components.path.split(separator: "/").first.map(String.init) ?? ""
            guard !id.isEmpty else { return .unknown(rawURL) }
            switch components.host {
            case "receiver-handoff": return .receiverHandoff(id)
            case "poem-share": return .poemShare(id)
            case "s", "play", "share": return .share(id)
            case "poem": return .poem(id)
            default: return .unknown(rawURL)
            }
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
        case "poem-share":
            return .poemShare(parts[1])
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
