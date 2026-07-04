package com.porizo.core.domain.create

import com.porizo.core.model.ContinueStorySignal
import com.porizo.core.model.StoryMessage

object StoryEngine {
    fun messageId(index: Int): String = "msg-$index"

    fun appendingAssistant(question: String?, messages: List<StoryMessage>): List<StoryMessage> {
        val trimmed = question?.trim().orEmpty()
        if (trimmed.isEmpty()) return messages
        return messages + StoryMessage(
            id = messageId(messages.size),
            role = StoryMessage.Role.Assistant,
            text = trimmed,
        )
    }

    fun appendingUser(answer: String, messages: List<StoryMessage>): List<StoryMessage> {
        val trimmed = answer.trim()
        if (trimmed.isEmpty()) return messages
        return messages + StoryMessage(
            id = messageId(messages.size),
            role = StoryMessage.Role.User,
            text = trimmed,
        )
    }

    fun canOfferFinish(response: ContinueStorySignal, userTurns: Int): Boolean =
        response.canFinish == true || response.isComplete == true || userTurns >= 3

    fun isSendable(answer: String): Boolean = answer.trim().isNotEmpty()
}
