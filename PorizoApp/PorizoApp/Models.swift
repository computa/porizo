//
//  Models.swift
//  PorizoApp
//
//  API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation
import SwiftUI

// MARK: - Enrollment Models

/// Response from POST /voice/enrollment/start
struct EnrollmentSession: Codable, Sendable {
    let sessionId: String
    let sessionExpiresAt: String
    let prompts: [EnrollmentPrompt]?
    let promptSetId: String?
    let uploadUrls: [UploadURL]?
    let recordingSettings: RecordingSettings?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case sessionExpiresAt = "session_expires_at"
        case prompts
        case promptSetId = "prompt_set_id"
        case uploadUrls = "upload_urls"
        case recordingSettings = "recording_settings"
    }
}

/// Presigned upload URL for enrollment chunks
struct UploadURL: Codable, Sendable {
    let chunkId: String
    let url: String
    let method: String?
    let headers: [String: String]?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case chunkId = "chunk_id"
        case url
        case method
        case headers
        case expiresAt = "expires_at"
    }
}

/// Recording settings from backend
struct RecordingSettings: Codable, Sendable {
    let sampleRate: Int
    let channels: Int
    let format: String
    let maxChunkDurationSec: Int?

    enum CodingKeys: String, CodingKey {
        case sampleRate = "sample_rate"
        case channels
        case format
        case maxChunkDurationSec = "max_chunk_duration_sec"
    }
}

/// Voice enrollment prompt
struct EnrollmentPrompt: Codable, Sendable {
    let id: String
    let text: String
    let type: String  // "spoken" or "sung"
    let durationHintSec: Int?
    let pitchHint: String?

    enum CodingKeys: String, CodingKey {
        case id, text, type
        case durationHintSec = "duration_hint_sec"
        case pitchHint = "pitch_hint"
    }
}

/// Response from POST /debug/upload-chunk
struct ChunkUploadResponse: Codable, Sendable {
    let status: String  // "accepted"
    let qcJobId: String?
    let nextUploadUrl: UploadURL?
    let chunkId: String?
    let durationSec: Double?

    enum CodingKeys: String, CodingKey {
        case status
        case qcJobId = "qc_job_id"
        case nextUploadUrl = "next_upload_url"
        case chunkId = "chunk_id"
        case durationSec = "duration_sec"
    }
}

/// Response from POST /voice/enrollment/complete
struct VoiceProfile: Codable, Sendable {
    let voiceProfileId: String
    let qualityScore: Double?  // Backend returns float, not int
    let status: String
    let jobId: String?
    let estimatedCompletionSec: Int?
    let outcome: String?  // "new" | "upgraded" | "kept_existing"
    let quality: EnrollmentQuality?

    enum CodingKeys: String, CodingKey {
        case voiceProfileId = "voice_profile_id"
        case qualityScore = "quality_score"
        case status
        case jobId = "job_id"
        case estimatedCompletionSec = "estimated_completion_sec"
        case outcome
        case quality
    }
}

/// Quality details from enrollment completion
struct EnrollmentQuality: Codable, Sendable {
    let tier: String
    let score: Double
    let newScore: Double?
    let existingScore: Double?
    let stars: Int?
    let label: String?
    let disclosure: String?
    let canImprove: Bool?
    let improvementTips: [String]?

    enum CodingKeys: String, CodingKey {
        case tier, score, stars, label, disclosure
        case newScore = "new_score"
        case existingScore = "existing_score"
        case canImprove = "can_improve"
        case improvementTips = "improvement_tips"
    }
}

/// Response from GET /voice/profile
struct VoiceProfileStatus: Codable, Sendable {
    let profileId: String?
    let status: String?
    let qualityScore: Double?
    let qualityTier: String?
    let createdAt: String?

    /// Computed property - has active profile if status is "active"
    var hasProfile: Bool {
        status == "active"
    }

    /// Get tier from score if tier not provided
    var tier: QualityTier {
        if let tierString = qualityTier {
            return QualityTier(from: tierString)
        }
        guard let score = qualityScore else { return .minimal }
        return QualityTier(from: score)
    }

