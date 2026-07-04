package com.porizo.core.domain.library

import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.PoemSummary

enum class PoemLibraryFilter(val label: String) {
    Mine("My Poems"),
    Received("Received"),
}

object PoemLibrary {
    fun filtered(poems: List<PoemSummary>, filter: PoemLibraryFilter): List<PoemSummary> =
        when (filter) {
            PoemLibraryFilter.Mine -> poems.filterNot { it.isReceived }
            PoemLibraryFilter.Received -> poems.filter { it.isReceived }
        }

    fun preview(poem: PoemSummary): String =
        poem.verses.firstOrNull { it.trim().isNotEmpty() } ?: "Tap to read"

    fun playableTrack(poem: PoemSummary, audioUrl: String): PlayableTrack =
        PlayableTrack(
            id = poem.id,
            title = poem.title,
            recipientName = poem.recipientName,
            artworkUrl = null,
            streamUrl = audioUrl,
            isOwnedContent = !poem.isReceived,
        )
}
