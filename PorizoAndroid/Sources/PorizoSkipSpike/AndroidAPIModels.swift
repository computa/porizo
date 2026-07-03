import Foundation

struct PorizoAPIErrorEnvelope: Codable, Sendable {
    let error: String?
    let message: String?
    let code: String?
}

struct PorizoAuthSession: Codable, Sendable {
    let userId: String
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

struct PorizoPhoneRegisterResponse: Codable, Sendable {
    let userId: String?
    let accessToken: String?
    let refreshToken: String?
    let expiresIn: Int?
    let accountExists: Bool?
    let authMethods: [String]?
    let maskedEmail: String?
    let maskedPhone: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case accountExists = "account_exists"
        case authMethods = "auth_methods"
        case maskedEmail = "masked_email"
        case maskedPhone = "masked_phone"
    }
}

struct PorizoSendPhoneCodeResponse: Codable, Sendable {
    let success: Bool
    let expiresAt: String?
    let maskedPhone: String?

    enum CodingKeys: String, CodingKey {
        case success
        case expiresAt = "expires_at"
        case maskedPhone = "masked_phone"
    }
}

struct PorizoVerifyPhoneCodeResponse: Codable, Sendable {
    let success: Bool
    let verified: Bool
    let registrationToken: String?
    let remainingAttempts: Int?
    let accessToken: String?
    let refreshToken: String?
    let userId: String?
    let isNewUser: Bool?
    let existingUser: Bool?

    enum CodingKeys: String, CodingKey {
        case success, verified
        case registrationToken = "registration_token"
        case remainingAttempts = "remaining_attempts"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case userId = "user_id"
        case isNewUser = "is_new_user"
        case existingUser = "existing_user"
    }
}

struct PorizoDeviceRegistrationResponse: Codable, Sendable {
    let deviceToken: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case deviceToken = "device_token"
        case expiresAt = "expires_at"
    }
}

/// Response from POST /auth/social (Google). Either carries tokens, OR signals a
/// cross-provider account link that must be confirmed with a second call
/// (requires_link_confirmation), mirroring iOS AuthManager.
struct PorizoSocialAuthResponse: Codable, Sendable {
    let userId: String?
    let accessToken: String?
    let refreshToken: String?
    let expiresIn: Int?
    let isNewUser: Bool?
    let requiresLinkConfirmation: Bool?
    let existingAccountEmail: String?
    let provider: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case isNewUser = "is_new_user"
        case requiresLinkConfirmation = "requires_link_confirmation"
        case existingAccountEmail = "existing_account_email"
        case provider
    }
}

/// Response from POST /auth/refresh. Rotated token pair.
struct PorizoRefreshResponse: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

/// Current authenticated user from GET /auth/me.
struct PorizoAuthUser: Codable, Sendable {
    let userId: String
    let email: String?
    let displayName: String?
    let phoneNumber: String?
    let emailVerified: Bool?
    let needsProfileCompletion: Bool?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case email
        case displayName = "display_name"
        case phoneNumber = "phone_number"
        case emailVerified = "email_verified"
        case needsProfileCompletion = "needs_profile_completion"
    }
}

struct PorizoCreateTrackRequest: Encodable, Sendable {
    let title: String
    let occasion: String
    let recipientName: String
    let style: String
    let durationTarget: Int
    let voiceMode: String
    let message: String
    let specificMemory: String?
    let specialPhrases: String?
    let whatMakesThemSpecial: String?

    enum CodingKeys: String, CodingKey {
        case title, occasion, style, message
        case recipientName = "recipient_name"
        case durationTarget = "duration_target"
        case voiceMode = "voice_mode"
        case specificMemory = "specific_memory"
        case specialPhrases = "special_phrases"
        case whatMakesThemSpecial = "what_makes_them_special"
    }
}

struct PorizoCreateTrackResponse: Codable, Sendable {
    let trackId: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case trackId = "track_id"
        case status
    }
}

struct PorizoCreateVersionResponse: Codable, Sendable {
    let trackVersionId: String
    let versionNum: Int
    let status: String

