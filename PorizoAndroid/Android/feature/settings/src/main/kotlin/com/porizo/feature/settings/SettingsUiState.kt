package com.porizo.feature.settings

import com.porizo.core.domain.platform.PlayProductSummary
import com.porizo.core.model.BillingEntitlements
import com.porizo.core.model.SubscriptionPlan
import com.porizo.core.model.SubscriptionStatus
import com.porizo.core.model.VoiceProfileStatus

data class SettingsUiState(
    val isBillingWorking: Boolean = false,
    val isPushWorking: Boolean = false,
    val isVoiceWorking: Boolean = false,
    val billingStatus: String = "Billing not loaded.",
    val pushStatus: String = "Push not enabled.",
    val voiceStatus: String = "Voice profile not loaded.",
    val deviceTrustStatus: String = "Device trust not checked.",
    val voiceEnrollmentEnabled: Boolean = false,
    val entitlements: BillingEntitlements? = null,
    val subscriptionStatus: SubscriptionStatus? = null,
    val plans: List<SubscriptionPlan> = emptyList(),
    val loadedProducts: List<PlayProductSummary> = emptyList(),
    val selectedProductId: String = "",
    val purchaseToken: String = "",
    val pushToken: String = "",
    val pushSubscriptionId: String = "",
    val appSetId: String? = null,
    val voiceProfileStatus: VoiceProfileStatus? = null,
    val enrollmentPrompt: String? = null,
    val activeEnrollmentId: String? = null,
    val recordingPath: String? = null,
)