    enum CodingKeys: String, CodingKey {
        case profileId = "profile_id"
        case status
        case qualityScore = "quality_score"
        case qualityTier = "quality_tier"
        case createdAt = "created_at"
    }
}

/// Voice quality tiers matching backend (consolidated from VoiceQualityTier + QualityTier)
enum QualityTier: String, CaseIterable, Sendable {
    case excellent
    case good
    case fair
    case basic
    case minimal

    var displayName: String {
        switch self {
        case .excellent: return "Excellent"
        case .good: return "Good"
        case .fair: return "Fair"
        case .basic: return "Basic"
        case .minimal: return "Minimal"
        }
    }

    /// Star rating for profile display (0-3)
    var ordinal: Int {
        switch self {
        case .excellent: return 3
        case .good: return 2
        case .fair: return 1
        case .basic, .minimal: return 0
        }
    }

    var color: Color {
        switch self {
        case .excellent: return DesignTokens.success
        case .good: return DesignTokens.gold
        case .fair: return DesignTokens.warning
        case .basic, .minimal: return DesignTokens.error
        }
    }

    var iconName: String {
        switch self {
        case .excellent: return "star.circle.fill"
        case .good: return "checkmark.circle.fill"
        case .fair: return "checkmark.circle"
        case .basic: return "exclamationmark.circle"
        case .minimal: return "exclamationmark.triangle"
        }
    }

    var completionMessage: String {
        switch self {
        case .excellent:
            return "Songs will sound very close to your natural voice"
        case .good:
            return "Songs will sound like you with light AI enhancement"
        case .fair:
            return "Songs will capture your vocal character with moderate AI enhancement"
        case .basic:
            return "We've captured your voice. Recording in a quieter space will improve how closely songs match your voice"
        case .minimal:
            return "We created your profile, but re-recording in a quieter space will significantly improve results"
        }
    }

    var improvementTips: [String] {
        switch self {
        case .excellent:
            return []
        case .good:
            return [
                "Speak a bit closer to your phone for even clearer audio",
                "Try a room with soft furnishings to reduce echo"
            ]
        case .fair:
            return [
                "Find a quieter environment away from traffic or appliances",
                "Hold your phone 6-8 inches from your mouth",
                "Close windows and doors to reduce background noise"
            ]
        case .basic, .minimal:
            return [
                "Record in a quiet room with the door closed",
                "Turn off fans, AC, and other noisy appliances",
                "Speak clearly at a natural volume",
                "Hold your phone steady, 6-8 inches from your mouth",
                "Try recording at a different time when it's quieter"
            ]
        }
    }

    init(from score: Double) {
        switch score {
        case 80...: self = .excellent
        case 60..<80: self = .good
        case 40..<60: self = .fair
        case 20..<40: self = .basic
        default: self = .minimal
        }
    }

    init(from backendTier: String) {
        self = QualityTier(rawValue: backendTier.lowercased()) ?? .minimal
    }
}

/// Enrollment outcome types
enum EnrollmentOutcome: String, Sendable {
    case new = "new"
    case upgraded = "upgraded"
    case keptExisting = "kept_existing"

    var title: String {
        switch self {
        case .new: return "Voice Profile Ready!"
        case .upgraded: return "Profile Upgraded!"
        case .keptExisting: return "Profile Protected"
        }
    }

    var icon: String {
        switch self {
        case .new: return "checkmark.circle.fill"
        case .upgraded: return "arrow.up.circle.fill"
        case .keptExisting: return "checkmark.shield.fill"
        }
    }

    var iconColor: Color {
        switch self {
        case .new, .upgraded: return DesignTokens.success
        case .keptExisting: return DesignTokens.warning
        }
    }
}

// MARK: - Error Models

/// API error response
struct APIError: Codable, Error, Sendable {
    let error: String
    let message: String
    let details: [String: String]?
}

// MARK: - App State

/// Local enrollment state for tracking progress
enum EnrollmentState: Sendable {
    case notStarted
    case recording(prompt: String, type: PromptType)
    case uploading
    case processing
    case completed(qualityScore: Int)
    case failed(error: String)
}

enum PromptType: String, Sendable {
    case spoken = "spoken"
    case sung = "sung"
}

