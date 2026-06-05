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
    let giftWalletBalance: Int
    /// Server-computed: songs the user can make right now = ongoing credits
    /// (subscription + trial) plus gift-wallet credit when the pay-per-song
    /// flag is on. Gate song creation on this, not songsRemaining alone.
    let availableSongCredits: Int
    /// Whether gift-wallet credit can fund the user's own song (server flag).
    /// Drives whether the "pay for one song" option is offered.
    let payPerSongEnabled: Bool
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
        case giftWalletBalance = "gift_wallet_balance"
        case availableSongCredits = "available_song_credits"
        case payPerSongEnabled = "pay_per_song_enabled"
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
        giftWalletBalance = container.decodeFlexibleInt(forKey: .giftWalletBalance)
        // Fall back to songsRemaining when the server predates this field, so
        // older builds gate exactly as before (ongoing credits only).
        availableSongCredits =
            container.decodeFlexibleIntIfPresent(forKey: .availableSongCredits)
            ?? container.decodeFlexibleInt(forKey: .songsRemaining)
        payPerSongEnabled =
            container.decodeFlexibleBoolIfPresent(forKey: .payPerSongEnabled) ?? false
        trialExpiresAt = try? container.decodeIfPresent(String.self, forKey: .trialExpiresAt)
        planId = try? container.decodeIfPresent(String.self, forKey: .planId)
        billingPeriod = try? container.decodeIfPresent(String.self, forKey: .billingPeriod)
        subscriptionStartsAt = try? container.decodeIfPresent(String.self, forKey: .subscriptionStartsAt)
        subscriptionRenewsAt = try? container.decodeIfPresent(String.self, forKey: .subscriptionRenewsAt)
        autoRenewEnabled = container.decodeFlexibleBoolIfPresent(forKey: .autoRenewEnabled)
        isInGracePeriod = container.decodeFlexibleBoolIfPresent(forKey: .isInGracePeriod)
    }

    /// Whether the user can start a song right now. Prefers the server's
    /// available_song_credits, but never blocks a user who provably has
    /// ongoing credits — defends against a backend that wrongly reports 0.
    /// (Over-grant is impossible: the spend endpoint re-validates balance.)
    var canMakeSong: Bool {
        Swift.max(availableSongCredits, songsRemaining) > 0
    }

    /// Check if trial is active
    var isTrialActive: Bool {
        trialSongsRemaining > 0 && trialExpiresAt != nil
    }

    /// Parse trial expiration date
    var trialExpiresAtDate: Date? {
        guard let str = trialExpiresAt else { return nil }
        return try? Date(str, strategy: .iso8601)
    }

    /// Parse subscription expiration date
    var subscriptionExpiresAtDate: Date? {
        guard let str = subscriptionRenewsAt else { return nil }
        return try? Date(str, strategy: .iso8601)
    }
}

#if DEBUG
extension BillingEntitlements {
    /// Build a mock for simulator fixtures (the struct is decoder-only, so we
    /// round-trip a dict through the real decoder to stay faithful to it).
    static func mock(
        tier: String = "free",
        songsRemaining: Int = 0,
        songsAllowance: Int = 0,
        trialSongsRemaining: Int = 0,
        giftWalletBalance: Int = 0,
        availableSongCredits: Int = 0,
        payPerSongEnabled: Bool = false
    ) -> BillingEntitlements {
        let dict: [String: Any] = [
            "tier": tier,
            "songs_remaining": songsRemaining,
            "songs_allowance": songsAllowance,
            "trial_songs_remaining": trialSongsRemaining,
            "gift_wallet_balance": giftWalletBalance,
            "available_song_credits": availableSongCredits,
            "pay_per_song_enabled": payPerSongEnabled,
        ]
        // Safe: the dict is JSON-valid and matches the decoder's contract.
        let data = try! JSONSerialization.data(withJSONObject: dict)
        return try! JSONDecoder().decode(BillingEntitlements.self, from: data)
    }
}
#endif

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
        try? Date(trialExpiresAt, strategy: .iso8601)
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
