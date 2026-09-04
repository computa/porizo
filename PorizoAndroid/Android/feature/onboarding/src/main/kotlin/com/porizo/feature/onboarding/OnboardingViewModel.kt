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

    fun toggleMulti(value: String) {
        val selected = _uiState.value.selectedValues.toMutableSet()
        if (!selected.add(value)) {
            selected.remove(value)
        }
        _uiState.value = _uiState.value.copy(selectedValues = selected)
    }

    fun answerMultiple() {
        engine.answerMultiple(_uiState.value.selectedValues.toList())
        sync()
    }

    fun answerText() {
        val trimmed = uiState.value.draftText.trim()
        if (trimmed.length < 2) return
        engine.answerText(trimmed)
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
            relationshipType = engine.answerFor("relationship_picker") ?: "other",
            emotionalSeed = engine.emotionalSeed ?: engine.answerFor("goal_question") ?: "meaningful_gift",
            occasion = engine.answerFor("occasion_picker")?.takeUnless { it == "just_because" },
            goalIntent = engine.answerFor("goal_question"),
            painPoints = engine.answersFor("pain_points"),
            suggestion = uiState.value.suggestion,
        )

    private fun sync() {
        val stage = if (engine.isComplete) OnboardingStage.Processing else OnboardingStage.Questionnaire
        _uiState.value = engine.toUiState(stage = stage, suggestion = _uiState.value.suggestion)
    }

    private fun fallbackSuggestion(): OnboardingSuggestion {
        val name = engine.recipientName ?: "them"
        val relationship = engine.relationshipLabel ?: engine.answerFor("relationship_picker") ?: "someone special"
        val goal = engine.answerFor("goal_question") ?: "meaningful_gift"
        val seed = engine.emotionalSeed ?: goal
        val titleName = if (name.equals("them", ignoreCase = true)) relationship else name
        return OnboardingSuggestion(
            title = "Song for $titleName",
            emotionalAngle = emotionalAngleFor(seed, relationship),
            previewLine = previewLineFor(name, goal, seed),
        )
    }

    private fun emotionalAngleFor(seed: String, relationship: String): String =
        when (seed) {
            "thank_you_everything" -> "A thank-you song for the person who kept showing up."
            "childhood_memory", "growing_up" -> "A memory-led song about the moments that made you family."
            "unsaid_words" -> "A gentle way to say what has been hard to say plainly."
            "inside_joke", "always_laugh" -> "A warm, specific song built around the laugh only you share."
            "proud" -> "A proud, steady song they can replay when they need to hear it."
            "treasured_memory", "preserve_moment" -> "A keepsake song that preserves one real moment."
            else -> "A personal song shaped around one true detail about your $relationship."
        }

    private fun previewLineFor(name: String, goal: String, seed: String): String {
        val resolvedName = name.takeUnless { it.equals("them", ignoreCase = true) } ?: "you"
        return when {
            goal == "birthday_surprise" -> "I saved the best part of today for your name, $resolvedName..."
            seed == "inside_joke" || seed == "always_laugh" -> "No one else would know why we still laugh about that day..."
            seed == "unsaid_words" -> "There are words I kept quiet, but I want you to hear them now..."
            seed == "proud" -> "If you ever forget how far you've come, play this back..."
            else -> "I took one little memory and turned it into something you can keep..."
        }
    }

    private fun OnboardingGraphEngine.toUiState(
        stage: OnboardingStage = OnboardingStage.Splash,
        suggestion: OnboardingSuggestion? = null,
    ): OnboardingUiState =
        OnboardingUiState(
            stage = stage,
            node = currentNode,
            currentNodeId = currentNodeId,
            question = currentQuestion,
            supportingText = supportTextFor(currentNodeId, answersFor("pain_points")),
            selectedValues = answersFor(currentNodeId).toSet(),
            recipientName = recipientName,
            relationshipType = answerFor("relationship_picker"),
            emotionalSeed = emotionalSeed,
            goalIntent = answerFor("goal_question"),
            suggestion = suggestion,
            isComplete = stage == OnboardingStage.Payoff,
            canGoBack = currentNodeId != OnboardingGraph.default.entryNode,
        )

    private fun supportTextFor(nodeId: String, painPoints: List<String>): String? {
        if (nodeId != "goal_question") return null
        return when {
            "not_creative" in painPoints -> "You don't need to be creative. Start with one real memory."
            "default_to_text" in painPoints -> "What if that text became something they could replay?"
            "dont_know_what" in painPoints -> "You don't need the perfect gift idea. We'll help you find one."
            "not_personal" in painPoints -> "This is how a gift feels like it could only come from you."
            "forget_timing" in painPoints -> "Start with the person. We can help with the rest."
            else -> null
        }
    }
}
