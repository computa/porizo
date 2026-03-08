//
//  TrackModels.swift
//  PorizoApp
//
//  Track and version API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation
import SwiftUI

// MARK: - Track Creation

/// Request body for POST /tracks
struct CreateTrackRequest: Encodable, Sendable {
    let title: String
    let occasion: String
    let recipientName: String
    let style: String
    let durationTarget: Int
    let voiceMode: String
    let message: String
    // Story context from wizard
    let specificMemory: String?
    let memoryAnswers: [MemoryAnswer]?
    let specialPhrases: String?
    let whatMakesThemSpecial: String?
    // Legacy fields (kept for compatibility)
    let relationshipType: String?
    let yearsKnown: Int?

    enum CodingKeys: String, CodingKey {
        case title, occasion, style, message
        case recipientName = "recipient_name"
        case durationTarget = "duration_target"
        case voiceMode = "voice_mode"
        case specificMemory = "specific_memory"
        case memoryAnswers = "memory_answers"
        case specialPhrases = "special_phrases"
        case whatMakesThemSpecial = "what_makes_them_special"
        case relationshipType = "relationship_type"
        case yearsKnown = "years_known"
    }
}

/// Response from POST /tracks
struct CreateTrackResponse: Codable, Sendable {
    let trackId: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case trackId = "track_id"
        case status
    }
}

/// Response from POST /tracks/:id/versions
struct CreateVersionResponse: Codable, Sendable {
    let trackVersionId: String
    let versionNum: Int
    let status: String

    enum CodingKeys: String, CodingKey {
        case trackVersionId = "track_version_id"
        case versionNum = "version_num"
        case status
    }
}

// MARK: - Track

/// A track from the backend
struct Track: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let userId: String
    let title: String
    let occasion: String?
    let recipientName: String?
    let style: String?
    let durationTarget: Int?
    let voiceMode: String?
    let message: String?
    let status: String
    let latestVersion: Int
    let shareTokenId: String?
    let createdAt: String
    let updatedAt: String
    var libraryOrigin: String? = nil
    var libraryAddedAt: String? = nil
    var canEdit: Bool? = nil
    var canShare: Bool? = nil
    var canDelete: Bool? = nil
    // Cover image URLs (from latest version)
    let coverImageUrl: String?
    let coverImageSmallUrl: String?
    let coverImageLargeUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title, occasion, style, message, status
        case recipientName = "recipient_name"
        case durationTarget = "duration_target"
        case voiceMode = "voice_mode"
        case latestVersion = "latest_version"
        case shareTokenId = "share_token_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case libraryOrigin = "library_origin"
        case libraryAddedAt = "library_added_at"
        case canEdit = "can_edit"
        case canShare = "can_share"
        case canDelete = "can_delete"
        case coverImageUrl = "cover_image_url"
        case coverImageSmallUrl = "cover_image_small_url"
        case coverImageLargeUrl = "cover_image_large_url"
    }

    var isReceived: Bool {
        libraryOrigin == "received"
    }
}

// MARK: - Track Version

/// A track version from the backend
struct TrackVersion: Codable, Sendable {
    let id: String
    let trackId: String
    let versionNum: Int
    let status: String
    let renderType: String?
    let lyricsStatus: String?
    let lyricsJson: Lyrics?  // Changed from String? to Lyrics?
    let previewUrl: String?
    let fullUrl: String?
    let previewJobId: String?
    let fullJobId: String?
    let moderationStatus: String?
    let moderationReason: String?
    let lastErrorCode: String?
    let lastErrorMessage: String?
    let lastErrorTerms: [String]?
    let lastErrorCategory: String? = nil
    let lastErrorCanAutoRewrite: Bool? = nil
    let lastErrorSuggestedAction: String? = nil
    let lastErrorProvider: String? = nil
    let createdAt: String
    let completedAt: String?
    // Cover image URLs
    let coverImageUrl: String?
    let coverImageSmallUrl: String?
    let coverImageLargeUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case trackId = "track_id"
        case versionNum = "version_num"
        case renderType = "render_type"
        case lyricsStatus = "lyrics_status"
        case lyricsJson = "lyrics_json"
        case previewUrl = "preview_url"
        case fullUrl = "full_url"
        case previewJobId = "preview_job_id"
        case fullJobId = "full_job_id"
        case moderationStatus = "moderation_status"
        case moderationReason = "moderation_reason"
        case lastErrorCode = "last_error_code"
        case lastErrorMessage = "last_error_message"
        case lastErrorTerms = "last_error_terms"
        case lastErrorCategory = "last_error_category"
        case lastErrorCanAutoRewrite = "last_error_can_auto_rewrite"
        case lastErrorSuggestedAction = "last_error_suggested_action"
        case lastErrorProvider = "last_error_provider"
        case createdAt = "created_at"
        case completedAt = "completed_at"
        case coverImageUrl = "cover_image_url"
        case coverImageSmallUrl = "cover_image_small_url"
        case coverImageLargeUrl = "cover_image_large_url"
    }
}

/// Response from GET /tracks/:id
struct GetTrackResponse: Codable, Sendable {
    let track: Track
    let versions: [TrackVersion]
}

