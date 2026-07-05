package com.porizo.core.network

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class ErrorEnvelopeDto(
    val error: String?,
    val message: String?,
    val code: String?,
)

@JsonClass(generateAdapter = true)
data class SendPhoneCodeRequestDto(@Json(name = "phone_number") val phoneNumber: String)

@JsonClass(generateAdapter = true)
data class VerifyPhoneCodeRequestDto(
    @Json(name = "phone_number") val phoneNumber: String,
    val code: String,
)

@JsonClass(generateAdapter = true)
data class PhoneRegisterRequestDto(
    @Json(name = "registration_token") val registrationToken: String,
    @Json(name = "phone_number") val phoneNumber: String,
)

@JsonClass(generateAdapter = true)
data class SocialLoginRequestDto(
    val provider: String,
    @Json(name = "id_token") val idToken: String,
    val name: String?,
    @Json(name = "confirm_link") val confirmLink: Boolean?,
    @Json(name = "challenge_id") val challengeId: String?,
    val nonce: String?,
)

@JsonClass(generateAdapter = true)
data class RefreshRequestDto(@Json(name = "refresh_token") val refreshToken: String)

@JsonClass(generateAdapter = true)
data class SocialAuthChallengeRequestDto(val provider: String)

@JsonClass(generateAdapter = true)
data class SocialAuthChallengeDto(
    @Json(name = "challenge_id") val challengeId: String,
    val nonce: String,
    @Json(name = "expires_at") val expiresAt: String?,
)

@JsonClass(generateAdapter = true)
data class DeviceRegisterRequestDto(
    @Json(name = "device_id") val deviceId: String,
    val platform: String,
    @Json(name = "app_version") val appVersion: String,
    @Json(name = "push_token") val pushToken: String?,
)

@JsonClass(generateAdapter = true)
data class DeviceIntegrityNonceRequestDto(
    @Json(name = "device_id") val deviceId: String?,
    val platform: String?,
)

@JsonClass(generateAdapter = true)
data class DeviceIntegrityVerifyRequestDto(
    val nonce: String,
    @Json(name = "integrity_token") val integrityToken: String,
    @Json(name = "app_set_id") val appSetId: String?,
    @Json(name = "package_name") val packageName: String?,
)

@JsonClass(generateAdapter = true)
data class PhoneRegisterDto(
    @Json(name = "user_id") val userId: String?,
    @Json(name = "access_token") val accessToken: String?,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "expires_in") val expiresIn: Int?,
    @Json(name = "account_exists") val accountExists: Boolean?,
    @Json(name = "auth_methods") val authMethods: List<String>?,
    @Json(name = "masked_email") val maskedEmail: String?,
    @Json(name = "masked_phone") val maskedPhone: String?,
)

@JsonClass(generateAdapter = true)
data class SendPhoneCodeDto(
    val success: Boolean,
    @Json(name = "expires_at") val expiresAt: String?,
    @Json(name = "masked_phone") val maskedPhone: String?,
)

@JsonClass(generateAdapter = true)
data class VerifyPhoneCodeDto(
    val success: Boolean,
    val verified: Boolean,
    @Json(name = "registration_token") val registrationToken: String?,
    @Json(name = "remaining_attempts") val remainingAttempts: Int?,
    @Json(name = "access_token") val accessToken: String?,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "user_id") val userId: String?,
    @Json(name = "is_new_user") val isNewUser: Boolean?,
    @Json(name = "existing_user") val existingUser: Boolean?,
)

@JsonClass(generateAdapter = true)
data class DeviceRegistrationDto(
    @Json(name = "device_token") val deviceToken: String,
    @Json(name = "expires_at") val expiresAt: String,
)

@JsonClass(generateAdapter = true)
data class DeviceIntegrityNonceDto(
    val nonce: String,
    @Json(name = "request_hash") val requestHash: String?,
    @Json(name = "expires_at") val expiresAt: String?,
)

@JsonClass(generateAdapter = true)
data class DeviceIntegrityVerifyDto(
    val verified: Boolean?,
    @Json(name = "nonce_valid") val nonceValid: Boolean?,
    val status: String?,
    @Json(name = "app_set_id") val appSetId: String?,
)

