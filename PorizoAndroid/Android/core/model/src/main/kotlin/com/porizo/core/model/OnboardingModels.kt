package com.porizo.core.model

enum class OnboardingNodeType {
    MultiSelect,
    SingleSelect,
    TextInput,
    Terminal,
}

data class OnboardingOption(
    val label: String,
    val value: String,
)

data class OnboardingNode(
    val id: String,
    val type: OnboardingNodeType,
    val question: String,
    val questionTemplate: String?,
    val options: List<OnboardingOption>,
    val minSelections: Int,
    val next: String?,
)

data class OnboardingGraph(
    val entryNode: String,
    val nodes: Map<String, OnboardingNode>,
) {
    companion object {
        val default = OnboardingGraph(
            entryNode = "goal",
            nodes = mapOf(
                "goal" to OnboardingNode(
                    id = "goal",
                    type = OnboardingNodeType.SingleSelect,
                    question = "What brought you here today?",
                    questionTemplate = null,
                    options = listOf(
                        OnboardingOption("Surprise someone for their birthday", "birthday_surprise"),
                        OnboardingOption("Say something I've never been able to say", "unsaid_words"),
                        OnboardingOption("Create a gift that means something", "meaningful_gift"),
                    ),
                    minSelections = 1,
                    next = "relationship",
                ),
                "relationship" to OnboardingNode(
                    id = "relationship",
                    type = OnboardingNodeType.SingleSelect,
                    question = "Who deserves something unforgettable?",
                    questionTemplate = null,
                    options = listOf(
                        OnboardingOption("Mom", "mom"),
                        OnboardingOption("Dad", "dad"),
                        OnboardingOption("Partner", "partner"),
                        OnboardingOption("Best Friend", "best_friend"),
                        OnboardingOption("Someone Else", "other"),
                    ),
                    minSelections = 1,
                    next = "name",
                ),
                "name" to OnboardingNode(
                    id = "name",
                    type = OnboardingNodeType.TextInput,
                    question = "Who is this for?",
                    questionTemplate = "What's your {relationship_label}'s name?",
                    options = emptyList(),
                    minSelections = 0,
                    next = "done",
                ),
                "done" to OnboardingNode(
                    id = "done",
                    type = OnboardingNodeType.Terminal,
                    question = "You're all set.",
                    questionTemplate = null,
                    options = emptyList(),
                    minSelections = 0,
                    next = null,
                ),
            ),
        )
    }
}
