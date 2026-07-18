//
//  GiftModels.swift
//  PorizoApp
//
//  Gift scheduling + wallet API models.
//

import Foundation
import SwiftUI

struct GiftBundleConfig: Codable, Identifiable, Sendable {
    let productId: String
    let tokenCount: Int
    let displayName: String
    let sortOrder: Int

    var id: String { productId }

    enum CodingKeys: String, CodingKey {
        case productId = "product_id"
        case tokenCount = "token_count"
        case displayName = "display_name"
        case sortOrder = "sort_order"
    }
}

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
    case manual
    case immediate
    case scheduled
}

enum GiftDeliveryChannel: String, CaseIterable, Sendable, Identifiable {
    case sms
    case email

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .sms: return "SMS"
        case .email: return "email"
        }
    }
}

struct GiftDeliveryChannelState: Codable, Sendable, Identifiable {
    let channel: String
    let status: String
    let canStop: Bool

    var id: String { channel }

    enum CodingKeys: String, CodingKey {
        case channel
        case status
        case canStop = "can_stop"
    }
}

struct GiftOrder: Codable, Sendable, Identifiable {
    let id: String
    let senderUserId: String
    let contentType: String
    let contentId: String
    let contentTitle: String?
    let recipientName: String?
    let senderDisplayName: String?
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
    let canEdit: Bool?
    let canCancel: Bool?
    let canStopAny: Bool?
    let deliveryChannels: [GiftDeliveryChannelState]?

    enum CodingKeys: String, CodingKey {
        case id
        case senderUserId = "sender_user_id"
        case contentType = "content_type"
        case contentId = "content_id"
        case contentTitle = "content_title"
        case recipientName = "recipient_name"
        case senderDisplayName = "sender_display_name"
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
        case canEdit = "can_edit"
        case canCancel = "can_cancel"
        case canStopAny = "can_stop_any"
        case deliveryChannels = "delivery_channels"
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

struct GiftReservation: Codable, Sendable, Identifiable {
    let id: String
    let userId: String
    let status: String
    let contentType: String?
    let contentId: String?
    let versionNum: Int?
    let tokenTransactionId: String
    let refundTransactionId: String?
    let giftOrderId: String?
    let expiresAt: String
    let cancelReason: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case status
        case contentType = "content_type"
        case contentId = "content_id"
        case versionNum = "version_num"
        case tokenTransactionId = "token_transaction_id"
        case refundTransactionId = "refund_transaction_id"
        case giftOrderId = "gift_order_id"
        case expiresAt = "expires_at"
        case cancelReason = "cancel_reason"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
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

struct CreateGiftReservationRequest: Encodable, Sendable {
    let flowType: String

    enum CodingKeys: String, CodingKey {
        case flowType = "flow_type"
    }
}

struct AttachGiftReservationContentRequest: Encodable, Sendable {
    let contentType: String
    let contentId: String
    let versionNum: Int?

    enum CodingKeys: String, CodingKey {
        case contentType = "content_type"
        case contentId = "content_id"
        case versionNum = "version_num"
    }
}

struct FinalizeGiftReservationRequest: Encodable, Sendable {
    let recipientName: String?
    let senderDisplayName: String?
    let deliveryMode: String
    let senderTimezone: String
    let channels: [String]
    let recipientPhone: String?
    let recipientEmail: String?
    let message: String?
    let sendAt: String?
    let expiresInDays: Int

    enum CodingKeys: String, CodingKey {
        case recipientName = "recipient_name"
        case senderDisplayName = "sender_display_name"
        case deliveryMode = "delivery_mode"
        case senderTimezone = "sender_timezone"
        case channels
        case recipientPhone = "recipient_phone"
        case recipientEmail = "recipient_email"
        case message
        case sendAt = "send_at"
        case expiresInDays = "expires_in_days"
    }
}

struct CreateGiftRequest: Encodable, Sendable {
    let contentType: String
    let contentId: String
    let recipientName: String?
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
        case recipientName = "recipient_name"
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

extension GiftOrder {
    var displayTitle: String {
        if let contentTitle, !contentTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return contentTitle
        }
        switch contentType.lowercased() {
        case GiftContentType.song.rawValue:
            return "Song gift"
        case GiftContentType.poem.rawValue:
            return "Poem gift"
        default:
            return "Gift"
        }
    }

