//
//  V2StoryTypes.swift
//  PorizoApp
//
//  Production V2 Engine types for the Story Wizard.
//  These mirror the backend V2 response contract.
//

import Foundation

// MARK: - V2 Action Types

/// Actions the V2 reasoning engine can take
enum V2Action: String, CaseIterable, Identifiable, Codable {
    case ask = "ASK"           // New question to explore story
    case clarify = "CLARIFY"   // Follow-up for more detail
    case confirm = "CONFIRM"   // Ready to proceed check
    case stop = "STOP"         // Story collection complete

    var id: String { rawValue }

    /// Display name for the action
    var displayName: String {
        switch self {
        case .ask: return "Exploring"
        case .clarify: return "Clarifying"
        case .confirm: return "Confirming"
        case .stop: return "Complete"
        }
    }

    /// SF Symbol for the action
    var iconName: String {
        switch self {
        case .ask: return "sparkles"
        case .clarify: return "magnifyingglass"
        case .confirm: return "checkmark.circle"
        case .stop: return "party.popper"
        }
    }
}

// MARK: - V2 Story Beat

/// A story element with strength indicating how well it's been captured
struct V2Beat: Identifiable, Equatable, Codable {
    let id: String
    let name: String              // Internal name (e.g., "setting")
    let displayName: String       // User-facing name (e.g., "The Setting")
    let purpose: String           // What this beat captures
    let strength: Double          // 0.0 - 1.0
    let isRequired: Bool

    /// Whether this beat is considered filled (strength >= 0.7)
    var isFilled: Bool { strength >= 0.7 }

    /// Strength as discrete dots (0-5 scale)
    var strengthDots: Int {
        Int((strength * 5).rounded())
    }

    /// Default story elements for when backend doesn't provide beats
    static func defaultBeats(turnCount: Int, completionScore: Int) -> [V2Beat] {
        // Calculate strengths based on turns and completion
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

// MARK: - V2 User Model

/// Detected user communication style and signals
struct V2UserModel: Equatable, Codable {
    let style: UserStyle
    let fatigueSignals: Int
    let tonePreference: String

    enum UserStyle: String, CaseIterable, Codable {
        case brief
        case verbose
        case emotional
        case analytical
        case unknown

        var displayName: String {
            switch self {
            case .brief: return "Brief"
            case .verbose: return "Detailed"
            case .emotional: return "Emotional"
            case .analytical: return "Analytical"
            case .unknown: return "Adapting..."
            }
        }
    }

    static let initial = V2UserModel(
        style: .unknown,
        fatigueSignals: 0,
        tonePreference: "neutral"
    )
}

// MARK: - Conversation Message

/// A message in the conversation history
struct V2Message: Identifiable, Equatable, Codable {
    let id: UUID
    let role: Role
    let content: String
    let action: V2Action?       // Only for AI messages
    let suggestions: [String]?  // Contextual suggestion chips (only for AI messages)
    let slotGuidance: StorySlotGuidance?  // Structured guidance for weak slots
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

// MARK: - Session State

/// State for a production story session
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

// MARK: - Engine Response

/// V2 engine response (matches backend contract)
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
