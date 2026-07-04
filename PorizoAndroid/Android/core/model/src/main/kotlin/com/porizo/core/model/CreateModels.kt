package com.porizo.core.model

enum class CreateContentType(val apiValue: String, val label: String) {
    Song("song", "Song"),
    Poem("poem", "Poem"),
}

enum class Occasion(val apiValue: String, val displayName: String) {
    Birthday("birthday", "Birthday"),
    MothersDay("mothers_day", "Mother's Day"),
    Anniversary("anniversary", "Anniversary"),
    ThankYou("thank_you", "Thank You"),
    ILoveYou("i_love_you", "I Love You"),
    Wedding("wedding", "Wedding"),
    Graduation("graduation", "Graduation"),
    Celebration("celebration", "Celebration"),
    Apology("apology", "Apology"),
    Encouragement("encouragement", "Encouragement"),
    Advice("advice", "Advice"),
    Bereavement("bereavement", "Bereavement"),
    Friendship("friendship", "Friendship"),
    GetWell("get_well", "Get Well"),
    Custom("custom", "Custom"),
}

enum class VoiceSource(val apiValue: String, val label: String) {
    CreatorVoice("user_voice", "Creator voice"),
    AiGuide("ai_voice", "AI guide vocal"),
    InstrumentalOnly("instrumental", "Instrumental only"),
}

data class StoryMessage(
    val id: String,
    val role: Role,
    val text: String,
) {
    enum class Role {
        Assistant,
        User,
    }
}

data class ContinueStorySignal(
    val question: String?,
    val sessionVersion: Int?,
    val canFinish: Boolean?,
    val isComplete: Boolean?,
)

data class StoryGuidance(
    val message: String?,
    val question: String?,
)

data class StoryLyrics(
    val lyrics: String?,
    val qualityScore: Double?,
)

data class StoryToTrackResult(
    val trackId: String,
    val versionNum: Int?,
)

data class StoryToPoemResult(
    val poem: PoemBody,
)