@JsonClass(generateAdapter = true)
data class SocialAuthDto(
    @Json(name = "user_id") val userId: String?,
    @Json(name = "access_token") val accessToken: String?,
    @Json(name = "refresh_token") val refreshToken: String?,
    @Json(name = "expires_in") val expiresIn: Int?,
    @Json(name = "is_new_user") val isNewUser: Boolean?,
    @Json(name = "requires_link_confirmation") val requiresLinkConfirmation: Boolean?,
    @Json(name = "existing_account_email") val existingAccountEmail: String?,
    val provider: String?,
)

@JsonClass(generateAdapter = true)
data class RefreshDto(
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "refresh_token") val refreshToken: String,
    @Json(name = "expires_in") val expiresIn: Int?,
)

@JsonClass(generateAdapter = true)
data class AuthUserDto(
    @Json(name = "user_id") val userId: String,
    val email: String?,
    @Json(name = "display_name") val displayName: String?,
    @Json(name = "phone_number") val phoneNumber: String?,
    @Json(name = "email_verified") val emailVerified: Boolean?,
    @Json(name = "needs_profile_completion") val needsProfileCompletion: Boolean?,
)

@JsonClass(generateAdapter = true)
data class CreateTrackRequestDto(
    val title: String,
    val occasion: String,
    @Json(name = "recipient_name") val recipientName: String,
    val style: String,
    @Json(name = "duration_target") val durationTarget: Int,
    @Json(name = "voice_mode") val voiceMode: String,
    val message: String,
    @Json(name = "specific_memory") val specificMemory: String?,
    @Json(name = "special_phrases") val specialPhrases: String?,
    @Json(name = "what_makes_them_special") val whatMakesThemSpecial: String?,
)

@JsonClass(generateAdapter = true)
data class CreateTrackDto(
    @Json(name = "track_id") val trackId: String,
    val status: String,
)

@JsonClass(generateAdapter = true)
data class CreateVersionRequestDto(@Json(name = "render_type") val renderType: String)

@JsonClass(generateAdapter = true)
data class CreateVersionDto(
    @Json(name = "track_version_id") val trackVersionId: String,
    @Json(name = "version_num") val versionNum: Int,
    val status: String,
)

@JsonClass(generateAdapter = true)
data class TracksDto(val tracks: List<TrackSummaryDto>)

@JsonClass(generateAdapter = true)
data class TrackDetailDto(
    val track: TrackSummaryDto,
    val versions: List<TrackVersionDto>,
)

@JsonClass(generateAdapter = true)
data class TrackSummaryDto(
    val id: String,
    val title: String,
    val occasion: String?,
    @Json(name = "recipient_name") val recipientName: String?,
    val status: String,
    @Json(name = "latest_version") val latestVersion: Int?,
    @Json(name = "share_token_id") val shareTokenId: String?,
    @Json(name = "artwork_url") val artworkUrl: String?,
    @Json(name = "library_origin") val libraryOrigin: String?,
    @Json(name = "can_share") val canShare: Boolean?,
    @Json(name = "can_delete") val canDelete: Boolean?,
)

@JsonClass(generateAdapter = true)
data class TrackVersionDto(
    val id: String,
    @Json(name = "version_num") val versionNum: Int,
    val status: String,
    @Json(name = "preview_url") val previewUrl: String?,
    @Json(name = "full_url") val fullUrl: String?,
    @Json(name = "preview_job_id") val previewJobId: String?,
    @Json(name = "full_job_id") val fullJobId: String?,
    @Json(name = "last_error_code") val lastErrorCode: String?,
    @Json(name = "last_error_message") val lastErrorMessage: String?,
)

@JsonClass(generateAdapter = true)
data class PoemsDto(val poems: List<PoemSummaryDto>)

@JsonClass(generateAdapter = true)
data class PoemSummaryDto(
    val id: String,
    val title: String,
    @Json(name = "recipient_name") val recipientName: String,
    val occasion: String,
    val tone: String,
    val status: String,
    val verses: List<String>,
    @Json(name = "library_origin") val libraryOrigin: String?,
)

