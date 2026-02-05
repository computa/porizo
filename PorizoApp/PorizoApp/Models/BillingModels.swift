//
//  BillingModels.swift
//  PorizoApp
//
//  Billing and subscription API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation

// MARK: - Entitlements

/// Response from GET /entitlements
struct EntitlementsResponse: Codable, Sendable {
    let entitlements: Entitlements?
    let riskLevel: String?

    enum CodingKeys: String, CodingKey {
        case entitlements
        case riskLevel = "risk_level"
    }
}

/// User entitlements (subscription limits)
struct Entitlements: Codable, Sendable {
    let userId: String?
    let tier: String  // "free", "basic", "pro"
    let creditsBalance: Int  // Songs remaining this period
    let creditsUsedTotal: Int  // Total songs ever created
    let previewCountToday: Int
    let previewCountResetAt: String?
    let updatedAt: String?
    // Subscription fields (optional, added for subscription model)
    let songsThisMonth: Int?
    let monthlyLimit: Int?
    let periodEndsAt: String?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case tier
        case creditsBalance = "credits_balance"
        case creditsUsedTotal = "credits_used_total"
        case previewCountToday = "preview_count_today"
        case previewCountResetAt = "preview_count_reset_at"
        case updatedAt = "updated_at"
        case songsThisMonth = "songs_this_month"
        case monthlyLimit = "monthly_limit"
        case periodEndsAt = "period_ends_at"
    }

    /// Check if user has songs remaining this month
    var hasCredits: Bool {
        creditsBalance > 0
    }

    /// Check if user can create another song this month
    var canCreateSong: Bool {
        if let limit = monthlyLimit, let used = songsThisMonth {
            return used < limit
        }
        // Fall back to credits balance
        return creditsBalance > 0
    }

    /// Display text for remaining songs
    var remainingText: String {
        if let limit = monthlyLimit, let used = songsThisMonth {
            let remaining = max(0, limit - used)
            return "\(remaining) of \(limit) songs"
        }
        return "\(creditsBalance) songs"
    }
}

// MARK: - Subscription

/// Response from POST /billing/receipt/apple
struct SyncReceiptResponse: Codable, Sendable {
    let success: Bool
    let subscription: SubscriptionInfo
    let entitlements: BillingEntitlements

    struct SubscriptionInfo: Codable, Sendable {
        let id: String
        let tier: String
        let status: String
        let songsGranted: Int
        let expiresAt: String?

        enum CodingKeys: String, CodingKey {
            case id, tier, status
            case songsGranted = "songs_granted"
            case expiresAt = "expires_at"
        }
    }
}

/// Response from GET /billing/entitlements
struct BillingEntitlements: Codable, Sendable {
    let tier: String
    let songsRemaining: Int
    let songsAllowance: Int
    let songsUsedTotal: Int
    let trialSongsRemaining: Int
    let trialExpiresAt: String?
    let previewCountToday: Int
    let planId: String?
    let billingPeriod: String?
    let subscriptionStartsAt: String?
    let subscriptionRenewsAt: String?
    let autoRenewEnabled: Bool?
    let isInGracePeriod: Bool?

    enum CodingKeys: String, CodingKey {
        case tier
        case songsRemaining = "songs_remaining"
        case songsAllowance = "songs_allowance"
        case songsUsedTotal = "songs_used_total"
        case trialSongsRemaining = "trial_songs_remaining"
        case trialExpiresAt = "trial_expires_at"
        case previewCountToday = "preview_count_today"
        case planId = "plan_id"
        case billingPeriod = "billing_period"
        case subscriptionStartsAt = "subscription_starts_at"
        case subscriptionRenewsAt = "subscription_renews_at"
        case autoRenewEnabled = "auto_renew_enabled"
        case isInGracePeriod = "is_in_grace_period"
    }

    /// Check if trial is active
    var isTrialActive: Bool {
        trialSongsRemaining > 0 && trialExpiresAt != nil
    }

    /// Parse trial expiration date
    var trialExpiresAtDate: Date? {
        guard let str = trialExpiresAt else { return nil }
        return ISO8601DateFormatter().date(from: str)
    }

    /// Parse subscription expiration date
    var subscriptionExpiresAtDate: Date? {
        guard let str = subscriptionRenewsAt else { return nil }
        return ISO8601DateFormatter().date(from: str)
    }
}

/// Response from GET /billing/subscription
struct SubscriptionResponse: Codable, Sendable {
    let hasSubscription: Bool
    let subscription: SubscriptionDetails?

    enum CodingKeys: String, CodingKey {
        case hasSubscription = "has_subscription"
        case subscription
    }

    struct SubscriptionDetails: Codable, Sendable {
        let id: String
        let tier: String
        let status: String
        let productId: String
        let expiresAt: String?
        let autoRenewEnabled: Bool
        let isInGracePeriod: Bool
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id, tier, status
            case productId = "product_id"
            case expiresAt = "expires_at"
            case autoRenewEnabled = "auto_renew_enabled"
            case isInGracePeriod = "is_in_grace_period"
            case createdAt = "created_at"
        }
    }
}

// MARK: - Trial

/// Response from POST /billing/trial/activate
struct ActivateTrialResponse: Codable, Sendable {
    let success: Bool
    let songsGranted: Int
    let songsRemaining: Int
    let trialExpiresAt: String
    let durationDays: Int

    enum CodingKeys: String, CodingKey {
        case success
        case songsGranted = "songs_granted"
        case songsRemaining = "songs_remaining"
        case trialExpiresAt = "trial_expires_at"
        case durationDays = "duration_days"
    }

    /// Parse trial expiration date
    var trialExpiresAtDate: Date? {
        ISO8601DateFormatter().date(from: trialExpiresAt)
    }
}

// MARK: - Plans

/// Response from GET /billing/plans
struct PlansResponse: Codable, Sendable {
    let plans: [SubscriptionPlan]
}

/// A subscription plan from the backend
struct SubscriptionPlan: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let tier: String
    let songsPerMonth: Int
    let previewsPerDay: Int
    let priceMonthly: Int?
    let priceAnnual: Int?
    let description: String?
    let features: [String]
    let isActive: Bool
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id, name, tier, description, features
        case songsPerMonth = "songs_per_month"
        case previewsPerDay = "previews_per_day"
        case priceMonthly = "price_monthly_cents"
        case priceAnnual = "price_annual_cents"
        case isActive = "is_active"
        case sortOrder = "sort_order"
    }

    /// Format price in dollars
    func formattedMonthlyPrice() -> String {
        guard let cents = priceMonthly else { return "Free" }
        return String(format: "$%.2f", Double(cents) / 100.0)
    }

    func formattedAnnualPrice() -> String {
        guard let cents = priceAnnual else { return "Free" }
        return String(format: "$%.2f", Double(cents) / 100.0)
    }
}