    enum CodingKeys: String, CodingKey {
        case trackVersionId = "track_version_id"
        case versionNum = "version_num"
        case status
    }
}

struct PorizoTrackSummary: Codable, Sendable, Identifiable {
    let id: String
    let title: String
    let occasion: String?
    let recipientName: String?
    let status: String
    let latestVersion: Int?
    let shareTokenId: String?
    let artworkUrl: String?
    let libraryOrigin: String?
    let canShare: Bool?
    let canDelete: Bool?

    /// True when this track was received from someone else (drives the
    /// My/Received filter), mirroring iOS `Track.isReceived`.
    var isReceived: Bool { libraryOrigin == "received" }

    enum CodingKeys: String, CodingKey {
        case id, title, occasion, status
        case recipientName = "recipient_name"
        case latestVersion = "latest_version"
        case shareTokenId = "share_token_id"
        case artworkUrl = "artwork_url"
        case libraryOrigin = "library_origin"
        case canShare = "can_share"
        case canDelete = "can_delete"
    }
}

struct PorizoGetTracksResponse: Codable, Sendable {
    let tracks: [PorizoTrackSummary]
}

/// A rendered version of a track. `preview_url`/`full_url` are the playable
/// stream URLs when present (mirrors iOS `TrackVersion`).
struct PorizoTrackVersion: Codable, Sendable, Identifiable {
    let id: String
    let versionNum: Int
    let status: String
    let previewUrl: String?
    let fullUrl: String?

    /// Best available playable URL: full render preferred over preview.
    var playableUrl: String? { fullUrl ?? previewUrl }

    enum CodingKeys: String, CodingKey {
        case id, status
        case versionNum = "version_num"
        case previewUrl = "preview_url"
        case fullUrl = "full_url"
    }
}

struct PorizoGetTrackResponse: Codable, Sendable {
    let track: PorizoTrackSummary
    let versions: [PorizoTrackVersion]
}

struct PorizoPoemSummary: Codable, Sendable, Identifiable {
    let id: String
    let title: String
    let recipientName: String
    let occasion: String
    let tone: String
    let status: String
    let verses: [String]

    enum CodingKeys: String, CodingKey {
        case id, title, occasion, tone, status, verses
        case recipientName = "recipient_name"
    }
}

struct PorizoGetPoemsResponse: Codable, Sendable {
    let poems: [PorizoPoemSummary]
}

struct PorizoShareTrackInfo: Codable, Sendable {
    let title: String?
    let recipientName: String?
    let senderName: String?
    let durationSec: Int?
    let coverImageUrl: String?
    let artworkUrl: String?

    enum CodingKeys: String, CodingKey {
        case title
        case recipientName = "recipient_name"
        case senderName = "sender_name"
        case durationSec = "duration_sec"
        case coverImageUrl = "cover_image_url"
        case artworkUrl = "artwork_url"
    }
}

struct PorizoShareInfoResponse: Codable, Sendable {
    let status: String
    let appOnly: Bool?
    let canAccess: Bool?
    let appRequired: Bool?
    let claimRequiresApp: Bool?
    let pinRequiredForClaim: Bool?
    let receiverSaveRequiresSession: Bool?
    let track: PorizoShareTrackInfo?
    let trackPreview: PorizoShareTrackInfo?
    let webStreamUrl: String?
    let appDownloadUrl: String?
    let isDemo: Bool?

    enum CodingKeys: String, CodingKey {
        case status
        case appOnly = "app_only"
        case canAccess = "can_access"
        case appRequired = "app_required"
        case claimRequiresApp = "claim_requires_app"
        case pinRequiredForClaim = "pin_required_for_claim"
        case receiverSaveRequiresSession = "receiver_save_requires_session"
        case track
        case trackPreview = "track_preview"
        case webStreamUrl = "web_stream_url"
        case appDownloadUrl = "app_download_url"
        case isDemo = "is_demo"
    }
}

