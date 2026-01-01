//
//  Models.swift
//  PorizoApp
//
//  API response types matching the Node.js backend.
//

import Foundation

// MARK: - Enrollment Models

/// Response from POST /voice/enrollment/start
struct EnrollmentSession: Codable {
    let sessionId: String
    let sessionExpiresAt: String
    let prompts: [EnrollmentPrompt]?
    let promptSetId: String?
    let recordingSettings: RecordingSettings?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case sessionExpiresAt = "session_expires_at"
        case prompts
        case promptSetId = "prompt_set_id"
        case recordingSettings = "recording_settings"
    }
}

/// Recording settings from backend
struct RecordingSettings: Codable {
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
struct EnrollmentPrompt: Codable {
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
struct ChunkUploadResponse: Codable {
    let status: String  // "accepted"
    let chunkId: String
    let durationSec: Double

    enum CodingKeys: String, CodingKey {
        case status
        case chunkId = "chunk_id"
        case durationSec = "duration_sec"
    }
}

/// Response from POST /voice/enrollment/complete
struct VoiceProfile: Codable {
    let voiceProfileId: String
    let qualityScore: Double?  // Backend returns float, not int
    let status: String
    let jobId: String?
    let estimatedCompletionSec: Int?

    enum CodingKeys: String, CodingKey {
        case voiceProfileId = "voice_profile_id"
        case qualityScore = "quality_score"
        case status
        case jobId = "job_id"
        case estimatedCompletionSec = "estimated_completion_sec"
    }
}

/// Response from GET /voice/profile
struct VoiceProfileStatus: Codable {
    let hasProfile: Bool
    let voiceProfileId: String?
    let qualityScore: Int?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case hasProfile = "has_profile"
        case voiceProfileId = "voice_profile_id"
        case qualityScore = "quality_score"
        case createdAt = "created_at"
    }
}

// MARK: - Error Models

/// API error response
struct APIError: Codable, Error {
    let error: String
    let message: String
    let details: [String: String]?
}

// MARK: - App State

/// Local enrollment state for tracking progress
enum EnrollmentState {
    case notStarted
    case recording(prompt: String, type: PromptType)
    case uploading
    case processing
    case completed(qualityScore: Int)
    case failed(error: String)
}

enum PromptType: String {
    case spoken = "spoken"
    case sung = "sung"
}

/// Chunk tracking for upload progress
struct RecordedChunk {
    let id: String
    let type: PromptType
    let audioURL: URL
    let duration: TimeInterval
    var uploaded: Bool = false
}