/// Chunk tracking for upload progress
struct RecordedChunk: Sendable {
    let id: String
    let type: PromptType
    let audioURL: URL
    let duration: TimeInterval
    var uploaded: Bool = false
}

// MARK: - Memory Questions Models

/// A question generated by AI for extracting memory details
struct MemoryQuestion: Codable, Identifiable, Sendable {
    let id: String
    let question: String
    let placeholder: String
}

/// Response from POST /memory/questions
struct MemoryQuestionsResponse: Codable, Sendable {
    let questions: [MemoryQuestion]
}

/// Request body for POST /memory/questions
struct MemoryQuestionsRequest: Encodable, Sendable {
    let memory: String
    let occasion: String?
    let recipientName: String?

    enum CodingKeys: String, CodingKey {
        case memory, occasion
        case recipientName = "recipient_name"
    }
}

/// User's answer to an AI-generated memory question
struct MemoryAnswer: Codable, Sendable {
    let questionId: String
    let question: String
    let answer: String

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case question, answer
    }
}

// MARK: - Track Models

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

/// A track from the backend
struct Track: Codable, Sendable, Identifiable {
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
    }
}

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
    let createdAt: String
    let completedAt: String?

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
        case createdAt = "created_at"
        case completedAt = "completed_at"
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

/// Response from GET /entitlements
struct EntitlementsResponse: Codable, Sendable {
    let entitlements: Entitlements?
    let riskLevel: String?

    enum CodingKeys: String, CodingKey {
        case entitlements
        case riskLevel = "risk_level"
    }
}

/// User entitlements (subscription limits)
struct Entitlements: Codable, Sendable {
    let userId: String?
    let tier: String  // "free", "basic", "pro"
    let creditsBalance: Int  // Songs remaining this period
    let creditsUsedTotal: Int  // Total songs ever created
    let previewCountToday: Int
    let previewCountResetAt: String?
    let updatedAt: String?
    // Subscription fields (optional, added for subscription model)
    let songsThisMonth: Int?
    let monthlyLimit: Int?
    let periodEndsAt: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case tier
        case creditsBalance = "credits_balance"
        case creditsUsedTotal = "credits_used_total"
        case previewCountToday = "preview_count_today"
        case previewCountResetAt = "preview_count_reset_at"
        case updatedAt = "updated_at"
        case songsThisMonth = "songs_this_month"
        case monthlyLimit = "monthly_limit"
        case periodEndsAt = "period_ends_at"
    }

    /// Check if user has songs remaining this month
    var hasCredits: Bool {
        creditsBalance > 0
    }

    /// Check if user can create another song this month
    var canCreateSong: Bool {
        if let limit = monthlyLimit, let used = songsThisMonth {
            return used < limit
        }
        // Fall back to credits balance
        return creditsBalance > 0
    }

    /// Display text for remaining songs
    var remainingText: String {
        if let limit = monthlyLimit, let used = songsThisMonth {
            let remaining = max(0, limit - used)
            return "\(remaining) of \(limit) songs"
        }
        return "\(creditsBalance) songs"
    }
}

/// Job status from GET /jobs/:id
struct JobStatus: Codable, Sendable {
    let id: String
    let status: String  // queued, processing, completed, failed
    let progress: Int?
    let resultUrl: String?
    let errorCode: String?
    let errorMessage: String?
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
        case stepIndex = "step_index"
        case workflowType = "workflow_type"
        case startedAt = "started_at"
        case completedAt = "completed_at"
    }
}

// MARK: - Reroll Models

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
    case afropop = "afropop"

    // Latin
    case reggaeton = "reggaeton"
    case salsa = "salsa"
    case bossaNova = "bossa_nova"
    case bachata = "bachata"
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
        case .afropop: return "Afropop"
        case .reggaeton: return "Reggaeton"
        case .salsa: return "Salsa"
        case .bossaNova: return "Bossa Nova"
        case .bachata: return "Bachata"
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
        case .afropop: return Color(hex: "#B87333")   // Copper
        case .reggaeton: return Color(hex: "#8B5A6B") // Dusty rose
        case .salsa: return Color(hex: "#A55B5B")     // Terracotta
        case .bossaNova: return Color(hex: "#6B8B8B") // Sea green
        case .bachata: return Color(hex: "#8B6B7A")   // Muted mauve
        case .latinPop: return Color(hex: "#9B7B5B")  // Caramel
        }
    }
}

