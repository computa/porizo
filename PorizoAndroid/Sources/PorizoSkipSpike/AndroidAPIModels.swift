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

    enum CodingKeys: String, CodingKey {
        case id, title, occasion, status
        case recipientName = "recipient_name"
        case latestVersion = "latest_version"
        case shareTokenId = "share_token_id"
        case artworkUrl = "artwork_url"
    }
}

struct PorizoGetTracksResponse: Codable, Sendable {
    let tracks: [PorizoTrackSummary]
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
