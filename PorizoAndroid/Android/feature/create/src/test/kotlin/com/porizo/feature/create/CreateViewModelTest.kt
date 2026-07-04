package com.porizo.feature.create

import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.player.PlayerUiState
import com.porizo.core.domain.repository.ConfirmStoryResult
import com.porizo.core.domain.repository.ContinueStoryResult
import com.porizo.core.domain.repository.CreateRepository
import com.porizo.core.domain.repository.RenderRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.repository.StartStoryResult
import com.porizo.core.domain.share.ShareDispatcher
import com.porizo.core.domain.share.ShareDispatchResult
import com.porizo.core.model.ApproveLyricsResult
import com.porizo.core.model.CreateContentType
import com.porizo.core.model.CreateDraft
import com.porizo.core.model.CreateShareResult
import com.porizo.core.model.JobStatus
import com.porizo.core.model.LyricsDocument
import com.porizo.core.model.PendingRender
import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.ReceiverHandoffResult
import com.porizo.core.model.RenderFullResult
import com.porizo.core.model.RenderPreviewResult
import com.porizo.core.model.ShareClaimResult
import com.porizo.core.model.ShareInfo
import com.porizo.core.model.ShareStreamResult
import com.porizo.core.model.StoryLyrics
import com.porizo.core.model.StoryToPoemResult
import com.porizo.core.model.StoryToTrackResult
import com.porizo.core.model.TrackDetail
import com.porizo.core.model.VoiceSource
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

class CreateViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun approveFailureReturnsToLyricsWithFlaggedPolicyTerms() = runTest(dispatcher) {
        val renderRepository = RejectingRenderRepository()
        val viewModel = CreateViewModel(
            createRepository = FakeCreateRepository(),
            renderRepository = renderRepository,
            shareRepository = FakeShareRepository(),
            player = FakePlayerController(),
            shareDispatcher = FakeShareDispatcher(),
        )
        advanceUntilIdle()

        viewModel.beginFromOnboarding(recipientName = "Sarah", message = "Make it specific.")
        advanceUntilIdle()
        viewModel.confirmName()
        viewModel.startConversation()
        advanceUntilIdle()
        viewModel.updateDraftAnswer("She loves the bridge.")
        viewModel.sendAnswer()
        advanceUntilIdle()
        viewModel.finishConversation()
        advanceUntilIdle()

        assertEquals(CreatePhase.Lyrics, viewModel.uiState.value.phase)
        viewModel.approveLyricsAndRender()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(CreatePhase.Lyrics, state.phase)
        assertTrue(renderRepository.savedLyrics)
        assertTrue(state.policyTerms.contains("specific artist name"))
        assertTrue(state.policyTerms.contains("Taylor Swift"))
    }

    @Test
    fun aiGuideVoiceSourceUsesSupportedBackendVoiceMode() = runTest(dispatcher) {
        val createRepository = FakeCreateRepository()
        val viewModel = CreateViewModel(
            createRepository = createRepository,
            renderRepository = RejectingRenderRepository(),
            shareRepository = FakeShareRepository(),
            player = FakePlayerController(),
            shareDispatcher = FakeShareDispatcher(),
        )
        advanceUntilIdle()

        viewModel.beginFromOnboarding(recipientName = "Sarah", message = "Make it specific.")
        viewModel.updateVoiceSource(VoiceSource.AiGuide)
        advanceUntilIdle()
        viewModel.confirmName()
        viewModel.startConversation()
        advanceUntilIdle()
        viewModel.updateDraftAnswer("She loves the bridge.")
        viewModel.sendAnswer()
        advanceUntilIdle()
        viewModel.finishConversation()
        advanceUntilIdle()
        viewModel.approveLyricsAndRender()
        advanceUntilIdle()

        assertEquals(listOf("ai_voice"), createRepository.storyToTrackVoiceModes)
    }
}

private class FakeCreateRepository : CreateRepository {
    val storyToTrackVoiceModes = mutableListOf<String>()

