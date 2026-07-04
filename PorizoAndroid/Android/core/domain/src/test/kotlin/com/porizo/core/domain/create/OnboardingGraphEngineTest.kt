package com.porizo.core.domain.create

import com.porizo.core.model.OnboardingGraph
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
        assertEquals(OnboardingGraph.default.entryNode, engine.currentNode.id)
        assertFalse(engine.isComplete)
    }

    @Test
    fun singleSelectAdvancesToNext() {
        val engine = engine()
        engine.answerSingle("birthday_surprise")
        assertEquals(OnboardingNodeType.SingleSelect, engine.currentNode.type)
        assertEquals("relationship", engine.currentNode.id)
    }

    @Test
    fun templateResolutionUsesRelationshipLabelAndName() {
        val engine = engine()
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")
        assertTrue(engine.currentQuestion.lowercase().contains("mom"))
    }

    @Test
    fun textInputCapturesRecipientNameAndCompletes() {
        val engine = engine()
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")
        engine.answerText("Maya")
        assertEquals("Maya", engine.recipientName)
        assertTrue(engine.isComplete)
    }

    @Test
    fun backReturnsToPreviousNode() {
        val engine = engine()
        engine.answerSingle("birthday_surprise")
        assertEquals("relationship", engine.currentNode.id)
        engine.back()
        assertEquals(OnboardingGraph.default.entryNode, engine.currentNode.id)
    }

    @Test
    fun emptyNameStillCompletesWithoutRecipient() {
        val engine = engine()
        engine.answerSingle("birthday_surprise")
        engine.answerSingle("mom")
        engine.answerText("   ")
        assertTrue(engine.isComplete)
        assertNull(engine.recipientName)
    }

    private fun engine() = OnboardingGraphEngine(OnboardingGraph.default)
}
