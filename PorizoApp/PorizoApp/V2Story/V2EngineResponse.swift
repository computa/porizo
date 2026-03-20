import Foundation

struct V2EngineResponse: Identifiable, Equatable, Codable {
    let id: UUID
    let sessionId: String
    let action: V2Action
    let question: String?
    let confirmation: String?
    let narrative: String
    let completionScore: Int
    let beats: [V2Beat]
    let userModel: V2UserModel
    let turnCount: Int
    let fallback: Bool
    let slotGuidance: StorySlotGuidance?
    let readiness: StoryReadinessResponse?
    let narrativeVersion: Int
    let integrationDelta: StoryNarrativeIntegrationDelta?
    let storyElements: [V2Beat]

    enum CodingKeys: String, CodingKey {
        case id
        case sessionId
        case action
        case question
        case confirmation
        case narrative
        case completionScore
        case beats
        case userModel
        case turnCount
        case fallback
        case slotGuidance
        case readiness
        case narrativeVersion
        case integrationDelta
        case storyElements
    }

    init(
        sessionId: String,
        action: V2Action,
        question: String? = nil,
        confirmation: String? = nil,
        narrative: String,
        completionScore: Int,
        beats: [V2Beat],
        userModel: V2UserModel,
        turnCount: Int,
        fallback: Bool = false,
        slotGuidance: StorySlotGuidance? = nil,
        readiness: StoryReadinessResponse? = nil,
        narrativeVersion: Int = 0,
        integrationDelta: StoryNarrativeIntegrationDelta? = nil,
        storyElements: [V2Beat] = []
    ) {
        self.id = UUID()
        self.sessionId = sessionId
        self.action = action
        self.question = question
        self.confirmation = confirmation
        self.narrative = narrative
        self.completionScore = completionScore
        self.beats = beats
        self.userModel = userModel
        self.turnCount = turnCount
        self.fallback = fallback
        self.slotGuidance = slotGuidance
        self.readiness = readiness
        self.narrativeVersion = narrativeVersion
        self.integrationDelta = integrationDelta
        self.storyElements = storyElements
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        sessionId = try container.decode(String.self, forKey: .sessionId)
        action = try container.decode(V2Action.self, forKey: .action)
        question = try container.decodeIfPresent(String.self, forKey: .question)
        confirmation = try container.decodeIfPresent(String.self, forKey: .confirmation)
        narrative = try container.decode(String.self, forKey: .narrative)
        completionScore = try container.decode(Int.self, forKey: .completionScore)
        beats = try container.decodeIfPresent([V2Beat].self, forKey: .beats) ?? []
        userModel = try container.decodeIfPresent(V2UserModel.self, forKey: .userModel) ?? .initial
        turnCount = try container.decodeIfPresent(Int.self, forKey: .turnCount) ?? 0
        fallback = try container.decodeIfPresent(Bool.self, forKey: .fallback) ?? false
        slotGuidance = try container.decodeIfPresent(StorySlotGuidance.self, forKey: .slotGuidance)
        readiness = try container.decodeIfPresent(StoryReadinessResponse.self, forKey: .readiness)
        narrativeVersion = try container.decodeIfPresent(Int.self, forKey: .narrativeVersion) ?? 0
        integrationDelta = try container.decodeIfPresent(StoryNarrativeIntegrationDelta.self, forKey: .integrationDelta)
        storyElements = try container.decodeIfPresent([V2Beat].self, forKey: .storyElements) ?? []
    }
}
