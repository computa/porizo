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

    /// Whether this beat is considered filled (strength >= 0.6)
    var isFilled: Bool { strength >= 0.6 }

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
    let timestamp: Date

    enum Role: String, Codable {
        case user
        case ai
    }

    init(role: Role, content: String, action: V2Action? = nil, suggestions: [String]? = nil) {
        self.id = UUID()
        self.role = role
        self.content = content
        self.action = action
        self.suggestions = suggestions
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
        fallback: Bool = false
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
    }
}

// MARK: - Confirm Result

/// Result from confirming a V2 story session
struct V2ConfirmResult: Equatable, Codable {
    let storyId: String
    let confirmed: Bool
    let narrative: String
    let soulOfStory: String?
    let storySummary: String?
    let beats: [V2Beat]
    let completionScore: Int
}