/// Response from GET /tracks
struct GetTracksResponse: Codable, Sendable {
    let tracks: [Track]
}

/// Response from GET /tracks/:id/versions/:version/stream-check
struct StreamCheckResponse: Codable, Sendable {
    let trackId: String
    let versionNum: Int
    let storage: String
    let preview: StreamCheckItem?
    let full: StreamCheckItem?
    let generatedAt: String?

    enum CodingKeys: String, CodingKey {
        case trackId = "track_id"
        case versionNum = "version_num"
        case storage
        case preview
        case full
        case generatedAt = "generated_at"
    }
}

struct StreamCheckItem: Codable, Sendable {
    let url: String?
    let exists: Bool?
}

// MARK: - Lyrics

/// Lyrics structure from the backend
struct Lyrics: Codable, Sendable {
    let title: String?
    let style: String?
    let sections: [LyricsSection]
    let anchorLine: String?

    enum CodingKeys: String, CodingKey {
        case title, style, sections
        case anchorLine = "anchor_line"
    }
}

/// A section of lyrics (verse, chorus, etc.)
struct LyricsSection: Codable, Sendable {
    let name: String
    let lines: [String]
}

/// Response from POST /tracks/:id/versions/:version/lyrics/generate
struct GenerateLyricsResponse: Codable, Sendable {
    let lyrics: Lyrics?
    let lyricsStatus: String?
    let fallbackReason: String?

    enum CodingKeys: String, CodingKey {
        case lyrics
        case lyricsStatus = "lyrics_status"
        case fallbackReason = "fallback_reason"
    }
}

/// Response from POST /tracks/:id/versions/:version/lyrics/approve
struct ApproveLyricsResponse: Codable, Sendable {
    let approved: Bool
    let lyricsStatus: String?

    enum CodingKeys: String, CodingKey {
        case approved
        case lyricsStatus = "lyrics_status"
    }
}

// MARK: - Render Responses

/// Response from POST /tracks/:id/versions/:version/render_preview
struct RenderPreviewResponse: Codable, Sendable {
    let jobId: String?
    let estimatedCompletionSec: Int?
    let pollUrl: String?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case estimatedCompletionSec = "estimated_completion_sec"
        case pollUrl = "poll_url"
    }
}

/// Response from POST /tracks/:id/versions/:version/render_full
struct RenderFullResponse: Codable, Sendable {
    let jobId: String?
    let billingHoldId: String?
    let creditsReserved: Int?
    let estimatedCompletionSec: Int?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case billingHoldId = "billing_hold_id"
        case creditsReserved = "credits_reserved"
        case estimatedCompletionSec = "estimated_completion_sec"
    }
}

// MARK: - Job Status

/// Job status from GET /jobs/:id
struct JobStatus: Codable, Sendable {
    let id: String
    let status: String  // queued, processing, completed, failed
    let progress: Int?
    let resultUrl: String?
    let errorCode: String?
    let errorMessage: String?
    let errorTerms: [String]?
    let errorCategory: String?
    let canAutoRewrite: Bool?
    let suggestedAction: String?
    let provider: String?
    let step: String?
    let stepIndex: Int?
    let workflowType: String?
    let startedAt: String?
    let completedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, status, progress, step
        case resultUrl = "result_url"
        case errorCode = "error_code"
        case errorMessage = "error_message"
        case errorTerms = "error_terms"
        case errorCategory = "error_category"
        case canAutoRewrite = "can_auto_rewrite"
        case suggestedAction = "suggested_action"
        case provider
        case stepIndex = "step_index"
        case workflowType = "workflow_type"
        case startedAt = "started_at"
        case completedAt = "completed_at"
    }
}

// MARK: - Reroll

/// Types of reroll operations
/// - lyrics: Regenerate lyrics only (cheapest, reuses instrumental)
/// - beat: New genre/style, regenerate instrumental
/// - vocals: New prosody/similarity settings for voice conversion
enum RerollType: String, Codable, Sendable, CaseIterable {
    case lyrics = "lyrics"
    case beat = "beat"
    case vocals = "vocals"

    var displayName: String {
        switch self {
        case .lyrics: return "Lyrics"
        case .beat: return "Beat"
        case .vocals: return "Vocals"
        }
    }

    var description: String {
        switch self {
        case .lyrics: return "Generate new lyrics"
        case .beat: return "New instrumental style"
        case .vocals: return "New vocal performance"
        }
    }

    var iconName: String {
        switch self {
        case .lyrics: return "text.quote"
        case .beat: return "waveform"
        case .vocals: return "mic.fill"
        }
    }
}

/// Response from POST /tracks/:id/versions/:version/reroll
struct RerollResponse: Codable, Sendable {
    let newVersionNum: Int
    let jobId: String?
    let status: String
    let estimatedCompletionSec: Int?

    enum CodingKeys: String, CodingKey {
        case newVersionNum = "new_version_num"
        case jobId = "job_id"
        case status
        case estimatedCompletionSec = "estimated_completion_sec"
    }
}

// MARK: - Music Styles

