package com.porizo.feature.create

import com.porizo.core.model.CreateContentType
import com.porizo.core.model.Occasion
import com.porizo.core.model.RenderResult
import com.porizo.core.model.StoryMessage
import com.porizo.core.model.VoiceSource

enum class CreatePhase {
    Name,
    Details,
    Conversation,
    Lyrics,
    Rendering,
    Reveal,
    Share,
}

enum class RenderPhase {
    Idle,
    Rendering,
    Completed,
    Failed,
}

data class CreateUiState(
    val phase: CreatePhase = CreatePhase.Name,
    val recipientName: String = "",
    val recipientPhone: String = "",
    val occasion: Occasion = Occasion.Birthday,
    val contentType: CreateContentType = CreateContentType.Song,
    val voiceSource: VoiceSource = VoiceSource.AiGuide,
    val tone: String = "",
    val message: String = "",
    val targetDurationSec: Int = 60,
    val messages: List<StoryMessage> = emptyList(),
    val draftAnswer: String = "",
    val storyId: String? = null,
    val sessionVersion: Int? = null,
    val userTurns: Int = 0,
    val canFinish: Boolean = false,
    val isBusy: Boolean = false,
    val notice: String? = null,
    val lyricsText: String? = null,
    val hasUnsavedLyricsChanges: Boolean = false,
    val isSavingLyrics: Boolean = false,
    val lyricsSaveMessage: String? = null,
    val policyTerms: List<String> = emptyList(),
    val createdTrackId: String? = null,
    val createdVersionNum: Int = 1,
    val createdPoemId: String? = null,
    val poemTitle: String? = null,
    val poemVerses: List<String> = emptyList(),
    val render: RenderUiState = RenderUiState(),
    val shareLink: String? = null,
    val sharePin: String? = null,
    val isCreatingShare: Boolean = false,
) {
    val canContinueName: Boolean
        get() = recipientName.trim().isNotEmpty()

    val canSendAnswer: Boolean
        get() = draftAnswer.trim().isNotEmpty() && !isBusy

    val createLabel: String
        get() = contentType.label.lowercase()
}

data class RenderUiState(
    val phase: RenderPhase = RenderPhase.Idle,
    val progress: Int? = null,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
    val showEditLyricsCta: Boolean = false,
    val showPaywallCta: Boolean = false,
    val policyTerms: List<String> = emptyList(),
    val result: RenderResult? = null,
)
