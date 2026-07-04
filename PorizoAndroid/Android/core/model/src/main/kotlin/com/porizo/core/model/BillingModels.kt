package com.porizo.core.model

data class BillingEntitlements(
    val tier: String?,
    val baseSongsRemaining: Int?,
    val songsRemaining: Int?,
    val songsAllowance: Int?,
    val poemsRemaining: Int?,
    val poemsAllowance: Int?,
    val trialSongsRemaining: Int?,
    val giftWalletBalance: Int?,
    val availableSongCredits: Int?,
    val payPerSongEnabled: Boolean?,
    val giftTokensRemaining: Int?,
    val autoRenewEnabled: Boolean?,
)

data class GoogleSubscriptionSummary(
    val id: String,
    val tier: String?,
    val status: String?,
    val expiresAt: String?,
    val autoRenewing: Boolean?,
)

data class GoogleReceiptResult(
    val success: Boolean,
    val subscription: GoogleSubscriptionSummary?,
    val entitlements: BillingEntitlements?,
)

data class SubscriptionPlanProductIds(
    val monthly: String?,
    val annual: String?,
) {
    val googleSubscriptionProductIds: List<String>
        get() = listOfNotNull(monthly, annual).filter { it.isNotBlank() }
}

data class SubscriptionPlan(
    val id: String,
    val name: String,
    val tier: String,
    val songsPerMonth: Int,
    val poemsPerMonth: Int,
    val priceMonthlyCents: Int?,
    val priceAnnualCents: Int?,
    val description: String?,
    val features: List<String>,
    val isActive: Boolean,
    val sortOrder: Int,
    val googleProductIds: SubscriptionPlanProductIds?,
) {
    val googleSubscriptionProductIds: List<String>
        get() = googleProductIds?.googleSubscriptionProductIds.orEmpty()
}

data class SubscriptionStatus(
    val hasActiveSubscription: Boolean?,
    val hasSubscription: Boolean?,
    val subscription: SubscriptionStatusSummary?,
    val entitlements: BillingEntitlements?,
)

data class SubscriptionStatusSummary(
    val id: String?,
    val tier: String?,
    val status: String?,
    val productId: String?,
    val platform: String?,
    val expiresAt: String?,
    val autoRenewEnabled: Boolean?,
    val isInGracePeriod: Boolean?,
)
