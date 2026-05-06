//
//  EnrollmentModels.swift
//  PorizoApp
//
//  Voice enrollment API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation
import SwiftUI

// MARK: - Enrollment Session

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

// MARK: - Voice Profile

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
    let myVoiceReady: Bool?
    let voiceProviderProfile: VoiceProviderProfileStatus?

    init(
        profileId: String?,
        status: String?,
        qualityScore: Double?,
        qualityTier: String?,
        createdAt: String?,
        myVoiceReady: Bool? = nil,
        voiceProviderProfile: VoiceProviderProfileStatus? = nil
    ) {
        self.profileId = profileId
        self.status = status
        self.qualityScore = qualityScore
        self.qualityTier = qualityTier
        self.createdAt = createdAt
        self.myVoiceReady = myVoiceReady
        self.voiceProviderProfile = voiceProviderProfile
    }

    /// Computed property - has active profile if status is "active"
    var hasProfile: Bool {
        status == "active"
    }

    /// My Voice rendering requires the local voice profile and Suno persona.
    var isMyVoiceReady: Bool {
        myVoiceReady ?? (hasProfile && voiceProviderProfile?.ready == true)
    }

    var isMyVoicePreparing: Bool {
        guard hasProfile, !isMyVoiceReady else { return false }
        switch voiceProviderProfile?.status {
        case "pending", "upload_submitted", "cover_submitted", "persona_submitted":
            return true
        default:
            return false
        }
    }

    var isMyVoiceSetupRequired: Bool {
        guard hasProfile, !isMyVoiceReady, !isMyVoicePreparing, !didMyVoiceSetupFail else {
            return false
        }
        switch voiceProviderProfile?.status {
        case nil, "consent_required", "source_audio_unavailable":
            return true
        default:
            return voiceProviderProfile?.ready != true
        }
    }

    var didMyVoiceSetupFail: Bool {
        voiceProviderProfile?.status == "failed"
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
        case myVoiceReady = "my_voice_ready"
        case voiceProviderProfile = "voice_provider_profile"
    }
}

struct VoiceProviderProfileStatus: Codable, Sendable {
    let id: String?
    let provider: String?
    let status: String?
    let ready: Bool?
    let hasProviderProfileId: Bool?
    let updatedAt: String?
    let lastError: String?

    enum CodingKeys: String, CodingKey {
        case id
        case provider
        case status
        case ready
        case hasProviderProfileId = "has_provider_profile_id"
        case updatedAt = "updated_at"
        case lastError = "last_error"
    }
}

// MARK: - Quality Tier

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

// MARK: - Enrollment Outcome

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

// MARK: - Enrollment State

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