struct PorizoShareClaimResponse: Codable, Sendable {
    let status: String
    let appSaveAllowed: Bool?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case status
        case appSaveAllowed = "app_save_allowed"
        case expiresAt = "expires_at"
    }
}

struct PorizoReceiverHandoffResponse: Codable, Sendable {
    let receiverSessionId: String
    let contentKind: String
    let receiverClaimToken: String
    let receiverClaimExpiresAt: String?

    enum CodingKeys: String, CodingKey {
        case receiverSessionId = "receiver_session_id"
        case contentKind = "content_kind"
        case receiverClaimToken = "receiver_claim_token"
        case receiverClaimExpiresAt = "receiver_claim_expires_at"
    }
}

struct PorizoShareStreamResponse: Codable, Sendable {
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

struct PorizoRenderPreviewResponse: Codable, Sendable {
    let jobId: String?
    let estimatedCompletionSec: Int?
    let pollUrl: String?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case estimatedCompletionSec = "estimated_completion_sec"
        case pollUrl = "poll_url"
    }
}

struct PorizoRenderFullResponse: Codable, Sendable {
    let jobId: String?
    let estimatedCompletionSec: Int?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case estimatedCompletionSec = "estimated_completion_sec"
    }
}

struct PorizoJobStatus: Codable, Sendable {
    let id: String
    let status: String
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

    enum CodingKeys: String, CodingKey {
        case id, status, progress, provider, step
        case resultUrl = "result_url"
        case errorCode = "error_code"
        case errorMessage = "error_message"
        case errorTerms = "error_terms"
        case errorCategory = "error_category"
        case errorSubcategory = "error_subcategory"
        case canAutoRewrite = "can_auto_rewrite"
        case suggestedAction = "suggested_action"
        case stepIndex = "step_index"
        case workflowType = "workflow_type"
        case startedAt = "started_at"
        case completedAt = "completed_at"
    }
}

struct PorizoBillingEntitlements: Codable, Sendable {
    let tier: String?
    let baseSongsRemaining: Int?
    let songsRemaining: Int?
    let songsAllowance: Int?
    let poemsRemaining: Int?
    let poemsAllowance: Int?
    let trialSongsRemaining: Int?
    let giftWalletBalance: Int?
    let availableSongCredits: Int?
    let payPerSongEnabled: Bool?
    let giftTokensRemaining: Int?
    let autoRenewEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case tier
        case baseSongsRemaining = "base_songs_remaining"
        case songsRemaining = "songs_remaining"
        case songsAllowance = "songs_allowance"
        case poemsRemaining = "poems_remaining"
        case poemsAllowance = "poems_allowance"
        case trialSongsRemaining = "trial_songs_remaining"
        case giftWalletBalance = "gift_wallet_balance"
        case availableSongCredits = "available_song_credits"
        case payPerSongEnabled = "pay_per_song_enabled"
        case giftTokensRemaining = "gift_tokens_remaining"
        case autoRenewEnabled = "auto_renew_enabled"
    }
}

struct PorizoGoogleSubscriptionSummary: Codable, Sendable {
    let id: String
    let tier: String?
    let status: String?
    let expiresAt: String?
    let autoRenewing: Bool?

    enum CodingKeys: String, CodingKey {
        case id, tier, status
        case expiresAt = "expires_at"
        case autoRenewing = "auto_renewing"
    }
}

struct PorizoGoogleReceiptResponse: Codable, Sendable {
    let success: Bool
    let subscription: PorizoGoogleSubscriptionSummary?
    let entitlements: PorizoBillingEntitlements?
}

struct PorizoPlansResponse: Codable, Sendable {
    let plans: [PorizoSubscriptionPlan]
}

struct PorizoPlanProductIds: Codable, Sendable {
    let monthly: String?
    let annual: String?
}

