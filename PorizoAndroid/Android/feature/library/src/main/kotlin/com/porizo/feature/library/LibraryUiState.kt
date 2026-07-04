package com.porizo.feature.library

import com.porizo.core.domain.library.PoemLibrary
import com.porizo.core.domain.library.PoemLibraryFilter
import com.porizo.core.domain.library.SongLibrary
import com.porizo.core.domain.library.SongLibraryFilter
import com.porizo.core.model.PoemSummary
import com.porizo.core.model.TrackSummary

data class SongsUiState(
    val isLoading: Boolean = false,
    val tracks: List<TrackSummary> = emptyList(),
    val filter: SongLibraryFilter = SongLibraryFilter.Mine,
    val message: String? = null,
    val pendingDeleteTrack: TrackSummary? = null,
) {
    val visibleTracks: List<TrackSummary>
        get() = SongLibrary.filtered(tracks, filter)
}

data class PoemsUiState(
    val isLoading: Boolean = false,
    val poems: List<PoemSummary> = emptyList(),
    val filter: PoemLibraryFilter = PoemLibraryFilter.Mine,
    val selectedPoem: PoemSummary? = null,
    val message: String? = null,
    val isPreparingAudio: Boolean = false,
    val pendingDeletePoem: PoemSummary? = null,
) {
    val visiblePoems: List<PoemSummary>
        get() = PoemLibrary.filtered(poems, filter)
}
