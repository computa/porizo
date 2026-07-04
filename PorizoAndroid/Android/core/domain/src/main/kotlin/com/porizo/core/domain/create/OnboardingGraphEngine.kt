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

    val currentNode: OnboardingNode
        get() = graph.nodes[currentNodeId] ?: graph.nodes.getValue(graph.entryNode)

    val isComplete: Boolean
        get() = currentNode.type == OnboardingNodeType.Terminal

    val recipientName: String?
        get() = answers["name"]?.trim()?.takeIf { it.isNotEmpty() }

    fun answerFor(nodeId: String): String? =
        answers[nodeId]?.trim()?.takeIf { it.isNotEmpty() }

    val currentQuestion: String
        get() {
            val template = currentNode.questionTemplate ?: return currentNode.question
            return template
                .replace("{relationship_label}", relationshipLabel ?: "them")
                .replace("{name}", recipientName ?: "them")
        }

    private val relationshipLabel: String?
        get() {
            val value = answers["relationship"] ?: return null
            return graph.nodes["relationship"]?.options?.firstOrNull { it.value == value }?.label
        }

    fun answerSingle(value: String) {
        answers[currentNodeId] = value
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
        val next = rawNext.replace("{relationship_type}", answers["relationship"].orEmpty())
        if (!graph.nodes.containsKey(next)) return
        history += currentNodeId
        currentNodeId = next
    }
}