@JsonClass(generateAdapter = true)
data class PoemBodyDto(
    val id: String?,
    val title: String?,
    @Json(name = "recipient_name") val recipientName: String?,
    val verses: List<String>?,
    @Json(name = "preview_lines") val previewLines: List<String>?,
)

@JsonClass(generateAdapter = true)
data class StoryToPoemDto(val poem: PoemBodyDto)

@JsonClass(generateAdapter = true)
data class PoemShareInfoDto(
    val status: String,
    @Json(name = "can_access") val canAccess: Boolean?,
    val poem: PoemBodyDto?,
    @Json(name = "requires_pin") val requiresPin: Boolean?,
    @Json(name = "requires_pin_for_claim") val requiresPinForClaim: Boolean?,
)

@JsonClass(generateAdapter = true)
data class PoemAudioDto(
    @Json(name = "audio_url") val audioUrl: String?,
    val status: String?,
)

@JsonClass(generateAdapter = true)
data class StartStoryRequestDto(
    @Json(name = "initial_prompt") val initialPrompt: String,
    val occasion: String,
    @Json(name = "recipient_name") val recipientName: String,
)

@JsonClass(generateAdapter = true)
data class ContinueStoryRequestDto(
    val answer: String,
    @Json(name = "expected_session_version") val expectedSessionVersion: Int?,
)

@JsonClass(generateAdapter = true)
data class StartStoryDto(
    @Json(name = "story_id") val storyId: String,
    val question: String?,
    @Json(name = "first_question") val firstQuestion: String?,
    @Json(name = "session_version") val sessionVersion: Int?,
)

@JsonClass(generateAdapter = true)
data class ContinueStoryDto(
    val question: String?,
    @Json(name = "next_question") val nextQuestion: String?,
    @Json(name = "session_version") val sessionVersion: Int?,
    @Json(name = "can_finish") val canFinish: Boolean?,
    @Json(name = "is_complete") val isComplete: Boolean?,
    val complete: Boolean?,
)

@JsonClass(generateAdapter = true)
data class ConfirmStoryDto(
    @Json(name = "story_id") val storyId: String?,
    val confirmed: Boolean?,
)

@JsonClass(generateAdapter = true)
data class StoryGuidanceDto(
    val message: String?,
    val question: String?,
)

@JsonClass(generateAdapter = true)
data class StoryLyricsDto(
    val lyrics: LyricsDocumentDto?,
    @Json(name = "quality_score") val qualityScore: Double?,
)

@JsonClass(generateAdapter = true)
data class StoryToTrackRequestDto(@Json(name = "voice_mode") val voiceMode: String?)

@JsonClass(generateAdapter = true)
data class StoryToTrackDto(
    @Json(name = "track_id") val trackId: String,
    @Json(name = "version_num") val versionNum: Int?,
)

@JsonClass(generateAdapter = true)
data class ShareTrackInfoDto(
    val title: String?,
    @Json(name = "recipient_name") val recipientName: String?,
    @Json(name = "sender_name") val senderName: String?,
    @Json(name = "duration_sec") val durationSec: Int?,
    @Json(name = "cover_image_url") val coverImageUrl: String?,
    @Json(name = "artwork_url") val artworkUrl: String?,
)

@JsonClass(generateAdapter = true)
data class CreateShareRequestDto(
    @Json(name = "require_pin") val requirePin: Boolean,
    @Json(name = "version_num") val versionNum: Int?,
)

@JsonClass(generateAdapter = true)
data class CreateShareDto(
    @Json(name = "share_id") val shareId: String,
    @Json(name = "share_url") val shareUrl: String,
    @Json(name = "claim_pin") val claimPin: String?,
    @Json(name = "expires_at") val expiresAt: String?,
)