    override suspend fun loadDraft(): CreateDraft? = null
    override suspend fun saveDraft(draft: CreateDraft) = Unit
    override suspend fun clearDraft() = Unit
    override suspend fun startStory(initialPrompt: String, occasion: String, recipientName: String): StartStoryResult =
        StartStoryResult("story-1", "What should it remember?", 1)

    override suspend fun continueStory(storyId: String, answer: String, expectedSessionVersion: Int?): ContinueStoryResult =
        ContinueStoryResult("Ready to create.", 2, canFinish = true, isComplete = true)

    override suspend fun confirmStory(storyId: String): ConfirmStoryResult = ConfirmStoryResult.Confirmed
    override suspend fun generateStoryLyrics(storyId: String): StoryLyrics =
        StoryLyrics("Verse one\nChorus", qualityScore = 0.9)

    override suspend fun storyToTrack(storyId: String, voiceMode: String): StoryToTrackResult {
        storyToTrackVoiceModes += voiceMode
        return StoryToTrackResult("track-1", 1)
    }

    override suspend fun storyToPoem(storyId: String): StoryToPoemResult =
        StoryToPoemResult(PoemBody("poem-1", "Poem", "Sarah", listOf("Line"), null))
}

private class RejectingRenderRepository : RenderRepository {
    var savedLyrics = false

    override suspend fun getLyrics(trackId: String, versionNum: Int): LyricsDocument? = null
    override suspend fun updateLyrics(trackId: String, versionNum: Int, lyrics: LyricsDocument) {
        savedLyrics = true
    }
    override suspend fun approveLyrics(trackId: String, versionNum: Int): ApproveLyricsResult {
        throw PorizoFailure.Server(
            status = 422,
            code = "PROVIDER_POLICY",
            message = "Provider rejected specific artists: 'Taylor Swift'.",
        )
    }
    override suspend fun renderPreview(trackId: String, versionNum: Int): RenderPreviewResult = error("unused")
    override suspend fun renderFull(trackId: String, versionNum: Int): RenderFullResult = error("unused")
    override suspend fun retryPreview(trackId: String, versionNum: Int): RenderPreviewResult = error("unused")
    override suspend fun getJobStatus(jobId: String): JobStatus = error("unused")
    override suspend fun getTrack(trackId: String): TrackDetail = error("unused")
    override suspend fun loadPendingRender(): PendingRender? = null
    override suspend fun savePendingRender(render: PendingRender) = Unit
    override suspend fun clearPendingRender() = Unit
}

private class FakeShareRepository : ShareRepository {
    override suspend fun createTrackShare(trackId: String, versionNum: Int, requirePin: Boolean): CreateShareResult = error("unused")
    override suspend fun createPoemShare(poemId: String): CreateShareResult = error("unused")
    override suspend fun shareInfo(shareId: String): ShareInfo = error("unused")
    override suspend fun claimShare(shareId: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun shareStream(shareId: String): ShareStreamResult = error("unused")
    override suspend fun poemShareInfo(shareId: String): PoemShareInfo = error("unused")
    override suspend fun poemShareBody(shareId: String): PoemBody? = error("unused")
    override suspend fun claimPoemShare(shareId: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun resolveReceiverHandoff(handoffId: String): ReceiverHandoffResult = error("unused")
    override suspend fun claimReceiverToken(claimToken: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun receiverClaimStream(claimToken: String): ShareStreamResult = error("unused")
}

private class FakeShareDispatcher : ShareDispatcher {
    override fun sendGift(recipientName: String, phone: String?, link: String, contentType: CreateContentType): ShareDispatchResult =
        ShareDispatchResult.OpenedShareSheet

    override fun copyToClipboard(text: String): Boolean = true
}

private class FakePlayerController : PlayerController {
    override val state = MutableStateFlow(PlayerUiState())
    override fun play(track: PlayableTrack) = Unit
    override fun toggle() = Unit
    override fun seekToFraction(fraction: Float) = Unit
    override fun clear() = Unit
    override fun syncFromEngine() = Unit
}
