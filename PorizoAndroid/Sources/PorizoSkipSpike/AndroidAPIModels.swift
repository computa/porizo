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
    let canAccess: Bool?
    let track: PorizoShareTrackInfo?
    let trackPreview: PorizoShareTrackInfo?
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

struct PorizoBillingEntitlements: Codable, Sendable {
    let tier: String?
    let songsRemaining: Int?
    let giftTokensRemaining: Int?
    let autoRenewEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case tier
        case songsRemaining = "songs_remaining"
        case giftTokensRemaining = "gift_tokens_remaining"
        case autoRenewEnabled = "auto_renew_enabled"
    }
}
