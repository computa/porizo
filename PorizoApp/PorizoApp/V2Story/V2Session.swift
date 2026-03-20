import Foundation

struct V2Session: Equatable, Codable {
    var recipientName: String
    var occasion: String
    var style: String?
    var initialPrompt: String?
    var storyId: String?
    var currentTurn: Int
    var messages: [V2Message]
    var currentResponse: V2EngineResponse?
    var isComplete: Bool
    var storySummary: String?
    var soulOfStory: String?
    var narrativeVersion: Int
    var lastIntegrationDelta: StoryNarrativeIntegrationDelta?
    var draftLifecycle: String
    var factInventory: [StorySessionFact]
    var openConflicts: [StoryDraftConflict]
    var revisionHistory: [StoryRevisionHistoryEntry]
    var draftDiff: StoryDraftDiff?
    var pendingRevision: StoryPendingRevision?
    var storyProvenance: StoryProvenance?
    var lastServerUpdatedAt: String?
    var resumeNotice: String?
    var localReviewDraft: String
    var finalNotesDraft: String
    var isEditingFromReview: Bool

    enum CodingKeys: String, CodingKey {
        case recipientName
        case occasion
        case style
        case initialPrompt
        case storyId
        case currentTurn
        case messages
        case currentResponse
        case isComplete
        case storySummary
        case soulOfStory
        case narrativeVersion
        case lastIntegrationDelta
        case draftLifecycle
        case factInventory
        case openConflicts
        case revisionHistory
        case draftDiff
        case pendingRevision
        case storyProvenance
        case lastServerUpdatedAt
        case resumeNotice
        case localReviewDraft
        case finalNotesDraft
        case isEditingFromReview
    }

    init(recipientName: String = "", occasion: String = "birthday", style: String? = nil, initialPrompt: String? = nil) {
        self.recipientName = recipientName
        self.occasion = occasion
        self.style = style
        self.initialPrompt = initialPrompt
        self.storyId = nil
        self.currentTurn = 0
        self.messages = []
        self.currentResponse = nil
        self.isComplete = false
        self.storySummary = nil
        self.soulOfStory = nil
        self.narrativeVersion = 0
        self.lastIntegrationDelta = nil
        self.draftLifecycle = "drafting"
        self.factInventory = []
        self.openConflicts = []
        self.revisionHistory = []
        self.draftDiff = nil
        self.pendingRevision = nil
        self.storyProvenance = nil
        self.lastServerUpdatedAt = nil
        self.resumeNotice = nil
        self.localReviewDraft = ""
        self.finalNotesDraft = ""
        self.isEditingFromReview = false
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        recipientName = try container.decode(String.self, forKey: .recipientName)
        occasion = try container.decode(String.self, forKey: .occasion)
        style = try container.decodeIfPresent(String.self, forKey: .style)
        initialPrompt = try container.decodeIfPresent(String.self, forKey: .initialPrompt)
        storyId = try container.decodeIfPresent(String.self, forKey: .storyId)
        currentTurn = try container.decodeIfPresent(Int.self, forKey: .currentTurn) ?? 0
        messages = try container.decodeIfPresent([V2Message].self, forKey: .messages) ?? []
        currentResponse = try container.decodeIfPresent(V2EngineResponse.self, forKey: .currentResponse)
        isComplete = try container.decodeIfPresent(Bool.self, forKey: .isComplete) ?? false
        storySummary = try container.decodeIfPresent(String.self, forKey: .storySummary)
        soulOfStory = try container.decodeIfPresent(String.self, forKey: .soulOfStory)
        narrativeVersion = try container.decodeIfPresent(Int.self, forKey: .narrativeVersion) ?? 0
        lastIntegrationDelta = try container.decodeIfPresent(StoryNarrativeIntegrationDelta.self, forKey: .lastIntegrationDelta)
        draftLifecycle = try container.decodeIfPresent(String.self, forKey: .draftLifecycle) ?? "drafting"
        factInventory = try container.decodeIfPresent([StorySessionFact].self, forKey: .factInventory) ?? []
        openConflicts = try container.decodeIfPresent([StoryDraftConflict].self, forKey: .openConflicts) ?? []
        revisionHistory = try container.decodeIfPresent([StoryRevisionHistoryEntry].self, forKey: .revisionHistory) ?? []
        draftDiff = try container.decodeIfPresent(StoryDraftDiff.self, forKey: .draftDiff)
        pendingRevision = try container.decodeIfPresent(StoryPendingRevision.self, forKey: .pendingRevision)
        storyProvenance = try container.decodeIfPresent(StoryProvenance.self, forKey: .storyProvenance)
        lastServerUpdatedAt = try container.decodeIfPresent(String.self, forKey: .lastServerUpdatedAt)
        resumeNotice = try container.decodeIfPresent(String.self, forKey: .resumeNotice)
        localReviewDraft = try container.decodeIfPresent(String.self, forKey: .localReviewDraft) ?? ""
        finalNotesDraft = try container.decodeIfPresent(String.self, forKey: .finalNotesDraft) ?? ""
        isEditingFromReview = try container.decodeIfPresent(Bool.self, forKey: .isEditingFromReview) ?? false
    }
}