struct PorizoSubscriptionPlan: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let tier: String
    let songsPerMonth: Int
    let poemsPerMonth: Int
    let priceMonthly: Int?
    let priceAnnual: Int?
    let description: String?
    let features: [String]
    let isActive: Bool
    let sortOrder: Int
    let googleProductIds: PorizoPlanProductIds?

    enum CodingKeys: String, CodingKey {
        case id, name, tier, description, features
        case songsPerMonth = "songs_per_month"
        case poemsPerMonth = "poems_per_month"
        case priceMonthly = "price_monthly_cents"
        case priceAnnual = "price_annual_cents"
        case isActive = "is_active"
        case sortOrder = "sort_order"
        case googleProductIds = "google_product_ids"
    }

    var googleSubscriptionProductIds: [String] {
        [googleProductIds?.monthly, googleProductIds?.annual].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }
    }
}

struct PorizoSubscriptionStatusResponse: Codable, Sendable {
    let hasActiveSubscription: Bool?
    let hasSubscription: Bool?
    let subscription: PorizoSubscriptionStatusSummary?
    let entitlements: PorizoBillingEntitlements?

    enum CodingKeys: String, CodingKey {
        case hasActiveSubscription
        case hasSubscription = "has_subscription"
        case subscription
        case entitlements
    }
}

struct PorizoSubscriptionStatusSummary: Codable, Sendable {
    let id: String?
    let tier: String?
    let status: String?
    let productId: String?
    let platform: String?
    let expiresAt: String?
    let autoRenewEnabled: Bool?
    let isInGracePeriod: Bool?

    enum CodingKeys: String, CodingKey {
        case id, tier, status, platform
        case productId = "product_id"
        case expiresAt = "expires_at"
        case autoRenewEnabled = "auto_renew_enabled"
        case isInGracePeriod = "is_in_grace_period"
    }
}

struct PorizoEnrollmentSession: Codable, Sendable {
    let sessionId: String
    let sessionExpiresAt: String
    let prompts: [PorizoEnrollmentPrompt]?
    let promptSetId: String?
    let uploadUrls: [PorizoUploadURL]?
    let recordingSettings: PorizoRecordingSettings?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case sessionExpiresAt = "session_expires_at"
        case prompts
        case promptSetId = "prompt_set_id"
        case uploadUrls = "upload_urls"
        case recordingSettings = "recording_settings"
    }
}

struct PorizoEnrollmentPrompt: Codable, Sendable, Identifiable {
    let id: String
    let text: String
    let type: String
    let durationHintSec: Int?
    let pitchHint: String?

    enum CodingKeys: String, CodingKey {
        case id, text, type
        case durationHintSec = "duration_hint_sec"
        case pitchHint = "pitch_hint"
    }
}

struct PorizoUploadURL: Codable, Sendable {
    let chunkId: String
    let url: String
    let method: String?
    let headers: [String: String]?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case chunkId = "chunk_id"
        case url, method, headers
        case expiresAt = "expires_at"
    }
}

struct PorizoRecordingSettings: Codable, Sendable {
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

struct PorizoChunkUploadResponse: Codable, Sendable {
    let status: String
    let qcJobId: String?
    let nextUploadUrl: PorizoUploadURL?
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

struct PorizoVoiceProfile: Codable, Sendable {
    let voiceProfileId: String
    let qualityScore: Double?
    let status: String
    let jobId: String?
    let estimatedCompletionSec: Int?
    let outcome: String?
    let quality: PorizoEnrollmentQuality?

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

struct PorizoEnrollmentQuality: Codable, Sendable {
    let tier: String?
    let score: Double?
    let label: String?
    let disclosure: String?
    let canImprove: Bool?
    let improvementTips: [String]?

    enum CodingKeys: String, CodingKey {
        case tier, score, label, disclosure
        case canImprove = "can_improve"
        case improvementTips = "improvement_tips"
    }
}

struct PorizoVoiceProfileStatus: Codable, Sendable {
    let profileId: String?
    let status: String?
    let qualityScore: Double?
    let qualityTier: String?
    let createdAt: String?
    let myVoiceReady: Bool?

    enum CodingKeys: String, CodingKey {
        case profileId = "profile_id"
        case status
        case qualityScore = "quality_score"
        case qualityTier = "quality_tier"
        case createdAt = "created_at"
        case myVoiceReady = "my_voice_ready"
    }
}
