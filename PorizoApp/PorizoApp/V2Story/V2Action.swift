import Foundation

enum V2Action: String, CaseIterable, Identifiable, Codable {
    case ask = "ASK"
    case clarify = "CLARIFY"
    case confirm = "CONFIRM"
    case stop = "STOP"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .ask: return "Exploring"
        case .clarify: return "Clarifying"
        case .confirm: return "Confirming"
        case .stop: return "Complete"
        }
    }

    var iconName: String {
        switch self {
        case .ask: return "sparkles"
        case .clarify: return "magnifyingglass"
        case .confirm: return "checkmark.circle"
        case .stop: return "party.popper"
        }
    }
}