    var recipientSummary: String {
        let trimmedName = recipientName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let trimmedPhone = recipientPhone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let trimmedEmail = recipientEmail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        if !trimmedName.isEmpty {
            if !trimmedPhone.isEmpty && !trimmedEmail.isEmpty {
                return "\(trimmedName) • \(trimmedPhone) • \(trimmedEmail)"
            }
            if !trimmedPhone.isEmpty {
                return "\(trimmedName) • \(trimmedPhone)"
            }
            if !trimmedEmail.isEmpty {
                return "\(trimmedName) • \(trimmedEmail)"
            }
            return trimmedName
        }

        if !trimmedPhone.isEmpty && !trimmedEmail.isEmpty {
            return "\(trimmedPhone) • \(trimmedEmail)"
        }
        if !trimmedEmail.isEmpty {
            return trimmedEmail
        }
        if !trimmedPhone.isEmpty {
            return trimmedPhone
        }
        return "Recipient not set"
    }

    var managementStatusLabel: String {
        if isManualReadyToShare {
            return String(localized: "Ready to share")
        }

        switch status.lowercased() {
        case "ready_to_share":
            return String(localized: "Ready to share")
        case "delivered":
            return String(localized: "Delivered")
        case "delivery_failed":
            return String(localized: "Delivery failed")
        case "partial_delivery":
            return String(localized: "Partly delivered")
        case "cancelled":
            return String(localized: "Cancelled")
        case "dispatch_retry":
            return String(localized: "Retrying")
        case "dispatching":
            return String(localized: "Sending")
        default:
            return String(localized: "Scheduled")
        }
    }

    var managementStatusColor: Color {
        if isManualReadyToShare {
            return DesignTokens.gold
        }

        switch status.lowercased() {
        case "dispatch_retry", "delivery_failed", "partial_delivery":
            return DesignTokens.warning
        case "dispatching", "delivered":
            return DesignTokens.statusSuccess
        case "cancelled":
            return DesignTokens.textTertiary
        default:
            return DesignTokens.gold
        }
    }

    var isManualReadyToShare: Bool {
        deliveryMode.lowercased() == GiftDeliveryMode.manual.rawValue
            && (status.lowercased() == "ready_to_share"
                || dispatchStatus.lowercased() == "not_requested")
    }

    var shouldAppearInGiftManagement: Bool {
        if isManualReadyToShare {
            return true
        }

        return deliveryMode.lowercased() == GiftDeliveryMode.scheduled.rawValue
            && ["scheduled", "dispatch_retry", "dispatching"].contains(status.lowercased())
    }

    var stoppableDeliveryChannels: [GiftDeliveryChannel] {
        deliveryChannels?
            .filter(\.canStop)
            .compactMap { GiftDeliveryChannel(rawValue: $0.channel.lowercased()) }
            ?? []
    }

    var sendAtDate: Date {
        GiftDateParsing.parse(sendAt)
    }

    var sendAtLabel: String {
        DateFormatter.localizedString(from: sendAtDate, dateStyle: .medium, timeStyle: .short)
    }
}

struct GiftReservationResponse: Codable, Sendable {
    let reservation: GiftReservation?
    let walletBalance: Int
    let idempotent: Bool?

    enum CodingKeys: String, CodingKey {
        case reservation
        case walletBalance = "wallet_balance"
        case idempotent
    }
}

struct UpdateGiftRequest: Encodable, Sendable {
    let recipientName: String?
    let sendAt: String?
    let senderTimezone: String?
    let channels: [String]?
    let recipientPhone: String?
    let recipientEmail: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case recipientName = "recipient_name"
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

struct StopGiftDeliveryRequest: Encodable, Sendable {
    let channels: [String]
}

struct StopGiftDeliveryResponse: Codable, Sendable {
    let gift: GiftOrder
    let stoppedChannels: [String]

    enum CodingKeys: String, CodingKey {
        case gift
        case stoppedChannels = "stopped_channels"
    }
}

struct CancelGiftReservationResponse: Codable, Sendable {
    let cancelled: Bool
    let reservation: GiftReservation
    let walletBalance: Int

    enum CodingKeys: String, CodingKey {
        case cancelled
        case reservation
        case walletBalance = "wallet_balance"
    }
}
