//
//  BillingModels.swift
//  PorizoApp
//
//  Billing and subscription API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation

private extension KeyedDecodingContainer {
    func decodeFlexibleInt(forKey key: Key, default defaultValue: Int = 0) -> Int {
        if let intValue = try? decode(Int.self, forKey: key) {
            return intValue
        }
        if let doubleValue = try? decode(Double.self, forKey: key) {
            return Int(doubleValue)
        }
        if let stringValue = try? decode(String.self, forKey: key),
           let intValue = Int(stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) {
            return intValue
        }
        return defaultValue
    }

    func decodeFlexibleIntIfPresent(forKey key: Key) -> Int? {
        if (try? decodeNil(forKey: key)) == true {
            return nil
        }
        if let intValue = try? decode(Int.self, forKey: key) {
            return intValue
        }
        if let doubleValue = try? decode(Double.self, forKey: key) {
            return Int(doubleValue)
        }
        if let stringValue = try? decode(String.self, forKey: key),
           let intValue = Int(stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) {
            return intValue
        }
        return nil
    }

    func decodeFlexibleBool(forKey key: Key, default defaultValue: Bool = false) -> Bool {
        if let boolValue = try? decode(Bool.self, forKey: key) {
            return boolValue
        }
        if let intValue = try? decode(Int.self, forKey: key) {
            return intValue != 0
        }
        if let stringValue = try? decode(String.self, forKey: key) {
            switch stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1", "yes":
                return true
            case "false", "0", "no":
                return false
            default:
                return defaultValue
            }
        }
        return defaultValue
    }

    func decodeFlexibleBoolIfPresent(forKey key: Key) -> Bool? {
        if (try? decodeNil(forKey: key)) == true {
            return nil
        }
        if let boolValue = try? decode(Bool.self, forKey: key) {
            return boolValue
        }
        if let intValue = try? decode(Int.self, forKey: key) {
            return intValue != 0
        }
        if let stringValue = try? decode(String.self, forKey: key) {
            switch stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1", "yes":
                return true
            case "false", "0", "no":
                return false
            default:
                return nil
            }
        }
        return nil
    }
}

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
    let baseSongsRemaining: Int
    let songsRemaining: Int
    let songsAllowance: Int
    let songsUsedTotal: Int
    let poemsRemaining: Int
    let poemsAllowance: Int
    let poemsUsedTotal: Int
    let trialSongsRemaining: Int
    let trialExpiresAt: String?
    let planId: String?
    let billingPeriod: String?
    let subscriptionStartsAt: String?
    let subscriptionRenewsAt: String?
    let autoRenewEnabled: Bool?
    let isInGracePeriod: Bool?

    enum CodingKeys: String, CodingKey {
        case tier
        case baseSongsRemaining = "base_songs_remaining"
        case songsRemaining = "songs_remaining"
        case songsAllowance = "songs_allowance"
        case songsUsedTotal = "songs_used_total"
        case poemsRemaining = "poems_remaining"
        case poemsAllowance = "poems_allowance"
        case poemsUsedTotal = "poems_used_total"
        case trialSongsRemaining = "trial_songs_remaining"
        case trialExpiresAt = "trial_expires_at"
        case planId = "plan_id"
        case billingPeriod = "billing_period"
        case subscriptionStartsAt = "subscription_starts_at"
        case subscriptionRenewsAt = "subscription_renews_at"
        case autoRenewEnabled = "auto_renew_enabled"
        case isInGracePeriod = "is_in_grace_period"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tier = (try? container.decode(String.self, forKey: .tier)) ?? "free"
        baseSongsRemaining = container.decodeFlexibleIntIfPresent(forKey: .baseSongsRemaining) ?? 0
        songsRemaining = container.decodeFlexibleInt(forKey: .songsRemaining)
        songsAllowance = container.decodeFlexibleInt(forKey: .songsAllowance)
        songsUsedTotal = container.decodeFlexibleInt(forKey: .songsUsedTotal)
        poemsRemaining = container.decodeFlexibleInt(forKey: .poemsRemaining)
        poemsAllowance = container.decodeFlexibleInt(forKey: .poemsAllowance)
        poemsUsedTotal = container.decodeFlexibleInt(forKey: .poemsUsedTotal)
        trialSongsRemaining = container.decodeFlexibleInt(forKey: .trialSongsRemaining)
        trialExpiresAt = try? container.decodeIfPresent(String.self, forKey: .trialExpiresAt)
        planId = try? container.decodeIfPresent(String.self, forKey: .planId)
        billingPeriod = try? container.decodeIfPresent(String.self, forKey: .billingPeriod)
        subscriptionStartsAt = try? container.decodeIfPresent(String.self, forKey: .subscriptionStartsAt)
        subscriptionRenewsAt = try? container.decodeIfPresent(String.self, forKey: .subscriptionRenewsAt)
        autoRenewEnabled = container.decodeFlexibleBoolIfPresent(forKey: .autoRenewEnabled)
        isInGracePeriod = container.decodeFlexibleBoolIfPresent(forKey: .isInGracePeriod)
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

/// Response from GET /billing/subscription-status
struct SubscriptionResponse: Decodable, Sendable {
    let hasActiveSubscription: Bool
    let subscription: SubscriptionDetails?
    let entitlements: SubscriptionEntitlements?

    enum CodingKeys: String, CodingKey {
        case hasActiveSubscription
        case hasSubscription = "has_subscription"
        case subscription
        case entitlements
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        hasActiveSubscription =
            (try? container.decode(Bool.self, forKey: .hasActiveSubscription)) ??
            (try? container.decode(Bool.self, forKey: .hasSubscription)) ??
            false
        subscription = try container.decodeIfPresent(SubscriptionDetails.self, forKey: .subscription)
        entitlements = try container.decodeIfPresent(SubscriptionEntitlements.self, forKey: .entitlements)
    }

    struct SubscriptionDetails: Decodable, Sendable {
        let id: String
        let tier: String
        let status: String
        let productId: String?
        let platform: String?
        let expiresAt: String?
        let autoRenewEnabled: Bool
        let isInGracePeriod: Bool
        let gracePeriodExpiresAt: String?
        let createdAt: String?

        enum CodingKeys: String, CodingKey {
            case id, tier, status, platform
            case productIdCamel = "productId"
            case productId = "product_id"
            case expiresAtCamel = "expiresAt"
            case expiresAt = "expires_at"
            case autoRenewEnabledCamel = "autoRenewEnabled"
            case autoRenewEnabled = "auto_renew_enabled"
            case isInGracePeriodCamel = "isInGracePeriod"
            case isInGracePeriod = "is_in_grace_period"
            case gracePeriodExpiresAtCamel = "gracePeriodExpiresAt"
            case gracePeriodExpiresAt = "grace_period_expires_at"
            case createdAtCamel = "createdAt"
            case createdAt = "created_at"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            tier = try container.decode(String.self, forKey: .tier)
            status = try container.decode(String.self, forKey: .status)
            platform = try container.decodeIfPresent(String.self, forKey: .platform)
            productId =
                (try? container.decode(String.self, forKey: .productIdCamel)) ??
                (try? container.decode(String.self, forKey: .productId))
            expiresAt =
                (try? container.decode(String.self, forKey: .expiresAtCamel)) ??
                (try? container.decode(String.self, forKey: .expiresAt))
            autoRenewEnabled =
                (try? container.decode(Bool.self, forKey: .autoRenewEnabledCamel)) ??
                (try? container.decode(Bool.self, forKey: .autoRenewEnabled)) ??
                false
            isInGracePeriod =
                (try? container.decode(Bool.self, forKey: .isInGracePeriodCamel)) ??
                (try? container.decode(Bool.self, forKey: .isInGracePeriod)) ??
                false
            gracePeriodExpiresAt =
                (try? container.decode(String.self, forKey: .gracePeriodExpiresAtCamel)) ??
                (try? container.decode(String.self, forKey: .gracePeriodExpiresAt))
            createdAt =
                (try? container.decode(String.self, forKey: .createdAtCamel)) ??
                (try? container.decode(String.self, forKey: .createdAt))
        }
    }

    struct SubscriptionEntitlements: Decodable, Sendable {
        let tier: String
        let baseSongsRemaining: Int?
        let songsRemaining: Int
        let songsAllowance: Int?
        let trialSongsRemaining: Int?

        enum CodingKeys: String, CodingKey {
            case tier
            case baseSongsRemaining = "baseSongsRemaining"
            case baseSongsRemainingLegacy = "base_songs_remaining"
            case songsRemaining = "songsRemaining"
            case songsRemainingLegacy = "songs_remaining"
            case songsAllowance = "songsAllowance"
            case songsAllowanceLegacy = "songs_allowance"
            case trialSongsRemaining = "trialSongsRemaining"
            case trialSongsRemainingLegacy = "trial_songs_remaining"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            tier = try container.decode(String.self, forKey: .tier)
            baseSongsRemaining =
                (try? container.decode(Int.self, forKey: .baseSongsRemaining)) ??
                (try? container.decode(Int.self, forKey: .baseSongsRemainingLegacy))
            songsRemaining =
                (try? container.decode(Int.self, forKey: .songsRemaining)) ??
                (try? container.decode(Int.self, forKey: .songsRemainingLegacy)) ??
                0
            songsAllowance =
                (try? container.decode(Int.self, forKey: .songsAllowance)) ??
                (try? container.decode(Int.self, forKey: .songsAllowanceLegacy))
            trialSongsRemaining =
                (try? container.decode(Int.self, forKey: .trialSongsRemaining)) ??
                (try? container.decode(Int.self, forKey: .trialSongsRemainingLegacy))
        }
    }

    var hasSubscription: Bool {
        hasActiveSubscription
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

/// Per-platform product identifiers for plan billing periods
struct PlanProductIds: Codable, Sendable {
    let monthly: String?
    let annual: String?
}

/// A subscription plan from the backend
struct SubscriptionPlan: Codable, Sendable, Identifiable {
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
    let appleProductIds: PlanProductIds?
    let googleProductIds: PlanProductIds?

    enum CodingKeys: String, CodingKey {
        case id, name, tier, description, features
        case songsPerMonth = "songs_per_month"
        case poemsPerMonth = "poems_per_month"
        case priceMonthly = "price_monthly_cents"
        case priceAnnual = "price_annual_cents"
        case isActive = "is_active"
        case sortOrder = "sort_order"
        case appleProductIds = "apple_product_ids"
        case googleProductIds = "google_product_ids"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name = (try? container.decode(String.self, forKey: .name)) ?? "Plan"
        tier = (try? container.decode(String.self, forKey: .tier)) ?? "free"
        songsPerMonth = container.decodeFlexibleInt(forKey: .songsPerMonth)
        poemsPerMonth = container.decodeFlexibleIntIfPresent(forKey: .poemsPerMonth) ?? 0
        priceMonthly = container.decodeFlexibleIntIfPresent(forKey: .priceMonthly)
        priceAnnual = container.decodeFlexibleIntIfPresent(forKey: .priceAnnual)
        description = try? container.decodeIfPresent(String.self, forKey: .description)
        features = (try? container.decode([String].self, forKey: .features)) ?? []
        isActive = container.decodeFlexibleBool(forKey: .isActive, default: true)
        sortOrder = container.decodeFlexibleInt(forKey: .sortOrder)
        appleProductIds = try? container.decodeIfPresent(PlanProductIds.self, forKey: .appleProductIds)
        googleProductIds = try? container.decodeIfPresent(PlanProductIds.self, forKey: .googleProductIds)
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
