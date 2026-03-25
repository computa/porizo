//
//  StoryModels.swift
//  PorizoApp
//
//  Story API response types matching the Node.js backend.
//  Includes both V1 and V2 story engine models.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation
import SwiftUI

enum StoryPromptBudget {
    static let initialPromptWarningThreshold = 8000
    static let initialPromptHardLimit = 12000
    static let initialPromptAcceptedLimit = 12000

    static let storyAnswerWarningThreshold = 4500
    static let storyAnswerHardLimit = 6000

    static func state(
        count: Int,
        warningThreshold: Int,
        hardLimit: Int
    ) -> BudgetState {
        if count > hardLimit {
            return .over
        }
        if count >= warningThreshold {
            return .warning
        }
        return .normal
    }
}

enum BudgetState {
    case normal
    case warning
    case over

    var color: Color {
        switch self {
        case .normal: DesignTokens.textSecondary
        case .warning: DesignTokens.gold
        case .over: DesignTokens.error
        }
    }
}

// MARK: - Story API Models (V1)

/// Request body for POST /story/:id/continue
struct ContinueStoryRequest: Encodable, Sendable {
    let answer: String
}

/// Request body for POST /story/:id/confirm
struct ConfirmStoryRequest: Encodable, Sendable {
    let additionalNotes: String?

    enum CodingKeys: String, CodingKey {
        case additionalNotes = "additional_notes"
    }
}

/// Response from POST /story/:id/lyrics
struct StoryLyricsResponse: Codable, Sendable {
    let lyrics: Lyrics
    let qualityScore: Int?
    let arcUsed: String?
    let validationIssues: [String]?

    enum CodingKeys: String, CodingKey {
        case lyrics
        case qualityScore = "quality_score"
        case arcUsed = "arc_used"
        case validationIssues = "validation_issues"
    }
}

/// Response from POST /story/:id/to-track
struct StoryToTrackResponse: Codable, Sendable {
    let trackId: String
    let versionId: String
    let versionNum: Int

    enum CodingKeys: String, CodingKey {
        case trackId = "track_id"
        case versionId = "version_id"
        case versionNum = "version_num"
    }
}

/// Request body for POST /story/:id/to-track
struct StoryToTrackRequest: Encodable, Sendable {
    let voiceMode: String?
    let voiceGender: String?
    let style: String?

    enum CodingKeys: String, CodingKey {
        case voiceMode = "voice_mode"
        case voiceGender = "voice_gender"
        case style
    }
}

struct StoryStyleUpdateRequest: Encodable, Sendable {
    let style: String?
}

struct StoryStyleUpdateResponse: Codable, Sendable {
    let storyId: String
    let style: String?

    enum CodingKeys: String, CodingKey {
        case storyId = "story_id"
        case style
    }
}

/// Response from GET /story/info
struct StoryInfoResponse: Codable, Sendable {
    let status: StoryStatus
    let occasions: [String: OccasionInfo]
    let styles: [StyleOption]
}

/// Story module status
struct StoryStatus: Codable, Sendable {
    let available: Bool
    let version: String
    let features: [String]
    let arcs: [String]
    let styles: Int
    let occasions: Int
}

/// Occasion info with arc details
struct OccasionInfo: Codable, Sendable {
    let arc: String
    let displayName: String
    let description: String
    let emotionalGoal: String

    enum CodingKeys: String, CodingKey {
        case arc
        case displayName = "displayName"
        case description
        case emotionalGoal = "emotionalGoal"
    }
}

/// Request body for POST /story/:id/add-details
struct StoryAddDetailsRequest: Encodable, Sendable {
    let detail: String
}

/// Request body for POST /story/:id/revise
struct StoryRevisionRequest: Encodable, Sendable {
    let revisionRequest: String
    let source: String?
    let operation: StoryRevisionOperation?

    enum CodingKeys: String, CodingKey {
        case revisionRequest = "revision_request"
        case source
        case operation
    }
}

struct StoryRevisionOperation: Codable, Sendable, Equatable {
    let type: String
    let targetType: String?
    let targetId: String?
    let targetText: String?
    let replacementText: String?
    let resolution: String?

    enum CodingKeys: String, CodingKey {
        case type
        case targetType = "target_type"
        case targetId = "target_id"
        case targetText = "target_text"
        case replacementText = "replacement_text"
        case resolution
    }
}