@JsonClass(generateAdapter = true)
data class ShareInfoDto(
    val status: String,
    @Json(name = "app_only") val appOnly: Boolean?,
    @Json(name = "can_access") val canAccess: Boolean?,
    @Json(name = "app_required") val appRequired: Boolean?,
    @Json(name = "claim_requires_app") val claimRequiresApp: Boolean?,
    @Json(name = "pin_required_for_claim") val pinRequiredForClaim: Boolean?,
    @Json(name = "receiver_save_requires_session") val receiverSaveRequiresSession: Boolean?,
    val track: ShareTrackInfoDto?,
    @Json(name = "track_preview") val trackPreview: ShareTrackInfoDto?,
    @Json(name = "web_stream_url") val webStreamUrl: String?,
    @Json(name = "app_download_url") val appDownloadUrl: String?,
    @Json(name = "is_demo") val isDemo: Boolean?,
)

@JsonClass(generateAdapter = true)
data class ClaimShareRequestDto(
    val pin: String?,
    @Json(name = "app_version") val appVersion: String?,
)

@JsonClass(generateAdapter = true)
data class ShareClaimDto(
    val status: String,
    @Json(name = "app_save_allowed") val appSaveAllowed: Boolean?,
    @Json(name = "expires_at") val expiresAt: String?,
    @Json(name = "track_id") val trackId: String?,
    @Json(name = "track_version_id") val trackVersionId: String?,
    @Json(name = "stream_path") val streamPath: String?,
    @Json(name = "receiver_claim_stream_path") val receiverClaimStreamPath: String?,
)

@JsonClass(generateAdapter = true)
data class ReceiverHandoffDto(
    @Json(name = "receiver_session_id") val receiverSessionId: String,
    @Json(name = "content_kind") val contentKind: String,
    @Json(name = "receiver_claim_token") val receiverClaimToken: String,
    @Json(name = "receiver_claim_expires_at") val receiverClaimExpiresAt: String?,
)

@JsonClass(generateAdapter = true)
data class ReceiverClaimRequestDto(
    @Json(name = "device_id") val deviceId: String,
    val platform: String,
    @Json(name = "app_version") val appVersion: String,
    val pin: String?,
)

@JsonClass(generateAdapter = true)
data class ShareStreamDto(
    @Json(name = "stream_url") val streamUrl: String,
    val format: String?,
    @Json(name = "key_url") val keyUrl: String?,
    @Json(name = "expires_at") val expiresAt: String?,
)

@JsonClass(generateAdapter = true)
data class RenderPreviewDto(
    @Json(name = "job_id") val jobId: String?,
    @Json(name = "estimated_completion_sec") val estimatedCompletionSec: Int?,
    @Json(name = "poll_url") val pollUrl: String?,
)

@JsonClass(generateAdapter = true)
data class RenderFullDto(
    @Json(name = "job_id") val jobId: String?,
    @Json(name = "estimated_completion_sec") val estimatedCompletionSec: Int?,
)

@JsonClass(generateAdapter = true)
data class ApproveLyricsDto(val status: String?)

@JsonClass(generateAdapter = true)
data class LyricsWrapperDto(val lyrics: LyricsDocumentDto?)

@JsonClass(generateAdapter = true)
data class LyricsDocumentDto(
    val title: String? = null,
    val style: String? = null,
    val sections: List<LyricsSectionDto> = emptyList(),
    @Json(name = "anchor_line") val anchorLine: String? = null,
)

@JsonClass(generateAdapter = true)
data class LyricsSectionDto(
    val name: String = "",
    val lines: List<String> = emptyList(),
    @Json(name = "startTime") val startTime: Double? = null,
    @Json(name = "endTime") val endTime: Double? = null,
)

@JsonClass(generateAdapter = true)
data class JobStatusDto(
    val id: String,
    val status: String,
    val progress: Int?,
    @Json(name = "result_url") val resultUrl: String?,
    @Json(name = "error_code") val errorCode: String?,
    @Json(name = "error_message") val errorMessage: String?,
    @Json(name = "error_terms") val errorTerms: List<String>?,
    @Json(name = "error_category") val errorCategory: String?,
    @Json(name = "error_subcategory") val errorSubcategory: String?,
    @Json(name = "can_auto_rewrite") val canAutoRewrite: Boolean?,
    @Json(name = "suggested_action") val suggestedAction: String?,
    val provider: String?,
    val step: String?,
    @Json(name = "step_index") val stepIndex: Int?,
    @Json(name = "workflow_type") val workflowType: String?,
    @Json(name = "started_at") val startedAt: String?,
    @Json(name = "completed_at") val completedAt: String?,
)

