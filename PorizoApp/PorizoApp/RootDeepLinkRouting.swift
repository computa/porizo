import Foundation

func emailVerificationToken(from url: URL) -> String? {
    guard url.host == "verify-email" || url.path.hasPrefix("/verify-email") else {
        return nil
    }

    return URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?.first(where: { $0.name == "token" })?.value
}

struct CreateDeepLinkContext: Equatable, Sendable {
    let type: CreateFlowKind
    let occasion: Occasion?
    let recipientName: String?
}

enum ShareDeepLinkRoute: Equatable {
    case present
    case authenticate(message: String)
}

func resolveShareDeepLinkRoute(isPoem: Bool, canPresentClaim: Bool) -> ShareDeepLinkRoute {
    if canPresentClaim {
        return .present
    }
    return .authenticate(
        message: isPoem
            ? "Sign in to read your shared poem"
            : "Sign in to listen to your shared song"
    )
}

func parseCreateDeepLink(from url: URL) -> CreateDeepLinkContext? {
    guard url.host == "create" || url.pathComponents.contains("create") else {
        return nil
    }

    let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func queryValue(_ names: String...) -> String? {
        for name in names {
            if let value = queryItems.first(where: { $0.name == name })?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !value.isEmpty {
                return value
            }
        }
        return nil
    }

    let typeRaw = queryValue("type", "kind")?.lowercased()
    let type = typeRaw.flatMap(CreateFlowKind.init(rawValue:)) ?? .song
    let occasion = queryValue("occasion").flatMap(occasionFromDeepLinkValue)
    let recipientName = queryValue("recipient", "recipient_name", "name")

    return CreateDeepLinkContext(
        type: type,
        occasion: occasion,
        recipientName: recipientName
    )
}

func parseReceiverHandoffPayload(from url: URL) -> ReceiverDeepLinkPayload? {
    let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func queryValue(_ names: String...) -> String? {
        for name in names {
            if let value = queryItems.first(where: { $0.name == name })?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !value.isEmpty {
                return value
            }
        }
        return nil
    }

    let pathComponents = url.pathComponents.filter { $0 != "/" }
    let handoffFromHostPath: String? = {
        if url.host == "receiver-handoff" {
            return pathComponents.first
        }
        if pathComponents.first == "receiver-handoff", pathComponents.count > 1 {
            return pathComponents[1]
        }
        return nil
    }()
    let handoffId = handoffFromHostPath
        ?? queryValue("receiver_handoff_id", "handoff_id", "deep_link_value")

    return ReceiverDeepLinkService.payload(
        receiverHandoffId: handoffId,
        receiverSessionId: queryValue("receiver_session_id", "deep_link_sub1"),
        contentKind: queryValue("content_kind", "deep_link_sub2")
    )
}

private func occasionFromDeepLinkValue(_ value: String) -> Occasion? {
    let normalized = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "'", with: "")
        .replacingOccurrences(of: " ", with: "_")
        .replacingOccurrences(of: "-", with: "_")

    switch normalized {
    case "mothersday", "mothers_day", "mother_day":
        return .mothersDay
    default:
        return Occasion(rawValue: normalized)
            ?? Occasion.allCases.first { $0.displayName.lowercased() == value.lowercased() }
    }
}
