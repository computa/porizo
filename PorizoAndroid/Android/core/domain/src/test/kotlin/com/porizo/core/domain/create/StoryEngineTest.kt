package com.porizo.core.domain.create

import com.porizo.core.model.ContinueStorySignal
import com.porizo.core.model.StoryMessage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StoryEngineTest {
    @Test
    fun appendAssistantAddsBubbleAndSkipsEmpty() {
        val messages = StoryEngine.appendingAssistant("Who is it for?", emptyList())
        assertEquals(1, messages.size)
        assertEquals(StoryMessage.Role.Assistant, messages[0].role)
        assertEquals("Who is it for?", messages[0].text)

        assertTrue(StoryEngine.appendingAssistant(null, emptyList()).isEmpty())
        assertTrue(StoryEngine.appendingAssistant("   ", emptyList()).isEmpty())
    }

    @Test
    fun appendUserAddsTrimmedBubbleAndSkipsEmpty() {
        val messages = StoryEngine.appendingUser("  a memory  ", emptyList())
        assertEquals(1, messages.size)
        assertEquals(StoryMessage.Role.User, messages[0].role)
        assertEquals("a memory", messages[0].text)

        assertTrue(StoryEngine.appendingUser("   ", emptyList()).isEmpty())
    }

    @Test
    fun messageIdsAreStableAndUnique() {
        var messages = StoryEngine.appendingAssistant("Q1", emptyList())
        messages = StoryEngine.appendingUser("A1", messages)
        messages = StoryEngine.appendingAssistant("Q2", messages)
        assertEquals(listOf("msg-0", "msg-1", "msg-2"), messages.map { it.id })
    }

    @Test
    fun finishGateUsesServerSignalOrTurnFloor() {
        assertTrue(StoryEngine.canOfferFinish(cont(canFinish = true), userTurns = 0))
        assertTrue(StoryEngine.canOfferFinish(cont(isComplete = true), userTurns = 0))
        assertFalse(StoryEngine.canOfferFinish(cont(), userTurns = 2))
        assertTrue(StoryEngine.canOfferFinish(cont(), userTurns = 3))
    }

    @Test
    fun isSendableRequiresNonBlankText() {
        assertTrue(StoryEngine.isSendable("hi"))
        assertFalse(StoryEngine.isSendable("   "))
        assertFalse(StoryEngine.isSendable(""))
    }

    private fun cont(canFinish: Boolean? = null, isComplete: Boolean? = null) =
        ContinueStorySignal(
            question = "Anything else?",
            sessionVersion = 2,
            canFinish = canFinish,
            isComplete = isComplete,
        )
}
