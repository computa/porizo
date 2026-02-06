//
//  PoemModels.swift
//  PorizoApp
//
//  Poem API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation
import SwiftUI

// MARK: - Poem

/// A poem created for a recipient
struct Poem: Codable, Sendable, Identifiable {
    let id: String
    let userId: String
    let title: String
    let recipientName: String
    let occasion: String
    let tone: String
    let status: String  // draft, complete
    let verses: [String]
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case recipientName = "recipient_name"
        case occasion, tone, status, verses
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// Preview of poem (first 2 lines)
    var previewLines: String {
        verses.prefix(2).joined(separator: " ")
    }
}

/// Response from GET /poems
struct GetPoemsResponse: Codable, Sendable {
    let poems: [Poem]
}

/// Request body for POST /poems
struct CreatePoemRequest: Encodable, Sendable {
    let title: String
    let recipientName: String
    let occasion: String
    let tone: String
    let message: String
    let memoryAnswers: [MemoryAnswer]?

    enum CodingKeys: String, CodingKey {
        case title, occasion, tone, message
        case recipientName = "recipient_name"
        case memoryAnswers = "memory_answers"
    }
}

/// Response from GET /poems/:id
struct GetPoemResponse: Codable, Sendable {
    let poem: Poem
}

/// Request body for PUT /poems/:id
struct UpdatePoemRequest: Encodable, Sendable {
    let title: String?
    let tone: String?
    let verses: [String]?
    let status: String?

    init(title: String? = nil, tone: String? = nil, verses: [String]? = nil, status: String? = nil) {
        self.title = title
        self.tone = tone
        self.verses = verses
        self.status = status
    }
}

/// Response from PUT /poems/:id
struct UpdatePoemResponse: Codable, Sendable {
    let poem: Poem
}

// MARK: - Poem Tones

/// Available poem tones
enum PoemTone: String, CaseIterable, Identifiable {
    case heartfelt = "heartfelt"
    case playful = "playful"
    case formal = "formal"
    case poetic = "poetic"
    case simple = "simple"
    case rhyming = "rhyming"
    case freeVerse = "free_verse"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .heartfelt: return "Heartfelt"
        case .playful: return "Playful"
        case .formal: return "Formal"
        case .poetic: return "Poetic"
        case .simple: return "Simple"
        case .rhyming: return "Rhyming"
        case .freeVerse: return "Free Verse"
        }
    }

    var description: String {
        switch self {
        case .heartfelt: return "Sincere and emotional"
        case .playful: return "Fun and lighthearted"
        case .formal: return "Elegant and traditional"
        case .poetic: return "Artistic and metaphorical"
        case .simple: return "Clear and direct"
        case .rhyming: return "Classic rhyme scheme"
        case .freeVerse: return "No fixed structure"
        }
    }

    /// Card background color for merged create view tone selection
    var cardColor: Color {
        switch self {
        case .heartfelt: return Color(hex: "#C4789B")  // Rose pink
        case .playful: return Color(hex: "#7BC47A")   // Soft green
        case .formal: return Color(hex: "#6B7B9B")    // Slate blue
        case .poetic: return Color(hex: "#9B7BC4")    // Lavender
        case .simple: return Color(hex: "#8B9B7B")    // Sage
        case .rhyming: return Color(hex: "#C4A07B")   // Warm gold
        case .freeVerse: return Color(hex: "#7B9BC4") // Sky blue
        }
    }
}

// MARK: - Story-to-Poem Models

/// Request body for POST /story/:id/to-poem
struct StoryToPoemRequest: Encodable, Sendable {
    let tone: String?
    let style: String?
}

/// Response from POST /story/:id/to-poem
struct StoryToPoemResponse: Codable, Sendable {
    let poem: Poem
    let provider: String?
    let model: String?
}

/// Gap info returned when story is incomplete for poem generation
struct StoryPoemGap: Codable, Sendable, Identifiable {
    let id: String
    let label: String
}

/// 422 response when story is missing required details for poems
struct StoryPoemGapResponse: Codable, Sendable {
    let error: String
    let message: String
    let gaps: [StoryPoemGap]
    let suggestedQuestion: String?

    enum CodingKeys: String, CodingKey {
        case error
        case message
        case gaps
        case suggestedQuestion = "suggested_question"
    }
}

/// Result from attempting to generate a poem from a story
enum StoryPoemGenerationResult: Sendable {
    case poem(StoryToPoemResponse)
    case gaps(StoryPoemGapResponse)
}

// MARK: - Poem Audio Models

/// Response from POST /poems/:id/audio
struct PoemAudioResponse: Codable, Sendable {
    let audioUrl: String
    let generatedAt: String

    enum CodingKeys: String, CodingKey {
        case audioUrl = "audio_url"
        case generatedAt = "generated_at"
    }
}

// MARK: - Poem Share Models

/// Response from POST /poems/:id/share
struct CreatePoemShareResponse: Codable, Sendable {
    let shareId: String
    let shareUrl: String
    let expiresAt: String
    let claimPin: String

    enum CodingKeys: String, CodingKey {
        case shareId = "share_id"
        case shareUrl = "share_url"
        case expiresAt = "expires_at"
        case claimPin = "claim_pin"
    }
}

/// Response from GET /poem-share/:shareId (public endpoint)
struct PoemShareInfoResponse: Codable, Sendable {
    let status: String
    let canAccess: Bool?
    let poem: SharedPoemPreview?
    let expiresAt: String?
    let requiresPin: Bool?
    let claimAttempts: Int?
    let maxAttempts: Int?

    enum CodingKeys: String, CodingKey {
        case status
        case canAccess = "can_access"
        case poem
        case expiresAt = "expires_at"
        case requiresPin = "requires_pin"
        case claimAttempts = "claim_attempts"
        case maxAttempts = "max_attempts"
    }
}

/// Poem preview info returned in share responses
struct SharedPoemPreview: Codable, Sendable {
    let title: String?
    let recipientName: String?
    let occasion: String?
    let previewLines: [String]?
    let creatorName: String?

    enum CodingKeys: String, CodingKey {
        case title
        case recipientName = "recipient_name"
        case occasion
        case previewLines = "preview_lines"
        case creatorName = "creator_name"
    }
}

/// Response from POST /poem-share/:shareId/claim
struct PoemShareClaimResponse: Codable, Sendable {
    let status: String
    let poem: Poem?
    let allowSave: Bool?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case status
        case poem
        case allowSave = "allow_save"
        case expiresAt = "expires_at"
    }
}
