import Foundation

struct V2Message: Identifiable, Equatable, Codable {
    let id: UUID
    let role: Role
    let content: String
    let action: V2Action?
    let suggestions: [String]?
    let slotGuidance: StorySlotGuidance?
    let timestamp: Date

    enum Role: String, Codable {
        case user
        case ai
    }

    init(
        role: Role,
        content: String,
        action: V2Action? = nil,
        suggestions: [String]? = nil,
        slotGuidance: StorySlotGuidance? = nil
    ) {
        self.id = UUID()
        self.role = role
        self.content = content
        self.action = action
        self.suggestions = suggestions
        self.slotGuidance = slotGuidance
        self.timestamp = Date()
    }
}
