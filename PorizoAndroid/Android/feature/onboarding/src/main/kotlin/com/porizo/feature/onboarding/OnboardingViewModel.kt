package com.porizo.feature.onboarding

import androidx.lifecycle.ViewModel
import com.porizo.core.domain.create.OnboardingGraphEngine
import com.porizo.core.model.OnboardingGraph
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class OnboardingViewModel : ViewModel() {
    private val engine = OnboardingGraphEngine(OnboardingGraph.default)
    private val _uiState = MutableStateFlow(engine.toUiState())
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    fun advanceSplash() {
        _uiState.value = _uiState.value.copy(stage = OnboardingStage.Mirror)
    }

    fun advanceMirror() {
        _uiState.value = engine.toUiState(
            stage = OnboardingStage.Questionnaire,
            suggestion = _uiState.value.suggestion,
        )
    }

    fun updateDraft(value: String) {
        _uiState.value = _uiState.value.copy(draftText = value)
    }

    fun answerSingle(value: String) {
        engine.answerSingle(value)
        sync()
    }

    fun answerText() {
        engine.answerText(uiState.value.draftText)
        sync()
    }

    fun back() {
        if (_uiState.value.stage != OnboardingStage.Questionnaire) {
            _uiState.value = _uiState.value.copy(stage = OnboardingStage.Questionnaire)
            return
        }
        engine.back()
        sync()
    }

    fun skip() {
        _uiState.value = _uiState.value.copy(stage = OnboardingStage.Payoff, suggestion = fallbackSuggestion())
    }

    fun showPayoff() {
        _uiState.value = _uiState.value.copy(
            stage = OnboardingStage.Payoff,
            suggestion = fallbackSuggestion(),
        )
    }

    fun completeResult(): OnboardingResult =
        OnboardingResult(
            recipientName = engine.recipientName ?: "someone special",
            relationshipType = engine.answerFor("relationship") ?: "other",
            emotionalSeed = engine.answerFor("goal") ?: "meaningful_gift",
            occasion = if (engine.answerFor("goal")?.contains("birthday") == true) "birthday" else null,
            goalIntent = engine.answerFor("goal"),
            painPoints = emptyList(),
            suggestion = uiState.value.suggestion,
        )

    private fun sync() {
        val stage = if (engine.isComplete) OnboardingStage.Processing else OnboardingStage.Questionnaire
        _uiState.value = engine.toUiState(stage = stage, suggestion = _uiState.value.suggestion)
    }

    private fun fallbackSuggestion(): OnboardingSuggestion {
        val name = engine.recipientName ?: "them"
        val relationship = engine.answerFor("relationship") ?: "someone special"
        val goal = engine.answerFor("goal") ?: "meaningful_gift"
        return OnboardingSuggestion(
            title = "A personal song for $name",
            detail = when (goal) {
                "birthday_surprise" -> "Start with a birthday memory and a chorus that says their name clearly."
                "unsaid_words" -> "Say the thing a text message never quite carries."
                else -> "Turn one real detail about $relationship into a gift they can replay."
            },
        )
    }

    private fun OnboardingGraphEngine.toUiState(
        stage: OnboardingStage = OnboardingStage.Splash,
        suggestion: OnboardingSuggestion? = null,
    ): OnboardingUiState =
        OnboardingUiState(
            stage = stage,
            node = currentNode,
            question = currentQuestion,
            recipientName = recipientName,
            relationshipType = answerFor("relationship"),
            emotionalSeed = answerFor("goal"),
            goalIntent = answerFor("goal"),
            suggestion = suggestion,
            isComplete = stage == OnboardingStage.Payoff,
            canGoBack = currentNodeId != OnboardingGraph.default.entryNode,
        )
}
