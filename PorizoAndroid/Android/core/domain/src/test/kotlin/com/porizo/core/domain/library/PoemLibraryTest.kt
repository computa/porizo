package com.porizo.core.domain.library

import com.porizo.core.model.PoemSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PoemLibraryTest {
    @Test
    fun filterSplitsMineVsReceived() {
        val all = listOf(poem(id = "a"), poem(id = "b", origin = "received"))
        assertEquals(listOf("a"), PoemLibrary.filtered(all, PoemLibraryFilter.Mine).map { it.id })
        assertEquals(listOf("b"), PoemLibrary.filtered(all, PoemLibraryFilter.Received).map { it.id })
        assertEquals("My Poems", PoemLibraryFilter.Mine.label)
        assertEquals("Received", PoemLibraryFilter.Received.label)
    }

    @Test
    fun previewUsesFirstNonEmptyVerse() {
        assertEquals("Real line", PoemLibrary.preview(poem(verses = listOf("", "  ", "Real line"))))
        assertEquals("First", PoemLibrary.preview(poem(verses = listOf("First"))))
        assertEquals("Tap to read", PoemLibrary.preview(poem(verses = listOf("", "   "))))
        assertEquals("Tap to read", PoemLibrary.preview(poem(verses = emptyList())))
    }

    @Test
    fun playableTrackFromAudioUrl() {
        val track = PoemLibrary.playableTrack(poem(id = "p9"), "/poems/p9/audio")
        assertEquals("p9", track.id)
        assertEquals("/poems/p9/audio", track.streamUrl)
        assertEquals("Sarah", track.recipientName)
        assertTrue(PoemLibrary.playableTrack(poem(origin = null), "/a").isOwnedContent)
        assertFalse(PoemLibrary.playableTrack(poem(origin = "received"), "/a").isOwnedContent)
    }

    private fun poem(
        id: String = "p1",
        verses: List<String> = listOf("Roses are red", "Violets are blue"),
        origin: String? = null,
    ) = PoemSummary(
        id = id,
        title = "For Sarah",
        recipientName = "Sarah",
        occasion = "Birthday",
        tone = "warm",
        status = "complete",
        verses = verses,
        libraryOrigin = origin,
    )
}
