package com.porizo.core.domain.create

import com.porizo.core.model.OnboardingGraph
import com.porizo.core.model.OnboardingNode
import com.porizo.core.model.OnboardingNodeType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OnboardingGraphEngineTest {
    @Test
    fun startsAtEntryNode() {
        val engine = engine()
        assertEquals("pain_points", engine.currentNode.id)
        assertEquals(OnboardingNodeType.MultiSelect, engine.currentNode.type)
        assertFalse(engine.isComplete)
    }

    @Test
    fun multiSelectAdvancesToGoalAndPreservesSelectedValues() {
        val engine = engine()
        val selections = listOf("not_creative", "not_personal")

        engine.answerMultiple(selections)

        assertEquals("goal_question", engine.currentNode.id)
        assertEquals(selections, engine.answersFor("pain_points"))
        assertNull(engine.answerFor("pain_points"))
    }

    @Test
    fun singleSelectAfterPainPointsAndGoalAdvancesToRelationship() {
        val engine = engine()
        engine.answerMultiple(listOf("not_creative"))
        engine.answerSingle("birthday_surprise")

        assertEquals(OnboardingNodeType.SingleSelect, engine.currentNode.type)
        assertEquals("relationship_picker", engine.currentNode.id)
    }

    @Test
    fun templateResolutionUsesRelationshipLabelAndName() {
        val engine = engine()
        engine.answerMultiple(listOf("not_creative"))
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")

        assertEquals("name_entry", engine.currentNode.id)
        assertEquals("Mom", engine.relationshipLabel)
        assertTrue(engine.currentQuestion.contains("Mom"))

        engine.answerText("Maya")

        assertEquals("emotional_seed_mom", engine.currentNode.id)
        assertTrue(engine.currentQuestion.contains("Maya"))
    }

    @Test
    fun textInputCapturesRecipientNameAndAdvancesToEmotionalSeed() {
        val engine = engine()
        engine.answerMultiple(listOf("not_creative"))
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")
        engine.answerText("Maya")

        assertEquals("Maya", engine.recipientName)
        assertEquals("Maya", engine.answerFor("name_entry"))
        assertEquals("Maya", engine.answerFor("name"))
        assertEquals("emotional_seed_mom", engine.currentNode.id)
        assertFalse(engine.isComplete)
    }

    @Test
    fun completionRequiresEmotionalSeedAndOccasion() {
        val engine = engine()
        engine.answerMultiple(listOf("not_creative"))
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")
        engine.answerText("Maya")
        engine.answerSingle("thank_you_everything")

        assertEquals("occasion_picker", engine.currentNode.id)
        assertEquals("birthday_surprise", engine.answerFor("goal_question"))
        assertEquals("mom", engine.answerFor("relationship_picker"))
        assertEquals("thank_you_everything", engine.answerFor("emotional_seed_mom"))
        assertEquals("thank_you_everything", engine.emotionalSeed)
        assertFalse(engine.isComplete)

        engine.answerSingle("birthday")

        assertEquals("payoff", engine.currentNode.id)
        assertEquals("birthday", engine.answerFor("occasion_picker"))
        assertTrue(engine.isComplete)
    }

    @Test
    fun backFromGoalReturnsToPainPoints() {
        val engine = engine()
        engine.answerMultiple(listOf("not_creative"))
        assertEquals("goal_question", engine.currentNode.id)

        engine.back()

        assertEquals("pain_points", engine.currentNode.id)
    }

    @Test
    fun emptyNameStillAdvancesWithoutRecipient() {
        val engine = engine()
        engine.answerMultiple(listOf("not_creative"))
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")
        engine.answerText("   ")

        assertEquals("emotional_seed_mom", engine.currentNode.id)
        assertFalse(engine.isComplete)
        assertNull(engine.recipientName)
    }

    @Test
    fun currentQuestionUsesFallbackWhenTemplateTokensRemain() {
        val graph = OnboardingGraph(
            entryNode = "name_entry",
            nodes = mapOf(
                "name_entry" to OnboardingNode(
                    id = "name_entry",
                    type = OnboardingNodeType.TextInput,
                    question = "Plain name question",
                    questionTemplate = "What's your {relationship_label}'s name?",
                    fallbackQuestion = "Who is this for?",
                    options = emptyList(),
                    minSelections = 0,
                    next = null,
                ),
            ),
        )
        val engine = OnboardingGraphEngine(graph)

        assertEquals("Who is this for?", engine.currentQuestion)
    }

    private fun engine() = OnboardingGraphEngine(OnboardingGraph.default)
}
