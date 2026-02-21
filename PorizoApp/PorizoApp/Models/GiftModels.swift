//
//  GiftModels.swift
//  PorizoApp
//
//  Gift scheduling + wallet API models.
//

import Foundation

enum GiftContentType: String, CaseIterable, Sendable {
    case song
    case poem

    var displayName: String {
        switch self {
        case .song: return "Song"
        case .poem: return "Poem"
        }
    }
}

enum GiftDeliveryMode: String, CaseIterable, Sendable {
    case immediate
    case scheduled
}

enum GiftDeliveryChannel: String, CaseIterable, Sendable {
    case sms
    case email
}

struct GiftOrder: Codable, Sendable, Identifiable {
    let id: String
    let senderUserId: String
    let contentType: String
    let contentId: String
    let status: String
    let dispatchStatus: String
    let deliveryMode: String
    let sendAt: String
    let senderTimezone: String?
    let channels: [String]
    let recipientPhone: String?
    let recipientEmail: String?
    let message: String?
    let shareTokenId: String?
    let shareUrl: String?
    let claimPin: String?
    let claimPolicy: String?
    let walletBalance: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case senderUserId = "sender_user_id"
        case contentType = "content_type"
        case contentId = "content_id"
        case status
        case dispatchStatus = "dispatch_status"
        case deliveryMode = "delivery_mode"
        case sendAt = "send_at"
        case senderTimezone = "sender_timezone"
        case channels
        case recipientPhone = "recipient_phone"
        case recipientEmail = "recipient_email"
        case message
        case shareTokenId = "share_token_id"
        case shareUrl = "share_url"
        case claimPin = "claim_pin"
        case claimPolicy = "claim_policy"
        case walletBalance = "wallet_balance"
    }
}

struct GiftWalletTransaction: Codable, Sendable, Identifiable {
    let id: String
    let type: String
    let amount: Int
    let balanceAfter: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case amount
        case balanceAfter = "balance_after"
        case createdAt = "created_at"
    }
}

struct GiftWalletResponse: Codable, Sendable {
    let balance: Int
    let updatedAt: String?
    let transactions: [GiftWalletTransaction]

    enum CodingKeys: String, CodingKey {
        case balance
        case updatedAt = "updated_at"
        case transactions
    }
}

struct GiftConsumableSyncResponse: Codable, Sendable {
    let success: Bool
    let alreadyProcessed: Bool
    let balance: Int
    let transactions: [GiftWalletTransaction]

    enum CodingKeys: String, CodingKey {
        case success
        case alreadyProcessed = "already_processed"
        case balance
        case transactions
    }
}

struct CreateGiftRequest: Encodable, Sendable {
    let contentType: String
    let contentId: String
    let deliveryMode: String
    let senderTimezone: String
    let channels: [String]
    let recipientPhone: String?
    let recipientEmail: String?
    let message: String?
    let sendAt: String?
    let expiresInDays: Int
    let versionNum: Int?

    enum CodingKeys: String, CodingKey {
        case contentType = "content_type"
        case contentId = "content_id"
        case deliveryMode = "delivery_mode"
        case senderTimezone = "sender_timezone"
        case channels
        case recipientPhone = "recipient_phone"
        case recipientEmail = "recipient_email"
        case message
        case sendAt = "send_at"
        case expiresInDays = "expires_in_days"
        case versionNum = "version_num"
    }
}

struct UpdateGiftRequest: Encodable, Sendable {
    let sendAt: String?
    let senderTimezone: String?
    let channels: [String]?
    let recipientPhone: String?
    let recipientEmail: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case sendAt = "send_at"
        case senderTimezone = "sender_timezone"
        case channels
        case recipientPhone = "recipient_phone"
        case recipientEmail = "recipient_email"
        case message
    }
}

struct CreateGiftResponse: Codable, Sendable {
    let gift: GiftOrder
    let walletBalance: Int

    enum CodingKeys: String, CodingKey {
        case gift
        case walletBalance = "wallet_balance"
    }
}

struct GetGiftsResponse: Codable, Sendable {
    let gifts: [GiftOrder]
    let walletBalance: Int

    enum CodingKeys: String, CodingKey {
        case gifts
        case walletBalance = "wallet_balance"
    }
}

struct UpdateGiftResponse: Codable, Sendable {
    let gift: GiftOrder
}

struct CancelGiftResponse: Codable, Sendable {
    let cancelled: Bool
    let gift: GiftOrder
    let walletBalance: Int

    enum CodingKeys: String, CodingKey {
        case cancelled
        case gift
        case walletBalance = "wallet_balance"
    }
}