@JsonClass(generateAdapter = true)
data class BillingEntitlementsDto(
    val tier: String?,
    @Json(name = "base_songs_remaining") val baseSongsRemaining: Int?,
    @Json(name = "songs_remaining") val songsRemaining: Int?,
    @Json(name = "songs_allowance") val songsAllowance: Int?,
    @Json(name = "poems_remaining") val poemsRemaining: Int?,
    @Json(name = "poems_allowance") val poemsAllowance: Int?,
    @Json(name = "trial_songs_remaining") val trialSongsRemaining: Int?,
    @Json(name = "gift_wallet_balance") val giftWalletBalance: Int?,
    @Json(name = "available_song_credits") val availableSongCredits: Int?,
    @Json(name = "pay_per_song_enabled") val payPerSongEnabled: Boolean?,
    @Json(name = "gift_tokens_remaining") val giftTokensRemaining: Int?,
    @Json(name = "auto_renew_enabled") val autoRenewEnabled: Boolean?,
)

@JsonClass(generateAdapter = true)
data class GoogleSubscriptionSummaryDto(
    val id: String,
    val tier: String?,
    val status: String?,
    @Json(name = "expires_at") val expiresAt: String?,
    @Json(name = "auto_renewing") val autoRenewing: Boolean?,
)

@JsonClass(generateAdapter = true)
data class GoogleReceiptRequestDto(
    @Json(name = "purchase_token") val purchaseToken: String,
    @Json(name = "subscription_id") val subscriptionId: String,
)

@JsonClass(generateAdapter = true)
data class GoogleConsumableReceiptRequestDto(
    @Json(name = "purchase_token") val purchaseToken: String,
    @Json(name = "product_id") val productId: String,
)

@JsonClass(generateAdapter = true)
data class GoogleReceiptDto(
    val success: Boolean,
    val subscription: GoogleSubscriptionSummaryDto?,
    val entitlements: BillingEntitlementsDto?,
)

@JsonClass(generateAdapter = true)
data class PlansDto(val plans: List<SubscriptionPlanDto>)

@JsonClass(generateAdapter = true)
data class SubscriptionPlanProductIdsDto(
    val monthly: String?,
    val annual: String?,
)

@JsonClass(generateAdapter = true)
data class SubscriptionPlanDto(
    val id: String,
    val name: String,
    val tier: String,
    @Json(name = "songs_per_month") val songsPerMonth: Int,
    @Json(name = "poems_per_month") val poemsPerMonth: Int,
    @Json(name = "price_monthly_cents") val priceMonthlyCents: Int?,
    @Json(name = "price_annual_cents") val priceAnnualCents: Int?,
    val description: String?,
    val features: List<String>,
    @Json(name = "is_active") val isActive: Boolean,
    @Json(name = "sort_order") val sortOrder: Int,
    @Json(name = "google_product_ids") val googleProductIds: SubscriptionPlanProductIdsDto?,
)

@JsonClass(generateAdapter = true)
data class SubscriptionStatusDto(
    val hasActiveSubscription: Boolean?,
    @Json(name = "has_subscription") val hasSubscription: Boolean?,
    val subscription: SubscriptionStatusSummaryDto?,
    val entitlements: BillingEntitlementsDto?,
)

@JsonClass(generateAdapter = true)
data class SubscriptionStatusSummaryDto(
    val id: String?,
    val tier: String?,
    val status: String?,
    @Json(name = "product_id") val productId: String?,
    val platform: String?,
    @Json(name = "expires_at") val expiresAt: String?,
    @Json(name = "auto_renew_enabled") val autoRenewEnabled: Boolean?,
    @Json(name = "is_in_grace_period") val isInGracePeriod: Boolean?,
)

