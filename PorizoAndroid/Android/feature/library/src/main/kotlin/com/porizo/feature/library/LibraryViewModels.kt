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
        if (SongLibrary.displayStatus(track.status) != SongDisplayStatus.Ready) {
            _uiState.update { it.copy(message = "This song is still being prepared.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(message = null) }
            runCatching { libraryRepository.track(track.id) }
                .mapCatching { detail ->
                    SongLibrary.playableTrack(detail.track, detail.versions)
                        ?: error("This song does not have a playable version yet.")
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
}

@HiltViewModel
class PoemsViewModel @Inject constructor(
    private val libraryRepository: LibraryRepository,
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
            runCatching { libraryRepository.poemAudio(poem.id) ?: "/poems/${poem.id}/audio" }
                .map { audioUrl -> PoemLibrary.playableTrack(poem, audioUrl) }
                .onSuccess(player::play)
                .onFailure { error ->
                    _uiState.update { it.copy(message = error.userMessage()) }
                }
            _uiState.update { it.copy(isPreparingAudio = false) }
        }
    }
}

private fun Throwable.userMessage(): String =
    when (this) {
        is PorizoFailure -> message ?: "Something went wrong."
        else -> message ?: "Something went wrong."
    }
