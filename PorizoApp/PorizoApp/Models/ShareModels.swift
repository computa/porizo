//
//  ShareModels.swift
//  PorizoApp
//
//  Track sharing API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation

// MARK: - Share Creation

/// Response from POST /tracks/:id/share
struct CreateShareResponse: Codable, Sendable {
    let shareId: String
    let shareUrl: String
    let qrCodeUrl: String
    let expiresAt: String
    let claimPin: String  // 6-digit PIN to share with recipient

    enum CodingKeys: String, CodingKey {
        case shareId = "share_id"
        case shareUrl = "share_url"
        case qrCodeUrl = "qr_code_url"
        case expiresAt = "expires_at"
        case claimPin = "claim_pin"
    }

    /// Memberwise initializer for programmatic creation
    init(shareId: String, shareUrl: String, qrCodeUrl: String, expiresAt: String, claimPin: String) {
        self.shareId = shareId
        self.shareUrl = shareUrl
        self.qrCodeUrl = qrCodeUrl
        self.expiresAt = expiresAt
        self.claimPin = claimPin
    }
}

// MARK: - Share Statistics

/// Share statistics from GET /tracks/:id/share/stats
struct ShareStats: Codable, Sendable {
    let shareId: String
    let shareUrl: String?
    let claimPin: String?
    let status: String
    let expiresAt: String
    let createdAt: String
    let isExpired: Bool
    let totalEvents: Int
    let eventCounts: [String: EventCount]?
    let isClaimed: Bool
    let boundDevice: BoundDeviceInfo?
    let recentActivity: [ActivityEntry]?

    enum CodingKeys: String, CodingKey {
        case shareId = "share_id"
        case shareUrl = "share_url"
        case claimPin = "claim_pin"
        case status
        case expiresAt = "expires_at"
        case createdAt = "created_at"
        case isExpired = "is_expired"
        case totalEvents = "total_events"
        case eventCounts = "event_counts"
        case isClaimed = "is_claimed"
        case boundDevice = "bound_device"
        case recentActivity = "recent_activity"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        shareId = try container.decode(String.self, forKey: .shareId)
        shareUrl = try container.decodeIfPresent(String.self, forKey: .shareUrl)
        claimPin = try container.decodeIfPresent(String.self, forKey: .claimPin)
        status = try container.decode(String.self, forKey: .status)
        expiresAt = try container.decode(String.self, forKey: .expiresAt)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        isExpired = try container.decode(Bool.self, forKey: .isExpired)
        // Server may return Int or String for count fields
        if let intVal = try? container.decode(Int.self, forKey: .totalEvents) {
            totalEvents = intVal
        } else if let strVal = try? container.decode(String.self, forKey: .totalEvents) {
            totalEvents = Int(strVal) ?? 0
        } else {
            totalEvents = 0
        }
        eventCounts = try container.decodeIfPresent([String: EventCount].self, forKey: .eventCounts)
        isClaimed = try container.decode(Bool.self, forKey: .isClaimed)
        boundDevice = try container.decodeIfPresent(BoundDeviceInfo.self, forKey: .boundDevice)
        // recentActivity can fail if metadata has null values — gracefully degrade
        recentActivity = (try? container.decodeIfPresent([ActivityEntry].self, forKey: .recentActivity)) ?? nil
    }

    struct EventCount: Codable, Sendable {
        let count: Int
        let lastAt: String?

        enum CodingKeys: String, CodingKey {
            case count
            case lastAt = "last_at"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if let intVal = try? container.decode(Int.self, forKey: .count) {
                count = intVal
            } else if let strVal = try? container.decode(String.self, forKey: .count) {
                count = Int(strVal) ?? 0
            } else {
                count = 0
            }
            lastAt = try container.decodeIfPresent(String.self, forKey: .lastAt)
        }
    }

    struct ActivityEntry: Codable, Sendable {
        let eventType: String
        let metadata: [String: String?]?
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case eventType = "event_type"
            case metadata
            case createdAt = "created_at"
        }
    }

    struct BoundDeviceInfo: Codable, Sendable {
        let platform: String?
        let appVersion: String?
        let boundAt: String?

        enum CodingKeys: String, CodingKey {
            case platform
            case appVersion = "app_version"
            case boundAt = "bound_at"
        }
    }

    /// Check if share is revoked
    var isRevoked: Bool {
        status == "revoked"
    }

    /// Check if share is still valid (not expired and not revoked)
    var isValid: Bool {
        !isExpired && !isRevoked
    }
}

// MARK: - Share Management

/// Response from DELETE /tracks/:id/share
struct RevokeShareResponse: Codable, Sendable {
    let revoked: Bool
}

/// QR code data URL response from GET /tracks/:id/share/qr-data
struct QRCodeDataResponse: Codable, Sendable {
    let shareUrl: String
    let qrDataUrl: String
    let size: Int

    enum CodingKeys: String, CodingKey {
        case shareUrl = "share_url"
        case qrDataUrl = "qr_data_url"
        case size
    }
}

// MARK: - Share Access (Recipient Side)

/// Response from GET /share/:id
struct ShareInfoResponse: Codable, Sendable {
    let status: String
    let canAccess: Bool?
    let track: ShareTrackInfo?
    let trackPreview: ShareTrackInfo?
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

struct ShareTrackInfo: Codable, Sendable {
    let title: String?
    let recipientName: String?
    let senderName: String?
    let durationSec: Int?
    let coverImageUrl: String?

    enum CodingKeys: String, CodingKey {
        case title
        case recipientName = "recipient_name"
        case senderName = "sender_name"
        case durationSec = "duration_sec"
        case coverImageUrl = "cover_image_url"
    }
}

/// Response from POST /share/:id/claim
struct ShareClaimResponse: Codable, Sendable {
    let status: String
    let appSaveAllowed: Bool?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case status
        case appSaveAllowed = "app_save_allowed"
        case expiresAt = "expires_at"
    }
}

/// Response from GET /share/:id/stream
struct ShareStreamResponse: Codable, Sendable {
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
