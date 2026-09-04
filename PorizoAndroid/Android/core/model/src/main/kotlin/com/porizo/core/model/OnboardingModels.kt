package com.porizo.core.model

enum class OnboardingNodeType {
    MultiSelect,
    SingleSelect,
    SingleSelectOrText,
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
    val subtitle: String? = null,
    val questionTemplate: String?,
    val fallbackQuestion: String? = null,
    val options: List<OnboardingOption>,
    val minSelections: Int,
    val next: String?,
    val allowFreeText: Boolean = false,
)

data class OnboardingGraph(
    val entryNode: String,
    val nodes: Map<String, OnboardingNode>,
) {
    companion object {
        val default = OnboardingGraph(
            entryNode = "pain_points",
            nodes = mapOf(
                "pain_points" to OnboardingNode(
                    id = "pain_points",
                    type = OnboardingNodeType.MultiSelect,
                    question = "What makes gifting hard?",
                    subtitle = "Pick all that apply.",
                    questionTemplate = null,
                    options = listOf(
                        OnboardingOption("I'm not creative enough", "not_creative"),
                        OnboardingOption("I never know what to get", "dont_know_what"),
                        OnboardingOption("I always end up sending a text", "default_to_text"),
                        OnboardingOption("I forget until the last minute", "forget_timing"),
                        OnboardingOption("Nothing feels personal enough", "not_personal"),
                    ),
                    minSelections = 1,
                    next = "goal_question",
                ),
                "goal_question" to OnboardingNode(
                    id = "goal_question",
                    type = OnboardingNodeType.SingleSelect,
                    question = "What brought you here today?",
                    questionTemplate = null,
                    options = listOf(
                        OnboardingOption("Surprise someone for their birthday", "birthday_surprise"),
                        OnboardingOption("Say something I've never been able to say", "unsaid_words"),
                        OnboardingOption("Create a gift that actually means something", "meaningful_gift"),
                        OnboardingOption("Preserve a special memory", "preserve_memory"),
                        OnboardingOption("I have someone in mind", "someone_in_mind"),
                    ),
                    minSelections = 1,
                    next = "relationship_picker",
                ),
                "relationship_picker" to OnboardingNode(
                    id = "relationship_picker",
                    type = OnboardingNodeType.SingleSelect,
                    question = "Who deserves something unforgettable?",
                    questionTemplate = null,
                    options = listOf(
                        OnboardingOption("Mom", "mom"),
                        OnboardingOption("Dad", "dad"),
                        OnboardingOption("Partner", "partner"),
                        OnboardingOption("Sister", "sister"),
                        OnboardingOption("Brother", "brother"),
                        OnboardingOption("Best Friend", "best_friend"),
                        OnboardingOption("Son", "son"),
                        OnboardingOption("Daughter", "daughter"),
                        OnboardingOption("Grandparent", "grandparent"),
                        OnboardingOption("Someone Else", "other"),
                    ),
                    minSelections = 1,
                    next = "name_entry",
                ),
                "name_entry" to OnboardingNode(
                    id = "name_entry",
                    type = OnboardingNodeType.TextInput,
                    question = "Who is this for?",
                    questionTemplate = "What's your {relationship_label}'s name?",
                    fallbackQuestion = "Who is this for?",
                    options = emptyList(),
                    minSelections = 0,
                    next = "emotional_seed_{relationship_type}",
                ),
                "emotional_seed_mom" to OnboardingNode(
                    id = "emotional_seed_mom",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "Is there something you've always wanted to say to {name}, but never found the words?",
                    options = listOf(
                        OnboardingOption("Thank you for everything", "thank_you_everything"),
                        OnboardingOption("A childhood memory together", "childhood_memory"),
                        OnboardingOption("Something I've never said out loud", "unsaid_words"),
                    ),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_dad" to OnboardingNode(
                    id = "emotional_seed_dad",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "Is there something you've always wanted to say to {name}, but never found the words?",
                    options = listOf(
                        OnboardingOption("Thank you for everything", "thank_you_everything"),
                        OnboardingOption("A childhood memory together", "childhood_memory"),
                        OnboardingOption("Something I've never said out loud", "unsaid_words"),
                    ),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_partner" to OnboardingNode(
                    id = "emotional_seed_partner",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What moment is just yours and {name}'s?",
                    options = listOf(
                        OnboardingOption("How we first met", "first_met"),
                        OnboardingOption("An inside joke only we get", "inside_joke"),
                        OnboardingOption("Something I want them to remember", "always_remember"),
                    ),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_sister" to OnboardingNode(
                    id = "emotional_seed_sister",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What would {name} instantly recognize as something only you two share?",
                    options = siblingSeedOptions(),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_brother" to OnboardingNode(
                    id = "emotional_seed_brother",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What would {name} instantly recognize as something only you two share?",
                    options = siblingSeedOptions(),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_best_friend" to OnboardingNode(
                    id = "emotional_seed_best_friend",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What's the story only you and {name} know?",
                    options = listOf(
                        OnboardingOption("How we became friends", "how_we_met"),
                        OnboardingOption("The thing we always laugh about", "always_laugh"),
                        OnboardingOption("A moment that changed everything", "changed_everything"),
                    ),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_son" to OnboardingNode(
                    id = "emotional_seed_son",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What do you want {name} to always remember?",
                    options = childSeedOptions(),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_daughter" to OnboardingNode(
                    id = "emotional_seed_daughter",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What do you want {name} to always remember?",
                    options = childSeedOptions(),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_grandparent" to OnboardingNode(
                    id = "emotional_seed_grandparent",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What makes {name} unforgettable?",
                    options = treasuredSeedOptions(),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "emotional_seed_other" to OnboardingNode(
                    id = "emotional_seed_other",
                    type = OnboardingNodeType.SingleSelectOrText,
                    question = "What should the song hold onto?",
                    questionTemplate = "What makes {name} unforgettable?",
                    options = treasuredSeedOptions(),
                    minSelections = 1,
                    next = "occasion_picker",
                    allowFreeText = true,
                ),
                "occasion_picker" to OnboardingNode(
                    id = "occasion_picker",
                    type = OnboardingNodeType.SingleSelect,
                    question = "Is this for something special?",
                    questionTemplate = null,
                    options = listOf(
                        OnboardingOption("Just Because", "just_because"),
                        OnboardingOption("Birthday", "birthday"),
                        OnboardingOption("Anniversary", "anniversary"),
                        OnboardingOption("Thank You", "thank_you"),
                        OnboardingOption("Graduation", "graduation"),
                        OnboardingOption("Wedding", "wedding"),
                    ),
                    minSelections = 0,
                    next = "payoff",
                ),
                "payoff" to OnboardingNode(
                    id = "payoff",
                    type = OnboardingNodeType.Terminal,
                    question = "You're all set.",
                    questionTemplate = null,
                    options = emptyList(),
                    minSelections = 0,
                    next = null,
                ),
            ),
        )

        private fun siblingSeedOptions() = listOf(
            OnboardingOption("Growing up together", "growing_up"),
            OnboardingOption("An inside joke", "inside_joke"),
            OnboardingOption("Something we survived together", "survived_together"),
        )

        private fun childSeedOptions() = listOf(
            OnboardingOption("How proud I am", "proud"),
            OnboardingOption("A moment that made me smile", "made_me_smile"),
            OnboardingOption("Something I want to pass on", "pass_on"),
        )

        private fun treasuredSeedOptions() = listOf(
            OnboardingOption("A memory I treasure", "treasured_memory"),
            OnboardingOption("Something I've always admired", "always_admired"),
            OnboardingOption("A moment I want to preserve", "preserve_moment"),
        )
    }
}