// MARK: - Poem Models

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

/// Request body for POST /story/:id/add-details
struct StoryAddDetailsRequest: Encodable, Sendable {
    let detail: String
}

// MARK: - Story API Models

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

// MARK: - Device Models

/// Response from POST /device/register
struct DeviceRegistrationResponse: Codable, Sendable {
    let deviceToken: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case deviceToken = "device_token"
        case expiresAt = "expires_at"
    }
}

// MARK: - Share Models

/// Response from POST /tracks/:id/share
struct CreateShareResponse: Codable, Sendable {
    let shareId: String
    let shareUrl: String
    let qrCodeUrl: String
    let expiresAt: String
    let claimPin: String  // 6-digit PIN to share with recipient

    enum CodingKeys: String, CodingKey {
        case shareId = "share_id"
        case shareUrl = "share_url"
        case qrCodeUrl = "qr_code_url"
        case expiresAt = "expires_at"
        case claimPin = "claim_pin"
    }

    /// Memberwise initializer for programmatic creation
    init(shareId: String, shareUrl: String, qrCodeUrl: String, expiresAt: String, claimPin: String) {
        self.shareId = shareId
        self.shareUrl = shareUrl
        self.qrCodeUrl = qrCodeUrl
        self.expiresAt = expiresAt
        self.claimPin = claimPin
    }
}

/// Share statistics from GET /tracks/:id/share/stats
struct ShareStats: Codable, Sendable {
    let shareId: String
    let status: String
    let expiresAt: String
    let createdAt: String
    let isExpired: Bool
    // Flattened fields (previously nested in access_stats/claim_info)
    let totalEvents: Int
    let eventCounts: [String: EventCount]?
    let isClaimed: Bool
    let boundDevice: BoundDeviceInfo?
    let recentActivity: [ActivityEntry]?

    enum CodingKeys: String, CodingKey {
        case shareId = "share_id"
        case status
        case expiresAt = "expires_at"
        case createdAt = "created_at"
        case isExpired = "is_expired"
        case totalEvents = "total_events"
        case eventCounts = "event_counts"
        case isClaimed = "is_claimed"
        case boundDevice = "bound_device"
        case recentActivity = "recent_activity"
    }

    struct EventCount: Codable, Sendable {
        let count: Int
        let lastAt: String?

        enum CodingKeys: String, CodingKey {
            case count
            case lastAt = "last_at"
        }
    }

    struct ActivityEntry: Codable, Sendable {
        let eventType: String
        let metadata: [String: String]?
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case eventType = "event_type"
            case metadata
            case createdAt = "created_at"
        }
    }

    struct BoundDeviceInfo: Codable, Sendable {
        let platform: String?
        let appVersion: String?
        let boundAt: String?

        enum CodingKeys: String, CodingKey {
            case platform
            case appVersion = "app_version"
            case boundAt = "bound_at"
        }
    }

    /// Check if share is revoked
    var isRevoked: Bool {
        status == "revoked"
    }

    /// Check if share is still valid (not expired and not revoked)
    var isValid: Bool {
        !isExpired && !isRevoked
    }
}

/// Response from DELETE /tracks/:id/share
struct RevokeShareResponse: Codable, Sendable {
    let revoked: Bool
}

/// QR code data URL response from GET /tracks/:id/share/qr-data
struct QRCodeDataResponse: Codable, Sendable {
    let shareUrl: String
    let qrDataUrl: String
    let size: Int

    enum CodingKeys: String, CodingKey {
        case shareUrl = "share_url"
        case qrDataUrl = "qr_data_url"
        case size
    }
}

/// Response from GET /share/:id
struct ShareInfoResponse: Codable, Sendable {
    let status: String
    let canAccess: Bool?
    let track: ShareTrackInfo?
    let trackPreview: ShareTrackInfo?
    let webStreamUrl: String?
    let appDownloadUrl: String?

