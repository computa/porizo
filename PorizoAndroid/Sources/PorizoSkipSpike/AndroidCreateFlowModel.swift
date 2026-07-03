import Foundation
import Observation
import SkipFuse

/// Song vs poem — chosen at the details step, drives which pipeline runs.
enum CreateContentType: String, CaseIterable, Identifiable, Sendable {
    case song
    case poem

    var id: String { rawValue }
    var label: String { self == .song ? "Song" : "Poem" }
}

/// The create wizard's high-level moment (U7 scaffold; U8-U10 fill the later
/// cases). Mirrors iOS WarmCanvasFlowView's moment machine.
enum CreateMoment: Equatable {
    case entry(EntryStep)
    case conversing   // U8
    case lyrics       // U9
    case wait         // U9
    case reveal       // U10
    case share        // U10

    enum EntryStep: Equatable {
        case name       // "Who's this song for?" / "What's their name?"
        case details    // occasion + song/poem
    }
}

/// Shared create-flow state (U7). @Observable + @MainActor.
@MainActor
@Observable
final class AndroidCreateFlowModel {
    private(set) var moment: CreateMoment = .entry(.name)

    /// Recipient name (typed or picked from contacts).
    var recipientName = ""
    /// Recipient phone when captured from contacts (enables one-tap send later).
    var recipientPhone: String?
    var occasion: Occasion = .birthday
    var contentType: CreateContentType = .song

    /// Whether the details step can advance (needs a recipient name).
    var canStartConversation: Bool {
        !recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Configure the flow before presenting (from an occasion chip / gift, etc.).
    func reset(occasion: Occasion? = nil, type: CreateContentType? = nil) {
        moment = .entry(.name)
        recipientName = ""
        recipientPhone = nil
        if let occasion { self.occasion = occasion }
        if let type { contentType = type }
    }

    /// Advance from the name step to the details step. Requires a name.
    func confirmName() {
        guard canStartConversation else { return }
        moment = .entry(.details)
    }

    /// Adopt a contact's name + phone and advance to details.
    func adoptContact(name: String, phone: String?) {
        recipientName = name
        recipientPhone = phone
        if canStartConversation { moment = .entry(.details) }
    }

    /// Advance from details into the AI conversation (U8 takes over here).
    func startConversation() {
        guard canStartConversation else { return }
        moment = .conversing
    }

    /// Step back from details to the name step.
    func backToName() {
        moment = .entry(.name)
    }
}
