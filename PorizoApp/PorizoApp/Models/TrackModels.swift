//
//  TrackModels.swift
//  PorizoApp
//
//  Track and version API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation
import SwiftUI

// MARK: - Voice Gender

/// Voice gender preference for AI voice generation
enum VoiceGender: String, Sendable, CaseIterable {
    case male = "male"
    case female = "female"

    var displayName: String {
        switch self {
        case .male: return "Male"
        case .female: return "Female"
        }
    }
}

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
    // Per-song occasion artwork (NEW — Warm Canvas paper-art per-song asset)
    // Lives at the track level (not per-version) and travels across share / NowPlaying / lockscreen.
    let artworkUrl: String?
    let artworkStyleVariant: String?
    // Pre-generated share data (populated when share token exists)
    var shareUrl: String? = nil
    var claimPin: String? = nil
    var shareExpiresAt: String? = nil

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
        case artworkUrl = "artwork_url"
        case artworkStyleVariant = "artwork_style_variant"
        case shareUrl = "share_url"
        case claimPin = "claim_pin"
        case shareExpiresAt = "share_expires_at"
    }

    var isReceived: Bool {
        libraryOrigin == "received"
    }

    var nowPlayingArtworkUrl: String? {
        artworkUrl ?? coverImageLargeUrl ?? coverImageUrl ?? coverImageSmallUrl
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

extension TrackVersion {
    var nowPlayingArtworkUrl: String? {
        coverImageLargeUrl ?? coverImageUrl ?? coverImageSmallUrl
    }
}

/// Response from GET /tracks/:id
struct GetTrackResponse: Codable, Sendable {
    let track: Track
    let versions: [TrackVersion]

    /// Returns the highest-numbered version that has a playable audio URL.
    /// Iterates in descending order to skip queued/failed versions without URLs.
    /// Prefers fullUrl (final quality), falls back to previewUrl.
    func latestPlayableVersion() -> (version: TrackVersion, audioUrl: String)? {
        for version in versions.sorted(by: { $0.versionNum > $1.versionNum }) {
            if let url = version.fullUrl ?? version.previewUrl, !url.isEmpty {
                return (version, url)
            }
        }
        return nil
    }
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
/// Lines can be plain strings OR objects with timing from Whisper alignment.
struct LyricsSection: Codable, Sendable, Identifiable {
    /// Stable identity derived from the section name (e.g. "verse_1", "chorus").
    var id: String { name }

    let name: String
    private(set) var lines: [LyricsLine]
    let startTime: Double?
    let endTime: Double?

    init(name: String, lines: [LyricsLine], startTime: Double? = nil, endTime: Double? = nil) {
        self.name = name
        self.lines = lines
        self.startTime = startTime
        self.endTime = endTime
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        var decodedLines = try container.decode([LyricsLine].self, forKey: .lines)
        for i in decodedLines.indices {
            decodedLines[i].id = "\(name)-\(i)"
        }
        lines = decodedLines
        startTime = try container.decodeIfPresent(Double.self, forKey: .startTime)
        endTime = try container.decodeIfPresent(Double.self, forKey: .endTime)
    }

    /// Plain text lines for display and editing (strips timing metadata)
    var lineTexts: [String] { lines.map(\.text) }

    enum CodingKeys: String, CodingKey {
        case name, lines
        case startTime = "startTime"
        case endTime = "endTime"
    }
}

/// A lyrics line — either a plain string or an object with text + timing.
struct LyricsLine: Codable, Sendable, Identifiable, CustomStringConvertible, ExpressibleByStringLiteral {
    /// Unique identity per instance (not derived from text, since chorus lines repeat).
    /// Stable identity assigned by parent LyricsSection decoder (section-index pattern).
    /// Mutable to allow parent to assign deterministic IDs after decoding.
    var id: String

    let text: String
    let startTime: Double?
    let endTime: Double?

    var description: String { text }

    /// Create from a plain string (for previews, tests, and string literals)
    init(stringLiteral value: String) {
        self.id = UUID().uuidString
        self.text = value
        self.startTime = nil
        self.endTime = nil
    }

    init(from decoder: Decoder) throws {
        self.id = UUID().uuidString
        // Try decoding as a plain string first
        if let str = try? decoder.singleValueContainer().decode(String.self) {
            self.text = str
            self.startTime = nil
            self.endTime = nil
            return
        }
        // Otherwise decode as an object with text + timing
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // Handle text field that may be a string or a nested {text: "..."} object
        if let str = try? container.decode(String.self, forKey: .text) {
            self.text = str
        } else if let nested = try? container.decode([String: String].self, forKey: .text),
                  let str = nested["text"] {
            self.text = str
        } else {
            self.text = ""
        }
        self.startTime = try container.decodeIfPresent(Double.self, forKey: .startTime)
        self.endTime = try container.decodeIfPresent(Double.self, forKey: .endTime)
    }

    enum CodingKeys: String, CodingKey {
        case text
        case startTime = "startTime"
        case endTime = "endTime"
    }
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
    let hasAnchor: Bool?

    enum CodingKeys: String, CodingKey {
        case approved
        case hasAnchor = "has_anchor"
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
    let errorSubcategory: String?
    let canAutoRewrite: Bool?
    let suggestedAction: String?
    let provider: String?
    let step: String?
    let stepIndex: Int?
    let workflowType: String?
    let startedAt: String?
    let completedAt: String?

    /// Returns fine-grained category if available, else the coarse wire category.
    var effectiveErrorCategory: String? { errorSubcategory ?? errorCategory }

    enum CodingKeys: String, CodingKey {
        case id, status, progress, step
        case resultUrl = "result_url"
        case errorCode = "error_code"
        case errorMessage = "error_message"
        case errorTerms = "error_terms"
        case errorCategory = "error_category"
        case errorSubcategory = "error_subcategory"
        case canAutoRewrite = "can_auto_rewrite"
        case suggestedAction = "suggested_action"
        case provider
        case stepIndex = "step_index"
        case workflowType = "workflow_type"
        case startedAt = "started_at"
        case completedAt = "completed_at"
    }
}

// MARK: - Music Styles (API-driven)

struct StyleOption: Identifiable, Sendable, Codable, Hashable {
    let key: String
    let displayName: String
    let energy: String
    let category: String
    var id: String { key }
}

@MainActor @Observable
final class StyleStore {
    private static let cacheKey = "porizo.cache.styles"

    private(set) var styles: [StyleOption] = StyleStore.defaultStyles

    var grouped: [(String, [StyleOption])] {
        let order = ["popular": 0, "african": 1, "latin": 2]
        return Dictionary(grouping: styles, by: \.category)
            .sorted { (order[$0.key] ?? 99) < (order[$1.key] ?? 99) }
            .map { ($0.key, $0.value) }
    }

    func load(from apiClient: APIClient) async {
        do {
            let info = try await apiClient.getStoryInfo()
            styles = info.styles
            if let data = try? JSONEncoder().encode(info.styles) {
                UserDefaults.standard.set(data, forKey: Self.cacheKey)
            }
        } catch {
            if let data = UserDefaults.standard.data(forKey: Self.cacheKey),
               let cached = try? JSONDecoder().decode([StyleOption].self, from: data) {
                styles = cached
            }
        }
    }

    func displayName(for key: String) -> String {
        styles.first { $0.key == key }?.displayName
            ?? key.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static let defaultStyles: [StyleOption] = [
        StyleOption(key: "pop", displayName: "Pop", energy: "medium", category: "popular"),
        StyleOption(key: "acoustic", displayName: "Acoustic", energy: "low", category: "popular"),
        StyleOption(key: "soul", displayName: "Soul", energy: "medium", category: "popular"),
        StyleOption(key: "folk", displayName: "Folk", energy: "low", category: "popular"),
        StyleOption(key: "jazz", displayName: "Jazz", energy: "medium", category: "popular"),
        StyleOption(key: "rnb", displayName: "R&B", energy: "medium", category: "popular"),
        StyleOption(key: "rock", displayName: "Rock", energy: "high", category: "popular"),
        StyleOption(key: "country", displayName: "Country", energy: "medium", category: "popular"),
        StyleOption(key: "ballad", displayName: "Ballad", energy: "low", category: "popular"),
        StyleOption(key: "afrobeats", displayName: "Afrobeats", energy: "high", category: "african"),
        StyleOption(key: "highlife", displayName: "Highlife", energy: "medium", category: "african"),
        StyleOption(key: "igbo_highlife", displayName: "Igbo Highlife", energy: "medium", category: "african"),
        StyleOption(key: "amapiano", displayName: "Amapiano", energy: "medium", category: "african"),

        StyleOption(key: "juju", displayName: "Jùjú", energy: "medium", category: "african"),
        StyleOption(key: "fuji", displayName: "Fuji", energy: "high", category: "african"),
        StyleOption(key: "afropop", displayName: "Afropop", energy: "medium", category: "african"),
        StyleOption(key: "reggaeton", displayName: "Reggaeton", energy: "high", category: "latin"),
        StyleOption(key: "salsa", displayName: "Salsa", energy: "high", category: "latin"),
        StyleOption(key: "bossa_nova", displayName: "Bossa Nova", energy: "low", category: "latin"),
        StyleOption(key: "cumbia", displayName: "Cumbia", energy: "medium", category: "latin"),
        StyleOption(key: "bachata", displayName: "Bachata", energy: "medium", category: "latin"),
        StyleOption(key: "samba", displayName: "Samba", energy: "high", category: "latin"),
        StyleOption(key: "latin_pop", displayName: "Latin Pop", energy: "medium", category: "latin"),
    ]
}

// MARK: - Occasions

/// Available occasions
enum Occasion: String, CaseIterable, Identifiable, Sendable {
    case birthday = "birthday"
    case mothersDay = "mothers_day"
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
    case friendship = "friendship"
    case getWell = "get_well"
    case custom = "custom"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .birthday: return "Birthday"
        case .mothersDay: return "Mother's Day"
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
        case .friendship: return "Friendship"
        case .getWell: return "Get Well"
        case .custom: return "Custom"
        }
    }

    var emoji: String {
        switch self {
        case .birthday: return "🎂"
        case .mothersDay: return "💐"
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
        case .friendship: return "👫"
        case .getWell: return "💊"
        case .custom: return "✨"
        }
    }

    /// Greeting phrase for reveal and share screens (e.g., "Happy Birthday").
    /// Returns nil for occasions without a natural greeting.
    var greeting: String? {
        switch self {
        case .birthday: return "Happy Birthday"
        case .mothersDay: return "Happy Mother's Day"
        case .anniversary: return "Happy Anniversary"
        case .thankYou: return "Thank You"
        case .iLoveYou: return "With Love"
        case .wedding: return "Congratulations"
        case .graduation: return "Congratulations"
        case .celebration: return "Let\u{2019}s Celebrate"
        case .apology: return "I\u{2019}m Sorry"
        case .encouragement: return "You Got This"
        case .advice: return "Words of Wisdom"
        case .bereavement: return "In Loving Memory"
        case .friendship: return "For a Friend"
        case .getWell: return "Get Well Soon"
        case .custom: return nil
        }
    }

    /// Greeting with trailing emoji (e.g., "Happy Birthday \u{1F382}").
    /// Used on the reveal bloom screen.
    var greetingWithEmoji: String? {
        guard let greeting else { return nil }
        return "\(greeting) \(emoji)"
    }

    /// Short label for song context (e.g., "\u{1F3B5} Birthday Song").
    /// Used in social share previews.
    var songLabel: String {
        "\u{1F3B5} \(displayName) Song"
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
    let style: String
    let narrativeVersion: Int?
    let finalNotes: String?
    let storyProvenance: StoryProvenance?
}
