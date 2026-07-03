import Foundation

/// Pure push-payload routing (U14), ported from iOS PushPayloadParser. Parses a
/// notification payload JSON string (OneSignal `additionalData`) into a route.
/// Delivery is external (OneSignal dashboard, R-2); this decision is unit-tested.
enum AndroidPushRouting {

    /// Where a notification tap should take the user.
    enum Route: Equatable {
        case trackReveal(trackId: String)  // render_complete → open that track
        case informational                 // recipient_played → no navigation
    }

    /// Parse a push payload JSON string into a route, or nil when it's not a
    /// recognized/actionable notification.
    static func route(fromJSON json: String) -> Route? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else {
            return nil
        }
        switch type {
        case "render_complete":
            guard let trackId = object["trackId"] as? String, !trackId.isEmpty else { return nil }
            return .trackReveal(trackId: trackId)
        case "recipient_played":
            return .informational
        default:
            return nil
        }
    }
}

/// Persists a tapped notification's payload JSON across the native-callback →
/// view boundary (same UserDefaults pattern as AndroidDeepLinkStore, which
/// survives Skip's split-compile where a mutable global does not). The view
/// consumes it after the deep-link inbox pings it.
struct AndroidPushTapStore: Sendable {
    private static let key = "porizo_android_pending_push"

    func save(payloadJSON: String) {
        UserDefaults.standard.set(payloadJSON, forKey: Self.key)
    }
    func consume() -> AndroidPushRouting.Route? {
        guard let json = UserDefaults.standard.string(forKey: Self.key), !json.isEmpty else {
            return nil
        }
        UserDefaults.standard.removeObject(forKey: Self.key)
        return AndroidPushRouting.route(fromJSON: json)
    }
}
