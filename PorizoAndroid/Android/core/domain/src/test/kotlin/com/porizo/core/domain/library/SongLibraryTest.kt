package com.porizo.core.domain.library

import com.porizo.core.model.TrackSummary
import com.porizo.core.model.TrackVersion
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SongLibraryTest {
    @Test
    fun statusMapping() {
        listOf("ready", "preview_ready", "full_ready", "completed", "complete").forEach {
            assertEquals(SongDisplayStatus.Ready, SongLibrary.displayStatus(it))
        }
        listOf("failed", "dead_letter", "blocked").forEach {
            assertEquals(SongDisplayStatus.Failed, SongLibrary.displayStatus(it))
        }
        listOf("draft", "lyrics_ready", "lyrics_approved", "created").forEach {
            assertEquals(SongDisplayStatus.Draft, SongLibrary.displayStatus(it))
        }
        listOf("queued", "processing", "rendering", "anything_else").forEach {
            assertEquals(SongDisplayStatus.Creating, SongLibrary.displayStatus(it))
        }
        assertEquals(SongDisplayStatus.Failed, SongLibrary.displayStatus("FAILED"))
        assertEquals(SongDisplayStatus.Ready, SongLibrary.displayStatus("Ready"))
    }

    @Test
    fun badgeLabelsAndFilterLabels() {
        assertEquals("Ready", SongLibrary.badgeLabel(SongDisplayStatus.Ready))
        assertEquals("Creating", SongLibrary.badgeLabel(SongDisplayStatus.Creating))
        assertEquals("Draft", SongLibrary.badgeLabel(SongDisplayStatus.Draft))
        assertEquals("Failed", SongLibrary.badgeLabel(SongDisplayStatus.Failed))
        assertEquals("My Songs", SongLibraryFilter.Mine.label)
        assertEquals("Received", SongLibraryFilter.Received.label)
    }

    @Test
    fun filterSplitsMineVsReceived() {
        val all = listOf(summary(id = "a"), summary(id = "b", origin = "created"), summary(id = "c", origin = "received"))
        assertEquals(listOf("a", "b"), SongLibrary.filtered(all, SongLibraryFilter.Mine).map { it.id })
        assertEquals(listOf("c"), SongLibrary.filtered(all, SongLibraryFilter.Received).map { it.id })
    }

    @Test
    fun playablePrefersLatestVersionWithUrlAndFullOverPreview() {
        val playable = SongLibrary.playableTrack(
            summary(),
            listOf(
                version(num = 1, full = "/tracks/t1/v1/full.m4a"),
                version(num = 3, full = "/tracks/t1/v3/full.m4a"),
                version(num = 2, preview = "/tracks/t1/v2/preview.m4a"),
            ),
        )
        assertEquals("/tracks/t1/v3/full.m4a", playable?.streamUrl)

        assertEquals(
            "/f.m4a",
            SongLibrary.playableTrack(summary(), listOf(version(num = 1, preview = "/p.m4a", full = "/f.m4a")))?.streamUrl,
        )
        assertEquals(
            "/p.m4a",
            SongLibrary.playableTrack(summary(), listOf(version(num = 1, preview = "/p.m4a")))?.streamUrl,
        )
    }

    @Test
    fun playableNilWhenNoUrlAndOwnedAuthFlagsFollowOrigin() {
        assertNull(SongLibrary.playableTrack(summary(), listOf(version(num = 1))))
        assertNull(SongLibrary.playableTrack(summary(), emptyList()))
        val owned = SongLibrary.playableTrack(summary(origin = null), listOf(version(num = 1, full = "/f.m4a")))
        assertTrue(owned?.isOwnedContent == true)
        assertTrue(owned.requiresAuthorization)

        val received = SongLibrary.playableTrack(
            summary(origin = "received"),
            listOf(version(num = 1, preview = "/preview.m4a", full = "/full.m4a")),
        )
        assertFalse(received?.isOwnedContent == true)
        assertFalse(received?.requiresAuthorization == true)
        assertEquals("/preview.m4a", received?.streamUrl)
        assertNull(SongLibrary.playableTrack(summary(origin = "received"), listOf(version(num = 1, full = "/full.m4a"))))
    }

    private fun summary(
        id: String = "t1",
        status: String = "ready",
        origin: String? = null,
    ) = TrackSummary(
        id = id,
        title = "For Sarah",
        occasion = "Birthday",
        recipientName = "Sarah",
        status = status,
        latestVersion = 1,
        shareTokenId = null,
        artworkUrl = null,
        libraryOrigin = origin,
        canShare = true,
        canDelete = true,
    )

    private fun version(
        num: Int,
        status: String = "ready",
        preview: String? = null,
        full: String? = null,
    ) = TrackVersion(
        id = "v$num",
        versionNum = num,
        status = status,
        previewUrl = preview,
        fullUrl = full,
        previewJobId = null,
        fullJobId = null,
        lastErrorCode = null,
        lastErrorMessage = null,
    )
}