/// Available music styles
enum MusicStyle: String, CaseIterable, Identifiable {
    // Popular
    case pop = "pop"
    case acoustic = "acoustic"
    case soul = "soul"
    case folk = "folk"
    case jazz = "jazz"
    case rnb = "rnb"
    case rock = "rock"
    case country = "country"

    // African
    case afrobeats = "afrobeats"
    case highlife = "highlife"
    case ogene = "ogene"
    case juju = "juju"
    case fuji = "fuji"
    case afropop = "afropop"

    // Latin
    case reggaeton = "reggaeton"
    case salsa = "salsa"
    case bossaNova = "bossa_nova"
    case cumbia = "cumbia"
    case bachata = "bachata"
    case samba = "samba"
    case latinPop = "latin_pop"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pop: return "Pop"
        case .acoustic: return "Acoustic"
        case .soul: return "Soul"
        case .folk: return "Folk"
        case .jazz: return "Jazz"
        case .rnb: return "R&B"
        case .rock: return "Rock"
        case .country: return "Country"
        case .afrobeats: return "Afrobeats"
        case .highlife: return "Highlife"
        case .ogene: return "Ogene"
        case .juju: return "Jùjú"
        case .fuji: return "Fuji"
        case .afropop: return "Afropop"
        case .reggaeton: return "Reggaeton"
        case .salsa: return "Salsa"
        case .bossaNova: return "Bossa Nova"
        case .cumbia: return "Cumbia"
        case .bachata: return "Bachata"
        case .samba: return "Samba"
        case .latinPop: return "Latin Pop"
        }
    }

    /// Card background color for merged create view style selection
    var cardColor: Color {
        switch self {
        case .pop: return Color(hex: "#D4A574")        // Golden tan
        case .rnb: return Color(hex: "#4A90A4")        // Teal blue
        case .country: return Color(hex: "#8B7355")   // Warm brown
        case .acoustic: return Color(hex: "#6B8E6B")  // Sage green
        case .soul: return Color(hex: "#9B6B8C")      // Mauve purple
        case .folk: return Color(hex: "#7D6B5C")      // Earth brown
        case .jazz: return Color(hex: "#5B6B8C")      // Slate blue
        case .rock: return Color(hex: "#6B5B5B")      // Charcoal
        case .afrobeats: return Color(hex: "#C4956A") // Warm orange
        case .highlife: return Color(hex: "#8B956B")  // Olive green
        case .ogene: return Color(hex: "#A86F3B")     // Burnt amber
        case .juju: return Color(hex: "#6F8B5A")      // Leaf green
        case .fuji: return Color(hex: "#8A6A5A")      // Clay brown
        case .afropop: return Color(hex: "#B87333")   // Copper
        case .reggaeton: return Color(hex: "#8B5A6B") // Dusty rose
        case .salsa: return Color(hex: "#A55B5B")     // Terracotta
        case .bossaNova: return Color(hex: "#6B8B8B") // Sea green
        case .cumbia: return Color(hex: "#7B8A5A")    // Moss green
        case .bachata: return Color(hex: "#8B6B7A")   // Muted mauve
        case .samba: return Color(hex: "#B36B3F")     // Rich orange
        case .latinPop: return Color(hex: "#9B7B5B")  // Caramel
        }
    }
}

// MARK: - Occasions

/// Available occasions
enum Occasion: String, CaseIterable, Identifiable, Sendable {
    case birthday = "birthday"
    case anniversary = "anniversary"
    case thankYou = "thank_you"
    case iLoveYou = "i_love_you"
    case wedding = "wedding"
    case graduation = "graduation"
    case celebration = "celebration"
    case apology = "apology"
    case encouragement = "encouragement"
    case advice = "advice"
    case bereavement = "bereavement"
    case custom = "custom"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .birthday: return "Birthday"
        case .anniversary: return "Anniversary"
        case .thankYou: return "Thank You"
        case .iLoveYou: return "I Love You"
        case .wedding: return "Wedding"
        case .graduation: return "Graduation"
        case .celebration: return "Celebration"
        case .apology: return "Apology"
        case .encouragement: return "Encouragement"
        case .advice: return "Advice"
        case .bereavement: return "Bereavement"
        case .custom: return "Custom"
        }
    }

    var emoji: String {
        switch self {
        case .birthday: return "🎂"
        case .anniversary: return "💑"
        case .thankYou: return "🙏"
        case .iLoveYou: return "❤️"
        case .wedding: return "💒"
        case .graduation: return "🎓"
        case .celebration: return "🎉"
        case .apology: return "💐"
        case .encouragement: return "💪"
        case .advice: return "🧭"
        case .bereavement: return "🕊️"
        case .custom: return "✨"
        }
    }
}

// MARK: - Story Context

/// The complete story context gathered from the wizard for track creation
struct StoryContext: Sendable {
    let storyId: String?
    let recipientName: String
    let occasion: Occasion
    let specificMemory: String
    let memoryAnswers: [MemoryAnswer]
    let specialPhrases: String?
    let whatMakesThemSpecial: String?
    let style: MusicStyle
    let narrativeVersion: Int?
    let finalNotes: String?
    let storyProvenance: StoryProvenance?
}