    enum CodingKeys: String, CodingKey {
        case status
        case canAccess = "can_access"
        case track
        case trackPreview = "track_preview"
        case webStreamUrl = "web_stream_url"
        case appDownloadUrl = "app_download_url"
    }
}

struct ShareTrackInfo: Codable, Sendable {
    let title: String?
    let recipientName: String?
    let durationSec: Int?
    let coverImageUrl: String?

    enum CodingKeys: String, CodingKey {
        case title
        case recipientName = "recipient_name"
        case durationSec = "duration_sec"
        case coverImageUrl = "cover_image_url"
    }
}

/// Response from POST /share/:id/claim
struct ShareClaimResponse: Codable, Sendable {
    let status: String
    let appSaveAllowed: Bool?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case status
        case appSaveAllowed = "app_save_allowed"
        case expiresAt = "expires_at"
    }
}

/// Response from GET /share/:id/stream
struct ShareStreamResponse: Codable, Sendable {
    let streamUrl: String
    let format: String?
    let keyUrl: String?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case streamUrl = "stream_url"
        case format
        case keyUrl = "key_url"
        case expiresAt = "expires_at"
    }
}

// MARK: - Subscription Models

/// Response from POST /billing/receipt/apple
struct SyncReceiptResponse: Codable, Sendable {
    let success: Bool
    let subscription: SubscriptionInfo
    let entitlements: BillingEntitlements

    struct SubscriptionInfo: Codable, Sendable {
        let id: String
        let tier: String
        let status: String
        let songsGranted: Int
        let expiresAt: String?

        enum CodingKeys: String, CodingKey {
            case id, tier, status
            case songsGranted = "songs_granted"
            case expiresAt = "expires_at"
        }
    }
}

/// Response from GET /billing/entitlements
struct BillingEntitlements: Codable, Sendable {
    let tier: String
    let songsRemaining: Int
    let songsAllowance: Int
    let songsUsedTotal: Int
    let trialSongsRemaining: Int
    let trialExpiresAt: String?
    let previewCountToday: Int
    let planId: String?
    let billingPeriod: String?
    let subscriptionStartsAt: String?
    let subscriptionRenewsAt: String?
    let autoRenewEnabled: Bool?
    let isInGracePeriod: Bool?

    enum CodingKeys: String, CodingKey {
        case tier
        case songsRemaining = "songs_remaining"
        case songsAllowance = "songs_allowance"
        case songsUsedTotal = "songs_used_total"
        case trialSongsRemaining = "trial_songs_remaining"
        case trialExpiresAt = "trial_expires_at"
        case previewCountToday = "preview_count_today"
        case planId = "plan_id"
        case billingPeriod = "billing_period"
        case subscriptionStartsAt = "subscription_starts_at"
        case subscriptionRenewsAt = "subscription_renews_at"
        case autoRenewEnabled = "auto_renew_enabled"
        case isInGracePeriod = "is_in_grace_period"
    }

    /// Check if trial is active
    var isTrialActive: Bool {
        trialSongsRemaining > 0 && trialExpiresAt != nil
    }

    /// Parse trial expiration date
    var trialExpiresAtDate: Date? {
        guard let str = trialExpiresAt else { return nil }
        return ISO8601DateFormatter().date(from: str)
    }

    /// Parse subscription expiration date
    var subscriptionExpiresAtDate: Date? {
        guard let str = subscriptionRenewsAt else { return nil }
        return ISO8601DateFormatter().date(from: str)
    }
}

/// Response from GET /billing/subscription
struct SubscriptionResponse: Codable, Sendable {
    let hasSubscription: Bool
    let subscription: SubscriptionDetails?

    enum CodingKeys: String, CodingKey {
        case hasSubscription = "has_subscription"
        case subscription
    }

    struct SubscriptionDetails: Codable, Sendable {
        let id: String
        let tier: String
        let status: String
        let productId: String
        let expiresAt: String?
        let autoRenewEnabled: Bool
        let isInGracePeriod: Bool
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id, tier, status
            case productId = "product_id"
            case expiresAt = "expires_at"
            case autoRenewEnabled = "auto_renew_enabled"
            case isInGracePeriod = "is_in_grace_period"
            case createdAt = "created_at"
        }
    }
}

