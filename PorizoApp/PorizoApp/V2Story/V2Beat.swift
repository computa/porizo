import Foundation

struct V2Beat: Identifiable, Equatable, Codable {
    let id: String
    let name: String
    let displayName: String
    let purpose: String
    let strength: Double
    let isRequired: Bool

    var isFilled: Bool { strength >= 0.7 }

    var strengthDots: Int {
        Int((strength * 5).rounded())
    }

    static func defaultBeats(turnCount: Int, completionScore: Int) -> [V2Beat] {
        let progress = Double(completionScore) / 100.0
        let turnsNormalized = min(Double(turnCount) / 5.0, 1.0)

        return [
            V2Beat(
                id: "setting",
                name: "setting",
                displayName: "The Setting",
                purpose: "Where and when the story takes place",
                strength: min(turnsNormalized * 1.2, 1.0),
                isRequired: true
            ),
            V2Beat(
                id: "feeling",
                name: "feeling",
                displayName: "The Feeling",
                purpose: "The emotional core of the story",
                strength: progress * 0.9,
                isRequired: true
            ),
            V2Beat(
                id: "bond",
                name: "bond",
                displayName: "Your Bond",
                purpose: "What makes your relationship special",
                strength: progress * 1.1 > 1.0 ? 1.0 : progress * 1.1,
                isRequired: true
            ),
            V2Beat(
                id: "moment",
                name: "moment",
                displayName: "The Moment",
                purpose: "A specific memorable moment",
                strength: turnsNormalized > 0.4 ? progress : turnsNormalized,
                isRequired: false
            ),
            V2Beat(
                id: "details",
                name: "details",
                displayName: "The Details",
                purpose: "Specific details that make it personal",
                strength: max(0, progress - 0.2),
                isRequired: false
            )
        ]
    }
}
