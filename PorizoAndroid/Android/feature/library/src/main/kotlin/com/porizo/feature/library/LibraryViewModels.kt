package com.porizo.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.library.PoemLibrary
import com.porizo.core.domain.library.PoemLibraryFilter
import com.porizo.core.domain.library.SongDisplayStatus
import com.porizo.core.domain.library.SongLibrary
import com.porizo.core.domain.library.SongLibraryFilter
import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.repository.LibraryRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.share.ShareDispatchResult
import com.porizo.core.domain.share.ShareDispatcher
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.PoemSummary
import com.porizo.core.model.TrackSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class SongsViewModel @Inject constructor(
    private val libraryRepository: LibraryRepository,
    private val shareRepository: ShareRepository,
    private val shareDispatcher: ShareDispatcher,
    private val player: PlayerController,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SongsUiState())
    val uiState: StateFlow<SongsUiState> = _uiState.asStateFlow()

    fun setFilter(filter: SongLibraryFilter) {
        _uiState.update { it.copy(filter = filter) }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, message = null) }
            runCatching { libraryRepository.tracks() }
                .onSuccess { tracks ->
                    _uiState.update { it.copy(isLoading = false, tracks = tracks, message = null) }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(isLoading = false, message = error.userMessage()) }
                }
        }
    }

    fun play(track: TrackSummary) {
        val displayStatus = SongLibrary.displayStatus(track.status)
        if (displayStatus != SongDisplayStatus.Ready) {
            _uiState.update { it.copy(message = displayStatus.notReadyMessage(track.title)) }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(message = null) }
            runCatching { libraryRepository.track(track.id) }
                .mapCatching { detail ->
                    SongLibrary.playableTrack(detail.track, detail.versions)
                        ?: throw PorizoFailure.Unknown(
                            "No playable audio is available yet. Refresh the library after rendering finishes.",
                        )
                }
                .onSuccess(player::play)
                .onFailure { error ->
                    _uiState.update { it.copy(message = error.userMessage()) }
                }
        }
    }

    fun openTrackReveal(trackId: String) {
        if (trackId.isBlank()) return
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    filter = SongLibraryFilter.Mine,
                    isLoading = true,
                    message = "Opening your ready song...",
                )
            }
            runCatching { libraryRepository.tracks() }
                .onSuccess { tracks ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            tracks = tracks,
                            message = tracks.firstOrNull { track -> track.id == trackId }?.let { track ->
                                "Ready: ${track.title}"
                            } ?: "Your render is ready.",
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(isLoading = false, message = error.userMessage()) }
                }
        }
    }

    fun share(track: TrackSummary) {
        if (SongLibrary.displayStatus(track.status) != SongDisplayStatus.Ready) {
            _uiState.update { it.copy(message = "This song needs to finish rendering before it can be shared.") }
            return
        }
        if (track.canShare == false) {
            _uiState.update { it.copy(message = "This song is protected and cannot be shared from this account.") }
            return
        }
        val versionNum = track.latestVersion ?: 1
        viewModelScope.launch {
            _uiState.update { it.copy(message = "Preparing share link...") }
            runCatching { shareRepository.createTrackShare(track.id, versionNum, requirePin = true) }
                .map { share ->
                    shareDispatcher.sendGift(
                        recipientName = track.recipientName.orEmpty(),
                        phone = null,
                        link = share.shareUrl,
                        contentType = com.porizo.core.model.CreateContentType.Song,
                    )
                }
                .onSuccess { result ->
                    _uiState.update {
                        it.copy(
                            message = when (result) {
                                ShareDispatchResult.SentSms -> "Message composer opened."
                                ShareDispatchResult.OpenedShareSheet -> "Share sheet opened."
                                ShareDispatchResult.Failed -> "Could not open a share target."
                            },
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(message = error.userMessage()) } }
        }
    }

    fun requestDelete(track: TrackSummary) {
        if (track.canDelete == false) {
            _uiState.update { it.copy(message = "This song cannot be deleted here.") }
            return
        }
        _uiState.update { it.copy(pendingDeleteTrack = track, message = null) }
    }

    fun cancelDelete() {
        _uiState.update { it.copy(pendingDeleteTrack = null) }
    }

    fun confirmDelete() {
        val track = _uiState.value.pendingDeleteTrack ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(message = "Deleting song...", pendingDeleteTrack = null) }
            runCatching { libraryRepository.deleteTrack(track.id) }
                .onSuccess {
                    _uiState.update { state ->
                        state.copy(
                            tracks = state.tracks.filterNot { item -> item.id == track.id },
                            message = "Song deleted.",
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(message = error.userMessage()) } }
        }
    }
}

