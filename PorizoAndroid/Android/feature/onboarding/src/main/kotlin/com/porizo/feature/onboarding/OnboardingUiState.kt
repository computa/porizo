package com.porizo.feature.onboarding

import com.porizo.core.model.OnboardingNode

data class OnboardingUiState(
    val node: OnboardingNode,
    val question: String,
    val draftText: String = "",
    val recipientName: String? = null,
    val isComplete: Boolean = false,
    val canGoBack: Boolean = false,
)