struct StoryDraftConflict: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let type: String?
    let summary: String?
    let firstFactId: String?
    let secondFactId: String?
    let sourceTurn: Int?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case summary
        case firstFactId = "first_fact_id"
        case secondFactId = "second_fact_id"
        case sourceTurn = "source_turn"
        case status
    }
}

struct StoryDraftDiff: Codable, Sendable, Equatable {
    let fromVersion: Int?
    let toVersion: Int?
    let beforeText: String?
    let afterText: String?
    let timestamp: String?
    let integrationDelta: StoryNarrativeIntegrationDelta?
    let beforeScore: Int?
    let afterScore: Int?

    enum CodingKeys: String, CodingKey {
        case fromVersion = "from_version"
        case toVersion = "to_version"
        case beforeText = "before_text"
        case afterText = "after_text"
        case timestamp
        case integrationDelta = "integration_delta"
        case beforeScore = "before_score"
        case afterScore = "after_score"
    }
}

struct StoryRevisionHistoryEntry: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let version: Int?
    let source: String?
    let request: String?
    let status: String?
    let timestamp: String?
    let summary: String?
    let beforeText: String?
    let afterText: String?
    let beforeVersion: Int?
    let afterVersion: Int?
    let operation: StoryRevisionOperation?
    let integrationDelta: StoryNarrativeIntegrationDelta?

    enum CodingKeys: String, CodingKey {
        case id
        case version
        case source
        case request
        case status
        case timestamp
        case summary
        case beforeText = "before_text"
        case afterText = "after_text"
        case beforeVersion = "before_version"
        case afterVersion = "after_version"
        case operation
        case integrationDelta = "integration_delta"
    }
}

struct StoryPendingRevision: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let request: String?
    let source: String?
    let operation: StoryRevisionOperation?
    let waitingFor: String?
    let followUpQuestion: String?
    let requestedAt: String?
    let beforeVersion: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case request
        case source
        case operation
        case waitingFor = "waiting_for"
        case followUpQuestion = "follow_up_question"
        case requestedAt = "requested_at"
        case beforeVersion = "before_version"
    }
}

struct StoryProvenance: Codable, Sendable, Equatable {
    let storyId: String?
    let engineVersion: String?
    let draftLifecycle: String?
    let narrativeVersion: Int?
    let confirmedNarrativeVersion: Int?
    let confirmedAt: String?

    enum CodingKeys: String, CodingKey {
        case storyId = "story_id"
        case engineVersion = "engine_version"
        case draftLifecycle = "draft_lifecycle"
        case narrativeVersion = "narrative_version"
        case confirmedNarrativeVersion = "confirmed_narrative_version"
        case confirmedAt = "confirmed_at"
    }
}

// MARK: - V2 Story API Models

/// Request body for POST /story/start with V2 engine
struct StartStoryV2Request: Encodable, Sendable {
    let initialPrompt: String
    let occasion: String
    let recipientName: String
    let style: String?
    let engineVersion: String = "v3"

    enum CodingKeys: String, CodingKey {
        case initialPrompt = "initial_prompt"
        case occasion
        case recipientName = "recipient_name"
        case style
        case engineVersion = "engine_version"
    }
}

/// Beat response from V2 engine
struct V2BeatResponse: Codable, Sendable, Equatable {
    let id: String
    let name: String?
    let displayName: String
    let purpose: String
    let strength: Double
    let isRequired: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, purpose, strength
        case displayName = "display_name"
        case isRequired = "is_required"
    }
}

struct StoryReadinessGapResponse: Codable, Sendable, Equatable {
    let slot: String?
    let state: String?
    let reason: String?
    let guidance: StorySlotGuidance?
    let elementId: String?
    let elementDisplayName: String?

    enum CodingKeys: String, CodingKey {
        case slot
        case state
        case reason
        case guidance
        case elementId = "element_id"
        case elementDisplayName = "element_display_name"
    }
}

struct StoryReadinessResponse: Codable, Sendable, Equatable {
    let score: Double
    let percent: Int
    let isReady: Bool
    let isUserOverridable: Bool
    let storyMode: String
    let profile: String
    let recommendedNextAction: String
    let decisionSource: String
    let primaryGap: StoryReadinessGapResponse?
    let missingSlots: [String]
    let weakSlots: [String]
    let blockedSlots: [String]
    let blockedElements: [String]
    let elementScores: [V2BeatResponse]
    let why: String?