@HiltViewModel
class PoemsViewModel @Inject constructor(
    private val libraryRepository: LibraryRepository,
    private val shareRepository: ShareRepository,
    private val shareDispatcher: ShareDispatcher,
    private val player: PlayerController,
) : ViewModel() {
    private val _uiState = MutableStateFlow(PoemsUiState())
    val uiState: StateFlow<PoemsUiState> = _uiState.asStateFlow()

    fun setFilter(filter: PoemLibraryFilter) {
        _uiState.update { it.copy(filter = filter) }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, message = null) }
            runCatching { libraryRepository.poems() }
                .onSuccess { poems ->
                    _uiState.update { it.copy(isLoading = false, poems = poems, message = null) }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(isLoading = false, message = error.userMessage()) }
                }
        }
    }

    fun selectPoem(poem: PoemSummary) {
        _uiState.update { it.copy(selectedPoem = poem, message = null) }
    }

    fun closePoem() {
        _uiState.update { it.copy(selectedPoem = null, isPreparingAudio = false) }
    }

    fun listen(poem: PoemSummary) {
        viewModelScope.launch {
            _uiState.update { it.copy(isPreparingAudio = true, message = null) }
            runCatching {
                libraryRepository.poemAudio(poem.id)
                    ?: throw PorizoFailure.Unknown("This poem audio is not ready yet. Try again after the backend finishes preparing it.")
            }
                .map { audioUrl -> PoemLibrary.playableTrack(poem, audioUrl) }
                .onSuccess(player::play)
                .onFailure { error ->
                    _uiState.update { it.copy(message = error.userMessage()) }
                }
            _uiState.update { it.copy(isPreparingAudio = false) }
        }
    }

    fun share(poem: PoemSummary) {
        if (poem.status.equals("draft", ignoreCase = true)) {
            _uiState.update { it.copy(message = "Finish this poem before sharing it.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(message = "Preparing share link...") }
            runCatching { shareRepository.createPoemShare(poem.id) }
                .map { share ->
                    shareDispatcher.sendGift(
                        recipientName = poem.recipientName,
                        phone = null,
                        link = share.shareUrl,
                        contentType = com.porizo.core.model.CreateContentType.Poem,
                    )
                }
                .onSuccess { result ->
                    _uiState.update {
                        it.copy(
                            message = when (result) {
                                ShareDispatchResult.SentSms -> "Message composer opened."
                                ShareDispatchResult.OpenedShareSheet -> "Share sheet opened."
                                ShareDispatchResult.Failed -> "Could not open a share target."
                            },
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(message = error.userMessage()) } }
        }
    }

    fun requestDelete(poem: PoemSummary) {
        _uiState.update { it.copy(pendingDeletePoem = poem, message = null) }
    }

    fun cancelDelete() {
        _uiState.update { it.copy(pendingDeletePoem = null) }
    }

    fun confirmDelete() {
        val poem = _uiState.value.pendingDeletePoem ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(message = "Deleting poem...", pendingDeletePoem = null) }
            runCatching { libraryRepository.deletePoem(poem.id) }
                .onSuccess {
                    _uiState.update { state ->
                        state.copy(
                            poems = state.poems.filterNot { item -> item.id == poem.id },
                            selectedPoem = state.selectedPoem?.takeUnless { it.id == poem.id },
                            message = "Poem deleted.",
                        )
                    }
                }
                .onFailure { error -> _uiState.update { it.copy(message = error.userMessage()) } }
        }
    }
}

private fun SongDisplayStatus.notReadyMessage(title: String): String =
    when (this) {
        SongDisplayStatus.Ready -> ""
        SongDisplayStatus.Creating -> "$title is still rendering. Refresh when the notification arrives."
        SongDisplayStatus.Failed -> "$title failed to render. Open Create to retry from the draft or support path."
        SongDisplayStatus.Draft -> "$title is still a draft and cannot be played yet."
    }

private fun Throwable.userMessage(): String =
    when (this) {
        is PorizoFailure -> message ?: "Something went wrong."
        else -> message ?: "Something went wrong."
    }
