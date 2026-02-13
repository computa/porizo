//
//  StoryModels.swift
//  PorizoApp
//
//  Story API response types matching the Node.js backend.
//  Includes both V1 and V2 story engine models.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation

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

/// Response from GET /story/info
struct StoryInfoResponse: Codable, Sendable {
    let status: StoryStatus
    let occasions: [String: OccasionInfo]
    let styles: [String: String]
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
struct V2BeatResponse: Codable, Sendable {
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
    let arc: String?
    let arcDisplayName: String?
    let recipientName: String?
    let progress: Int?
    let engineVersion: String?
    let suggestions: [String]?
    let slotGuidance: StorySlotGuidance?
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
        case arc
        case arcDisplayName = "arc_display_name"
        case recipientName = "recipient_name"
        case progress
        case engineVersion = "engine_version"
        case suggestions
        case slotGuidance = "slot_guidance"
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
    let progress: Int?
    let questionsAsked: Int?
    let narrative: String?
    // When complete:
    let storySummary: String?
    let soulOfStory: String?
    let readyForConfirmation: Bool?
    let suggestions: [String]?
    let slotGuidance: StorySlotGuidance?

    enum CodingKeys: String, CodingKey {
        case complete
        case nextQuestion = "next_question"
        case progress
        case questionsAsked = "questions_asked"
        case narrative
        case storySummary = "story_summary"
        case soulOfStory = "soul_of_story"
        case readyForConfirmation = "ready_for_confirmation"
        case suggestions
        case slotGuidance = "slot_guidance"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        complete = try container.decodeIfPresent(Bool.self, forKey: .complete) ?? false
        nextQuestion = try container.decodeIfPresent(String.self, forKey: .nextQuestion)
        progress = try container.decodeIfPresent(Int.self, forKey: .progress)
        questionsAsked = try container.decodeIfPresent(Int.self, forKey: .questionsAsked)
        narrative = try container.decodeIfPresent(String.self, forKey: .narrative)
        storySummary = try container.decodeIfPresent(String.self, forKey: .storySummary)
        soulOfStory = try container.decodeIfPresent(String.self, forKey: .soulOfStory)
        readyForConfirmation = try container.decodeIfPresent(Bool.self, forKey: .readyForConfirmation)
        suggestions = try container.decodeIfPresent([String].self, forKey: .suggestions)
        slotGuidance = try container.decodeIfPresent(StorySlotGuidance.self, forKey: .slotGuidance)
    }

    // Compatibility accessors for V2 engine
    var action: String { complete ? "STOP" : "ASK" }
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

    enum CodingKeys: String, CodingKey {
        case slot
        case state
        case instruction
        case answerTemplate = "answerTemplate"
        case answerTemplateSnake = "answer_template"
        case examples
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
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(slot, forKey: .slot)
        try container.encode(state, forKey: .state)
        try container.encode(instruction, forKey: .instruction)
        try container.encodeIfPresent(answerTemplate, forKey: .answerTemplate)
        try container.encodeIfPresent(examples, forKey: .examples)
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

    enum CodingKeys: String, CodingKey {
        case confirmed
        case narrative
        case completionScore = "completion_score"
        case soulOfStory = "soul_of_story"
        case storySummary = "story_summary"
        case beats
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
struct StorySessionFact: Codable, Sendable {
    let id: String?
    let text: String
    let beat: String?
    let sourceTurn: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case text
        case beat
        case sourceTurn = "source_turn"
    }
}

/// Conversation entry captured by the V2 engine
struct StorySessionConversationEntry: Codable, Sendable {
    let role: String
    let content: String
    let timestamp: String?
}

/// Response from GET /story/:id (resume state)
struct StorySessionStateResponse: Codable, Sendable {
    let sessionId: String
    let engineVersion: String?
    let recipientName: String?
    let occasion: String?
    let eventType: String?
    let initialPrompt: String?
    let narrative: String?
    let facts: [StorySessionFact]?
    let beats: [V2BeatResponse]?
    let userModel: V2UserModelResponse?
    let status: String?
    let turnCount: Int?
    let completionScore: Int?
    let conversation: [StorySessionConversationEntry]?
    let currentQuestion: String?
    let updatedAt: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case sessionId
        case engineVersion
        case recipientName
        case occasion
        case eventType
        case initialPrompt
        case narrative
        case facts
        case beats
        case userModel
        case status
        case turnCount
        case completionScore
        case conversation
        case currentQuestion
        case updatedAt
        case createdAt
    }
}