    enum CodingKeys: String, CodingKey {
        case score
        case percent
        case isReady = "is_ready"
        case isUserOverridable = "is_user_overridable"
        case storyMode = "story_mode"
        case profile
        case recommendedNextAction = "recommended_next_action"
        case decisionSource = "decision_source"
        case primaryGap = "primary_gap"
        case missingSlots = "missing_slots"
        case weakSlots = "weak_slots"
        case blockedSlots = "blocked_slots"
        case blockedElements = "blocked_elements"
        case elementScores = "element_scores"
        case why
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        score = try container.decodeIfPresent(Double.self, forKey: .score) ?? 0
        percent = try container.decodeIfPresent(Int.self, forKey: .percent) ?? 0
        isReady = try container.decodeIfPresent(Bool.self, forKey: .isReady) ?? false
        isUserOverridable = try container.decodeIfPresent(Bool.self, forKey: .isUserOverridable) ?? false
        storyMode = try container.decodeIfPresent(String.self, forKey: .storyMode) ?? "default"
        profile = try container.decodeIfPresent(String.self, forKey: .profile) ?? "incomplete"
        recommendedNextAction = try container.decodeIfPresent(String.self, forKey: .recommendedNextAction) ?? "clarify"
        decisionSource = try container.decodeIfPresent(String.self, forKey: .decisionSource) ?? "unknown"
        primaryGap = try container.decodeIfPresent(StoryReadinessGapResponse.self, forKey: .primaryGap)
        missingSlots = try container.decodeIfPresent([String].self, forKey: .missingSlots) ?? []
        weakSlots = try container.decodeIfPresent([String].self, forKey: .weakSlots) ?? []
        blockedSlots = try container.decodeIfPresent([String].self, forKey: .blockedSlots) ?? []
        blockedElements = try container.decodeIfPresent([String].self, forKey: .blockedElements) ?? []
        elementScores = try container.decodeIfPresent([V2BeatResponse].self, forKey: .elementScores) ?? []
        why = try container.decodeIfPresent(String.self, forKey: .why)
    }
}

/// User model from V2 engine
struct V2UserModelResponse: Codable, Sendable {
    let style: String
    let fatigueSignals: Int?
    let tonePreference: String?

    enum CodingKeys: String, CodingKey {
        case style
        case fatigueSignals = "fatigue_signals"
        case tonePreference = "tone_preference"
    }
}

/// Response from POST /story/start
struct StartStoryV2Response: Codable, Sendable {
    let storyId: String
    let firstQuestion: String
    let complete: Bool?
    let readyForConfirmation: Bool?
    let action: String?
    let confirmationMessage: String?
    let narrative: String?
    let narrativeVersion: Int?
    let integrationDelta: StoryNarrativeIntegrationDelta?
    let arc: String?
    let arcDisplayName: String?
    let recipientName: String?
    let progress: Int?
    let engineVersion: String?
    let suggestions: [String]?
    let slotGuidance: StorySlotGuidance?
    let draftLifecycle: String?
    let factInventory: [StorySessionFact]?
    let openConflicts: [StoryDraftConflict]?
    let revisionHistory: [StoryRevisionHistoryEntry]?
    let draftDiff: StoryDraftDiff?
    let pendingRevision: StoryPendingRevision?
    let storyProvenance: StoryProvenance?
    let storyElements: [V2BeatResponse]?
    let readiness: StoryReadinessResponse?
    let initialPromptTruncated: Bool?
    let initialPromptOriginalLength: Int?
    let initialPromptUsedLength: Int?

    enum CodingKeys: String, CodingKey {
        case storyId = "story_id"
        case firstQuestion = "first_question"
        case complete
        case readyForConfirmation = "ready_for_confirmation"
        case action
        case confirmationMessage = "confirmation_message"
        case narrative
        case narrativeVersion = "narrative_version"
        case integrationDelta = "integration_delta"
        case arc
        case arcDisplayName = "arc_display_name"
        case recipientName = "recipient_name"
        case progress
        case engineVersion = "engine_version"
        case suggestions
        case slotGuidance = "slot_guidance"
        case draftLifecycle = "draft_lifecycle"
        case factInventory = "fact_inventory"
        case openConflicts = "open_conflicts"
        case revisionHistory = "revision_history"
        case draftDiff = "draft_diff"
        case pendingRevision = "pending_revision"
        case storyProvenance = "story_provenance"
        case storyElements = "story_elements"
        case readiness
        case initialPromptTruncated = "initial_prompt_truncated"
        case initialPromptOriginalLength = "initial_prompt_original_length"
        case initialPromptUsedLength = "initial_prompt_used_length"
    }

