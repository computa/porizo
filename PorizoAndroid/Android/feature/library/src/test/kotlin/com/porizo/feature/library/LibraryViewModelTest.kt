package com.porizo.feature.library

import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.player.PlayerUiState
import com.porizo.core.domain.repository.LibraryRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.share.ShareDispatcher
import com.porizo.core.domain.share.ShareDispatchResult
import com.porizo.core.model.CreateShareResult
import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo
import com.porizo.core.model.PoemSummary
import com.porizo.core.model.ReceiverHandoffResult
import com.porizo.core.model.ShareClaimResult
import com.porizo.core.model.ShareInfo
import com.porizo.core.model.ShareStreamResult
import com.porizo.core.model.TrackDetail
import com.porizo.core.model.TrackSummary
import com.porizo.core.model.TrackVersion
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

class LibraryViewModelTest {
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
    fun songDeleteRequiresConfirmationBeforeRepositoryMutation() = runTest(dispatcher) {
        val track = track(id = "track-1", title = "Sarah Song")
        val repository = FakeLibraryRepository(tracks = mutableListOf(track))
        val viewModel = SongsViewModel(
            libraryRepository = repository,
            shareRepository = FakeShareRepository(),
            shareDispatcher = FakeShareDispatcher(),
            player = FakePlayerController(),
        )

        viewModel.refresh()
        advanceUntilIdle()
        viewModel.requestDelete(track)

        assertEquals(track, viewModel.uiState.value.pendingDeleteTrack)
        assertEquals(0, repository.deletedTrackIds.size)

        viewModel.confirmDelete()
        advanceUntilIdle()

        assertEquals(listOf("track-1"), repository.deletedTrackIds)
        assertNull(viewModel.uiState.value.pendingDeleteTrack)
        assertFalse(viewModel.uiState.value.tracks.any { it.id == "track-1" })
    }

    @Test
    fun receivedSongPlaybackUsesShareStreamInsteadOfOwnerTrackDetail() = runTest(dispatcher) {
        val track = track(
            id = "track-1",
            title = "Sarah Song",
            origin = "received",
            shareTokenId = "share-1",
        )
        val libraryRepository = FakeLibraryRepository(
            tracks = mutableListOf(track),
            detail = TrackDetail(
                track = track,
                versions = listOf(TrackVersion("v1", 1, "ready", "/preview.m4a", "/owner-full.m4a", null, null, null, null)),
            ),
        )
        val shareRepository = FakeShareRepository(
            streams = mapOf("share-1" to ShareStreamResult("/share/share-1/playlist", "hls", null, null)),
        )
        val player = FakePlayerController()
        val viewModel = SongsViewModel(
            libraryRepository = libraryRepository,
            shareRepository = shareRepository,
            shareDispatcher = FakeShareDispatcher(),
            player = player,
        )

        viewModel.play(track)
        advanceUntilIdle()

        assertEquals(listOf("share-1"), shareRepository.shareStreamIds)
        assertEquals(0, libraryRepository.trackDetailRequests)
        assertEquals("/share/share-1/playlist", player.playedTrack?.streamUrl)
        assertFalse(player.playedTrack?.requiresAuthorization == true)
        assertTrue(player.playedTrack?.requiresDeviceToken == true)
    }

    private fun track(
        id: String,
        title: String,
        origin: String? = null,
        shareTokenId: String? = null,
    ): TrackSummary =
        TrackSummary(
            id = id,
            title = title,
            occasion = "birthday",
            recipientName = "Sarah",
            status = "ready",
            latestVersion = 1,
            shareTokenId = shareTokenId,
            artworkUrl = null,
            libraryOrigin = origin,
            canShare = true,
            canDelete = true,
        )
}

private class FakeLibraryRepository(
    private val tracks: MutableList<TrackSummary> = mutableListOf(),
    private val poems: MutableList<PoemSummary> = mutableListOf(),
    private val detail: TrackDetail? = null,
) : LibraryRepository {
    val deletedTrackIds = mutableListOf<String>()
    var trackDetailRequests = 0

    override suspend fun tracks(): List<TrackSummary> = tracks
    override suspend fun track(trackId: String): TrackDetail {
        trackDetailRequests += 1
        return detail ?: error("unused")
    }
    override suspend fun deleteTrack(trackId: String) {
        deletedTrackIds += trackId
        tracks.removeAll { it.id == trackId }
    }
    override suspend fun poems(): List<PoemSummary> = poems
    override suspend fun deletePoem(poemId: String) = Unit
    override suspend fun poemAudio(poemId: String): String? = null
}

private class FakeShareRepository(
    private val streams: Map<String, ShareStreamResult> = emptyMap(),
) : ShareRepository {
    val shareStreamIds = mutableListOf<String>()

    override suspend fun createTrackShare(trackId: String, versionNum: Int, requirePin: Boolean): CreateShareResult = error("unused")
    override suspend fun createPoemShare(poemId: String): CreateShareResult = error("unused")
    override suspend fun shareInfo(shareId: String): ShareInfo = error("unused")
    override suspend fun claimShare(shareId: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun shareStream(shareId: String): ShareStreamResult {
        shareStreamIds += shareId
        return streams[shareId] ?: error("unused")
    }
    override suspend fun poemShareInfo(shareId: String): PoemShareInfo = error("unused")
    override suspend fun poemShareBody(shareId: String): PoemBody? = error("unused")
    override suspend fun claimPoemShare(shareId: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun resolveReceiverHandoff(handoffId: String): ReceiverHandoffResult = error("unused")
    override suspend fun claimReceiverToken(claimToken: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun receiverClaimStream(claimToken: String): ShareStreamResult = error("unused")
}

private class FakeShareDispatcher : ShareDispatcher {
    override fun sendGift(recipientName: String, phone: String?, link: String, contentType: com.porizo.core.model.CreateContentType): ShareDispatchResult =
        ShareDispatchResult.OpenedShareSheet

    override fun copyToClipboard(text: String): Boolean = true
}

private class FakePlayerController : PlayerController {
    override val state = MutableStateFlow(PlayerUiState())
    var playedTrack: PlayableTrack? = null
    override fun play(track: PlayableTrack) {
        playedTrack = track
    }
    override fun toggle() = Unit
    override fun seekToFraction(fraction: Float) = Unit
    override fun clear() = Unit
    override fun syncFromEngine() = Unit
}
