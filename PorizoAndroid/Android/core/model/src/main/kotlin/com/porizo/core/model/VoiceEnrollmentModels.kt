package com.porizo.core.model

data class EnrollmentSession(
    val sessionId: String,
    val sessionExpiresAt: String,
    val prompts: List<EnrollmentPrompt>?,
    val promptSetId: String?,
    val uploadUrls: List<UploadUrl>?,
    val recordingSettings: RecordingSettings?,
)

data class EnrollmentPrompt(
    val id: String,
    val text: String,
    val type: String,
    val durationHintSec: Int?,
    val pitchHint: String?,
)

data class UploadUrl(
    val chunkId: String,
    val url: String,
    val method: String?,
    val headers: Map<String, String>?,
    val expiresAt: String?,
)

data class RecordingSettings(
    val sampleRate: Int,
    val channels: Int,
    val format: String,
    val maxChunkDurationSec: Int?,
)

data class ChunkUploadResult(
    val status: String,
    val qcJobId: String?,
    val nextUploadUrl: UploadUrl?,
    val chunkId: String?,
    val durationSec: Double?,
)

data class VoiceProfile(
    val voiceProfileId: String,
    val qualityScore: Double?,
    val status: String,
    val jobId: String?,
    val estimatedCompletionSec: Int?,
    val outcome: String?,
    val quality: EnrollmentQuality?,
)

data class EnrollmentQuality(
    val tier: String?,
    val score: Double?,
    val label: String?,
    val disclosure: String?,
    val canImprove: Boolean?,
    val improvementTips: List<String>?,
)

data class VoiceProfileStatus(
    val profileId: String?,
    val status: String?,
    val qualityScore: Double?,
    val qualityTier: String?,
    val createdAt: String?,
    val myVoiceReady: Boolean?,
)