    // Convenience accessor for compatibility with existing code
    var question: String { firstQuestion }
}

/// Response from POST /story/:id/continue
struct ContinueStoryV2Response: Codable, Sendable {
    let complete: Bool
    let nextQuestion: String?
    let action: String?
    let progress: Int?
    let questionsAsked: Int?
    let narrative: String?
    let narrativeVersion: Int?
    let integrationDelta: StoryNarrativeIntegrationDelta?
    // When complete:
    let storySummary: String?
    let soulOfStory: String?
    let readyForConfirmation: Bool?
    let suggestions: [String]?
    let slotGuidance: StorySlotGuidance?
    let draftLifecycle: String?
    let factInventory: [StorySessionFact]?
    let openConflicts: [StoryDraftConflict]?
    let revisionHistory: [StoryRevisionHistoryEntry]?
    let draftDiff: StoryDraftDiff?
    let pendingRevision: StoryPendingRevision?
    let storyProvenance: StoryProvenance?
    let storyElements: [V2BeatResponse]?
    let readiness: StoryReadinessResponse?
    let revisionRequest: StoryPendingRevision?

    enum CodingKeys: String, CodingKey {
        case complete
        case nextQuestion = "next_question"
        case action
        case progress
        case questionsAsked = "questions_asked"
        case narrative
        case narrativeVersion = "narrative_version"
        case integrationDelta = "integration_delta"
        case storySummary = "story_summary"
        case soulOfStory = "soul_of_story"
        case readyForConfirmation = "ready_for_confirmation"
        case suggestions
        case slotGuidance = "slot_guidance"
        case draftLifecycle = "draft_lifecycle"
        case factInventory = "fact_inventory"
        case openConflicts = "open_conflicts"
        case revisionHistory = "revision_history"
        case draftDiff = "draft_diff"
        case pendingRevision = "pending_revision"
        case storyProvenance = "story_provenance"
        case storyElements = "story_elements"
        case readiness
        case revisionRequest = "revision_request"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        complete = try container.decodeIfPresent(Bool.self, forKey: .complete) ?? false
        nextQuestion = try container.decodeIfPresent(String.self, forKey: .nextQuestion)
        action = try container.decodeIfPresent(String.self, forKey: .action)
        progress = try container.decodeIfPresent(Int.self, forKey: .progress)
        questionsAsked = try container.decodeIfPresent(Int.self, forKey: .questionsAsked)
        narrative = try container.decodeIfPresent(String.self, forKey: .narrative)
        narrativeVersion = try container.decodeIfPresent(Int.self, forKey: .narrativeVersion)
        integrationDelta = try container.decodeIfPresent(StoryNarrativeIntegrationDelta.self, forKey: .integrationDelta)
        storySummary = try container.decodeIfPresent(String.self, forKey: .storySummary)
        soulOfStory = try container.decodeIfPresent(String.self, forKey: .soulOfStory)
        readyForConfirmation = try container.decodeIfPresent(Bool.self, forKey: .readyForConfirmation)
        suggestions = try container.decodeIfPresent([String].self, forKey: .suggestions)
        slotGuidance = try container.decodeIfPresent(StorySlotGuidance.self, forKey: .slotGuidance)
        draftLifecycle = try container.decodeIfPresent(String.self, forKey: .draftLifecycle)
        factInventory = try container.decodeIfPresent([StorySessionFact].self, forKey: .factInventory)
        openConflicts = try container.decodeIfPresent([StoryDraftConflict].self, forKey: .openConflicts)
        revisionHistory = try container.decodeIfPresent([StoryRevisionHistoryEntry].self, forKey: .revisionHistory)
        draftDiff = try container.decodeIfPresent(StoryDraftDiff.self, forKey: .draftDiff)
        pendingRevision = try container.decodeIfPresent(StoryPendingRevision.self, forKey: .pendingRevision)
        storyProvenance = try container.decodeIfPresent(StoryProvenance.self, forKey: .storyProvenance)
        storyElements = try container.decodeIfPresent([V2BeatResponse].self, forKey: .storyElements)
        readiness = try container.decodeIfPresent(StoryReadinessResponse.self, forKey: .readiness)
        revisionRequest = try container.decodeIfPresent(StoryPendingRevision.self, forKey: .revisionRequest)
    }