/// Response from POST /billing/trial/activate
struct ActivateTrialResponse: Codable, Sendable {
    let success: Bool
    let songsGranted: Int
    let songsRemaining: Int
    let trialExpiresAt: String
    let durationDays: Int

    enum CodingKeys: String, CodingKey {
        case success
        case songsGranted = "songs_granted"
        case songsRemaining = "songs_remaining"
        case trialExpiresAt = "trial_expires_at"
        case durationDays = "duration_days"
    }

    /// Parse trial expiration date
    var trialExpiresAtDate: Date? {
        ISO8601DateFormatter().date(from: trialExpiresAt)
    }
}

/// Response from GET /billing/plans
struct PlansResponse: Codable, Sendable {
    let plans: [SubscriptionPlan]
}

/// A subscription plan from the backend
struct SubscriptionPlan: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let tier: String
    let songsPerMonth: Int
    let previewsPerDay: Int
    let priceMonthly: Int?
    let priceAnnual: Int?
    let description: String?
    let features: [String]
    let isActive: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id, name, tier, description, features
        case songsPerMonth = "songs_per_month"
        case previewsPerDay = "previews_per_day"
        case priceMonthly = "price_monthly_cents"
        case priceAnnual = "price_annual_cents"
        case isActive = "is_active"
        case sortOrder = "sort_order"
    }

    /// Format price in dollars
    func formattedMonthlyPrice() -> String {
        guard let cents = priceMonthly else { return "Free" }
        return String(format: "$%.2f", Double(cents) / 100.0)
    }

    func formattedAnnualPrice() -> String {
        guard let cents = priceAnnual else { return "Free" }
        return String(format: "$%.2f", Double(cents) / 100.0)
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
        case .custom: return "✨"
        }
    }
}

// MARK: - V2 Story API Models

/// Request body for POST /story/start with V2 engine
struct StartStoryV2Request: Encodable, Sendable {
    let initialPrompt: String
    let occasion: String
    let recipientName: String
    let style: String?
    let engineVersion: String = "v2"

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
    let arc: String?
    let arcDisplayName: String?
    let recipientName: String?
    let progress: Int?
    let engineVersion: String?
    let suggestions: [String]?

    enum CodingKeys: String, CodingKey {
        case storyId = "story_id"
        case firstQuestion = "first_question"
        case arc
        case arcDisplayName = "arc_display_name"
        case recipientName = "recipient_name"
        case progress
        case engineVersion = "engine_version"
        case suggestions
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
}

// MARK: - Phone Auth Models

/// Response from POST /auth/phone/send-code
struct SendPhoneCodeResponse: Codable, Sendable {
    let success: Bool
    let expiresAt: String?
    let maskedPhone: String?

    enum CodingKeys: String, CodingKey {
        case success
        case expiresAt = "expires_at"
        case maskedPhone = "masked_phone"
    }
}

/// Response from POST /auth/phone/verify
struct VerifyPhoneCodeResponse: Codable, Sendable {
    let success: Bool
    let verified: Bool
    let registrationToken: String?
    let remainingAttempts: Int?
    let accessToken: String?
    let refreshToken: String?
    let userId: String?
    let isNewUser: Bool?

    enum CodingKeys: String, CodingKey {
        case success, verified
        case registrationToken = "registration_token"
        case remainingAttempts = "remaining_attempts"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case userId = "user_id"
        case isNewUser = "is_new_user"
    }
}

/// Response from POST /auth/phone/register
struct PhoneRegisterResponse: Codable, Sendable {
    let success: Bool
    let userId: String
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case success
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

/// Response from GET /users/username/available
struct UsernameAvailabilityResponse: Codable, Sendable {
    let available: Bool
    let suggestions: [String]?
}

// MARK: - Speech Transcription Models

/// Response from POST /v2/story/:id/audio
struct SpeechTranscriptionResponse: Codable, Sendable {
    let success: Bool
    let transcription: String
    let language: String?
    let duration: Double?
}