@JsonClass(generateAdapter = true)
data class EnrollmentStartRequestDto(
    @Json(name = "consent_accepted") val consentAccepted: Boolean,
    @Json(name = "consent_version") val consentVersion: String,
    @Json(name = "consent_scopes") val consentScopes: List<String>,
    @Json(name = "voice_suno_persona_consent") val voiceSunoPersonaConsent: Boolean,
)

@JsonClass(generateAdapter = true)
data class EnrollmentSessionDto(
    @Json(name = "session_id") val sessionId: String,
    @Json(name = "session_expires_at") val sessionExpiresAt: String,
    val prompts: List<EnrollmentPromptDto>?,
    @Json(name = "prompt_set_id") val promptSetId: String?,
    @Json(name = "upload_urls") val uploadUrls: List<UploadUrlDto>?,
    @Json(name = "recording_settings") val recordingSettings: RecordingSettingsDto?,
)

@JsonClass(generateAdapter = true)
data class EnrollmentPromptDto(
    val id: String,
    val text: String,
    val type: String,
    @Json(name = "duration_hint_sec") val durationHintSec: Int?,
    @Json(name = "pitch_hint") val pitchHint: String?,
)

@JsonClass(generateAdapter = true)
data class UploadUrlDto(
    @Json(name = "chunk_id") val chunkId: String,
    val url: String,
    val method: String?,
    val headers: Map<String, String>?,
    @Json(name = "expires_at") val expiresAt: String?,
)

@JsonClass(generateAdapter = true)
data class RecordingSettingsDto(
    @Json(name = "sample_rate") val sampleRate: Int,
    val channels: Int,
    val format: String,
    @Json(name = "max_chunk_duration_sec") val maxChunkDurationSec: Int?,
)

@JsonClass(generateAdapter = true)
data class ChunkUploadedRequestDto(
    @Json(name = "session_id") val sessionId: String,
    @Json(name = "chunk_id") val chunkId: String,
    @Json(name = "duration_sec") val durationSec: Double,
    @Json(name = "client_checksum") val clientChecksum: String?,
)

@JsonClass(generateAdapter = true)
data class ChunkUploadDto(
    val status: String,
    @Json(name = "qc_job_id") val qcJobId: String?,
    @Json(name = "next_upload_url") val nextUploadUrl: UploadUrlDto?,
    @Json(name = "chunk_id") val chunkId: String?,
    @Json(name = "duration_sec") val durationSec: Double?,
)

@JsonClass(generateAdapter = true)
data class CompleteEnrollmentRequestDto(
    @Json(name = "session_id") val sessionId: String,
    @Json(name = "consent_scopes") val consentScopes: List<String>,
    @Json(name = "voice_suno_persona_consent") val voiceSunoPersonaConsent: Boolean,
)

@JsonClass(generateAdapter = true)
data class VoiceProfileDto(
    @Json(name = "voice_profile_id") val voiceProfileId: String,
    @Json(name = "quality_score") val qualityScore: Double?,
    val status: String,
    @Json(name = "job_id") val jobId: String?,
    @Json(name = "estimated_completion_sec") val estimatedCompletionSec: Int?,
    val outcome: String?,
    val quality: EnrollmentQualityDto?,
)

@JsonClass(generateAdapter = true)
data class EnrollmentQualityDto(
    val tier: String?,
    val score: Double?,
    val label: String?,
    val disclosure: String?,
    @Json(name = "can_improve") val canImprove: Boolean?,
    @Json(name = "improvement_tips") val improvementTips: List<String>?,
)

@JsonClass(generateAdapter = true)
data class VoiceProfileStatusDto(
    @Json(name = "profile_id") val profileId: String?,
    val status: String?,
    @Json(name = "quality_score") val qualityScore: Double?,
    @Json(name = "quality_tier") val qualityTier: String?,
    @Json(name = "created_at") val createdAt: String?,
    @Json(name = "my_voice_ready") val myVoiceReady: Boolean?,
)