    // Compatibility accessors for V2 engine
    var narrativeText: String { narrative ?? storySummary ?? "" }
    var completionScore: Int { progress ?? 0 }
    var turnCount: Int? { questionsAsked }
    var beats: [V2BeatResponse] { [] }
    var userModel: V2UserModelResponse? { nil }
    var fallback: Bool? { nil }
}

/// Structured guidance for improving a weak story slot.
struct StorySlotGuidance: Codable, Sendable, Equatable {
    let slot: String
    let state: String
    let instruction: String
    let answerTemplate: String?
    let examples: [String]?

    // Enriched fields from LLM-powered guidance (optional, nil when template-only)
    let diagnosis: String?
    let storyAnchor: String?
    let suggestion: String?

    enum CodingKeys: String, CodingKey {
        case slot
        case state
        case instruction
        case answerTemplate = "answerTemplate"
        case answerTemplateSnake = "answer_template"
        case examples
        case diagnosis
        case storyAnchor = "storyAnchor"
        case storyAnchorSnake = "story_anchor"
        case suggestion
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        slot = try container.decode(String.self, forKey: .slot)
        state = try container.decode(String.self, forKey: .state)
        instruction = try container.decode(String.self, forKey: .instruction)
        answerTemplate =
            try container.decodeIfPresent(String.self, forKey: .answerTemplate) ??
            (try container.decodeIfPresent(String.self, forKey: .answerTemplateSnake))
        examples = try container.decodeIfPresent([String].self, forKey: .examples)
        diagnosis = try container.decodeIfPresent(String.self, forKey: .diagnosis)
        storyAnchor =
            try container.decodeIfPresent(String.self, forKey: .storyAnchor) ??
            (try container.decodeIfPresent(String.self, forKey: .storyAnchorSnake))
        suggestion = try container.decodeIfPresent(String.self, forKey: .suggestion)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(slot, forKey: .slot)
        try container.encode(state, forKey: .state)
        try container.encode(instruction, forKey: .instruction)
        try container.encodeIfPresent(answerTemplate, forKey: .answerTemplate)
        try container.encodeIfPresent(examples, forKey: .examples)
        try container.encodeIfPresent(diagnosis, forKey: .diagnosis)
        try container.encodeIfPresent(storyAnchor, forKey: .storyAnchor)
        try container.encodeIfPresent(suggestion, forKey: .suggestion)
    }

    /// Whether this guidance includes LLM-enriched context beyond static templates.
    var isEnriched: Bool { diagnosis != nil || storyAnchor != nil }
}

/// On-demand element guidance from the `/story/:id/element-guidance/:element_id` endpoint.
struct ElementGuidance: Codable, Sendable, Equatable {
    let elementId: String
    let elementName: String
    let strength: Double
    let state: String
    let diagnosis: String?
    let storyAnchor: String?
    let suggestion: String?
    let examples: [String]

    enum CodingKeys: String, CodingKey {
        case elementId = "element_id"
        case elementName = "element_name"
        case strength
        case state
        case diagnosis
        case storyAnchor = "story_anchor"
        case suggestion
        case examples
    }
}

/// Canonical narrative delta from the server-side story engine.
struct StoryNarrativeIntegrationDelta: Codable, Sendable, Equatable {
    let addedFacts: [String]
    let updatedFacts: [String]
    let supersededFacts: [String]
    let conflictsDetected: [String]
    let conflictsResolved: [String]
    let narrativeRewritten: Bool

    enum CodingKeys: String, CodingKey {
        case addedFacts = "added_facts"
        case updatedFacts = "updated_facts"
        case supersededFacts = "superseded_facts"
        case conflictsDetected = "conflicts_detected"
        case conflictsResolved = "conflicts_resolved"
        case narrativeRewritten = "narrative_rewritten"
    }

    init(
        addedFacts: [String] = [],
        updatedFacts: [String] = [],
        supersededFacts: [String] = [],
        conflictsDetected: [String] = [],
        conflictsResolved: [String] = [],
        narrativeRewritten: Bool = false
    ) {
        self.addedFacts = addedFacts
        self.updatedFacts = updatedFacts
        self.supersededFacts = supersededFacts
        self.conflictsDetected = conflictsDetected
        self.conflictsResolved = conflictsResolved
        self.narrativeRewritten = narrativeRewritten
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        addedFacts = (try? container.decode([String].self, forKey: .addedFacts)) ?? []
        updatedFacts = (try? container.decode([String].self, forKey: .updatedFacts)) ?? []
        supersededFacts = (try? container.decode([String].self, forKey: .supersededFacts)) ?? []
        conflictsDetected = (try? container.decode([String].self, forKey: .conflictsDetected)) ?? []
        conflictsResolved = (try? container.decode([String].self, forKey: .conflictsResolved)) ?? []
        narrativeRewritten = (try? container.decode(Bool.self, forKey: .narrativeRewritten)) ?? false
    }
}

