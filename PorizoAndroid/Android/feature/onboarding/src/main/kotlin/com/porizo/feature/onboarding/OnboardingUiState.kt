package com.porizo.feature.onboarding

import com.porizo.core.model.OnboardingNode

enum class OnboardingStage {
    Splash,
    Mirror,
    Questionnaire,
    Processing,
    Payoff,
}

data class OnboardingSuggestion(
    val title: String,
    val emotionalAngle: String,
    val previewLine: String,
    val detail: String = emotionalAngle,
    val source: String = "template",
)

data class OnboardingResult(
    val recipientName: String,
    val relationshipType: String,
    val emotionalSeed: String,
    val occasion: String?,
    val goalIntent: String?,
    val painPoints: List<String>,
    val suggestion: OnboardingSuggestion?,
)

data class OnboardingUiState(
    val stage: OnboardingStage = OnboardingStage.Splash,
    val node: OnboardingNode,
    val currentNodeId: String,
    val question: String,
    val supportingText: String? = null,
    val selectedValues: Set<String> = emptySet(),
    val draftText: String = "",
    val recipientName: String? = null,
    val relationshipType: String? = null,
    val emotionalSeed: String? = null,
    val goalIntent: String? = null,
    val suggestion: OnboardingSuggestion? = null,
    val isComplete: Boolean = false,
    val canGoBack: Boolean = false,
)
