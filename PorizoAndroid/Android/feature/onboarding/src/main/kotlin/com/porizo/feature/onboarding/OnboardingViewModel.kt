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
        engine.back()
        sync()
    }

    fun skip() {
        _uiState.value = _uiState.value.copy(isComplete = true, recipientName = null)
    }

    private fun sync() {
        _uiState.value = engine.toUiState()
    }

    private fun OnboardingGraphEngine.toUiState(): OnboardingUiState =
        OnboardingUiState(
            node = currentNode,
            question = currentQuestion,
            recipientName = recipientName,
            isComplete = isComplete,
            canGoBack = currentNodeId != OnboardingGraph.default.entryNode,
        )
}
