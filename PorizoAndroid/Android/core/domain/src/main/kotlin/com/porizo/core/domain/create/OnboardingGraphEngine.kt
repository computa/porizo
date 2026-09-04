package com.porizo.core.domain.create

import com.porizo.core.model.OnboardingGraph
import com.porizo.core.model.OnboardingNode
import com.porizo.core.model.OnboardingNodeType

class OnboardingGraphEngine(
    private val graph: OnboardingGraph,
) {
    var currentNodeId: String = graph.entryNode
        private set

    private val history = mutableListOf<String>()
    private val answers = mutableMapOf<String, String>()
    private val multipleAnswers = mutableMapOf<String, List<String>>()

    val currentNode: OnboardingNode
        get() = graph.nodes[currentNodeId] ?: graph.nodes.getValue(graph.entryNode)

    val isComplete: Boolean
        get() = currentNode.type == OnboardingNodeType.Terminal

    val recipientName: String?
        get() = textAnswerFor("name_entry") ?: textAnswerFor("name")

    val relationshipLabel: String?
        get() {
            val nodeId = relationshipNodeId ?: return null
            val value = answers[nodeId] ?: return null
            return graph.nodes[nodeId]?.options?.firstOrNull { it.value == value }?.label
        }

    val emotionalSeed: String?
        get() = answers.entries
            .firstOrNull { (nodeId, value) ->
                nodeId.startsWith("emotional_seed_") && value.trim().isNotEmpty()
            }
            ?.value
            ?.trim()

    fun answerFor(nodeId: String): String? =
        textAnswerFor(nodeId)

    fun answersFor(nodeId: String): List<String> =
        multipleAnswers[nodeId].orEmpty()

    val currentQuestion: String
        get() {
            val template = currentNode.questionTemplate ?: return currentNode.question
            val resolved = template
                .replace("{relationship_label}", relationshipLabel ?: "{relationship_label}")
                .replace("{name}", recipientName ?: "{name}")
            return if (resolved.hasUnresolvedTemplateToken()) {
                currentNode.fallbackQuestion ?: currentNode.question
            } else {
                resolved
            }
        }

    private val relationshipType: String?
        get() = relationshipNodeId?.let { answers[it] }

    private val relationshipNodeId: String?
        get() = listOf("relationship_picker", "relationship").firstOrNull { answers.containsKey(it) }

    fun answerSingle(value: String) {
        answers[currentNodeId] = value
        advance()
    }

    fun answerMultiple(values: List<String>) {
        multipleAnswers[currentNodeId] = values
        advance()
    }

    fun answerText(text: String) {
        answers[currentNodeId] = text
        advance()
    }

    fun back() {
        if (history.isEmpty()) return
        currentNodeId = history.removeAt(history.lastIndex)
    }

    private fun advance() {
        val rawNext = currentNode.next ?: return
        val next = rawNext.replace("{relationship_type}", relationshipType.orEmpty())
        if (!graph.nodes.containsKey(next)) return
        history += currentNodeId
        currentNodeId = next
    }

    private fun textAnswerFor(nodeId: String): String? {
        val answer = answers[nodeId] ?: answers[answerAliasFor(nodeId)]
        return answer?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun answerAliasFor(nodeId: String): String? =
        when (nodeId) {
            "goal" -> "goal_question"
            "relationship" -> "relationship_picker"
            "name" -> "name_entry"
            "occasion" -> "occasion_picker"
            else -> null
        }

    private fun String.hasUnresolvedTemplateToken(): Boolean {
        val openIndex = indexOf('{')
        if (openIndex == -1) return false
        val closeIndex = indexOf('}', startIndex = openIndex + 1)
        return closeIndex > openIndex + 1
    }
}