/// Response from POST /story/:id/confirm with V2 engine
struct ConfirmStoryV2Response: Codable, Sendable {
    let confirmed: Bool
    let narrative: String?
    let completionScore: Int?
    let soulOfStory: String?
    let storySummary: String?
    let beats: [V2BeatResponse]?
    let narrativeVersion: Int?
    let draftLifecycle: String?
    let factInventory: [StorySessionFact]?
    let openConflicts: [StoryDraftConflict]?
    let revisionHistory: [StoryRevisionHistoryEntry]?
    let draftDiff: StoryDraftDiff?
    let pendingRevision: StoryPendingRevision?
    let storyProvenance: StoryProvenance?
    let readiness: StoryReadinessResponse?

    enum CodingKeys: String, CodingKey {
        case confirmed
        case narrative
        case completionScore = "completion_score"
        case soulOfStory = "soul_of_story"
        case storySummary = "story_summary"
        case beats
        case narrativeVersion = "narrative_version"
        case draftLifecycle = "draft_lifecycle"
        case factInventory = "fact_inventory"
        case openConflicts = "open_conflicts"
        case revisionHistory = "revision_history"
        case draftDiff = "draft_diff"
        case pendingRevision = "pending_revision"
        case storyProvenance = "story_provenance"
        case readiness
    }
}

/// Response from GET /story/:id/summary with V2 engine
struct StorySummaryV2Response: Codable, Sendable {
    let storyId: String
    let summaryText: String?
    let soulOfStory: String?
    let facts: [String]?
    let beatsCovered: Int?
    let completionScore: Int?
    let engineVersion: String?

    enum CodingKeys: String, CodingKey {
        case storyId = "story_id"
        case summaryText = "summary_text"
        case soulOfStory = "soul_of_story"
        case facts
        case beatsCovered = "beats_covered"
        case completionScore = "completion_score"
        case engineVersion = "engine_version"
    }
}

/// Fact captured in a story session
struct StorySessionFact: Codable, Sendable, Equatable {
    let id: String?
    let text: String
    let beat: String?
    let sourceTurn: Int?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case id
        case text
        case beat
        case sourceTurn = "source_turn"
        case status
    }
}

/// Conversation entry captured by the V2 engine
struct StorySessionConversationEntry: Codable, Sendable, Equatable {
    let role: String
    let content: String
    let timestamp: String?
    let kind: String?
    let source: String?
}

/// Response from GET /story/:id (resume state)
struct StorySessionStateResponse: Codable, Sendable {
    let sessionId: String
    let engineVersion: String?
    let recipientName: String?
    let occasion: String?
    let style: String?
    let eventType: String?
    let initialPrompt: String?
    let narrative: String?
    let facts: [StorySessionFact]?
    let beats: [V2BeatResponse]?
    let userModel: V2UserModelResponse?
    let status: String?
    let turnCount: Int?
    let completionScore: Int?
    let narrativeVersion: Int?
    let integrationDelta: StoryNarrativeIntegrationDelta?
    let draftLifecycle: String?
    let revisionHistory: [StoryRevisionHistoryEntry]?
    let draftDiff: StoryDraftDiff?
    let openConflicts: [StoryDraftConflict]?
    let pendingRevision: StoryPendingRevision?
    let storyProvenance: StoryProvenance?
    let storyElements: [V2BeatResponse]?
    let readiness: StoryReadinessResponse?
    let conversation: [StorySessionConversationEntry]?
    let currentQuestion: String?
    let updatedAt: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case sessionId
        case engineVersion
        case recipientName
        case occasion
        case style
        case eventType
        case initialPrompt
        case narrative
        case facts
        case beats
        case userModel
        case status
        case turnCount
        case completionScore
        case narrativeVersion
        case integrationDelta
        case draftLifecycle
        case revisionHistory
        case draftDiff
        case openConflicts
        case pendingRevision
        case storyProvenance
        case storyElements
        case readiness
        case conversation
        case currentQuestion
        case updatedAt
        case createdAt
    }
}
