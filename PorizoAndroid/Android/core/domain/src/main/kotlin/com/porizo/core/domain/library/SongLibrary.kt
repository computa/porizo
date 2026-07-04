package com.porizo.core.domain.library

import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.TrackSummary
import com.porizo.core.model.TrackVersion

enum class SongDisplayStatus {
    Ready,
    Creating,
    Draft,
    Failed,
}

enum class SongLibraryFilter(val label: String) {
    Mine("My Songs"),
    Received("Received"),
}

object SongLibrary {
    fun displayStatus(rawStatus: String): SongDisplayStatus =
        when (rawStatus.lowercase()) {
            "failed", "dead_letter", "blocked" -> SongDisplayStatus.Failed
            "ready", "preview_ready", "full_ready", "completed", "complete" -> SongDisplayStatus.Ready
            "draft", "lyrics_ready", "lyrics_approved", "created" -> SongDisplayStatus.Draft
            else -> SongDisplayStatus.Creating
        }

    fun badgeLabel(status: SongDisplayStatus): String =
        when (status) {
            SongDisplayStatus.Ready -> "Ready"
            SongDisplayStatus.Creating -> "Creating"
            SongDisplayStatus.Draft -> "Draft"
            SongDisplayStatus.Failed -> "Failed"
        }

    fun filtered(tracks: List<TrackSummary>, filter: SongLibraryFilter): List<TrackSummary> =
        when (filter) {
            SongLibraryFilter.Mine -> tracks.filterNot { it.isReceived }
            SongLibraryFilter.Received -> tracks.filter { it.isReceived }
        }

    fun playableTrack(summary: TrackSummary, versions: List<TrackVersion>): PlayableTrack? {
        val version = versions
            .sortedByDescending { it.versionNum }
            .firstOrNull { it.playableUrl != null }
            ?: return null
        val url = version.playableUrl ?: return null
        return PlayableTrack(
            id = summary.id,
            title = summary.title,
            recipientName = summary.recipientName,
            artworkUrl = summary.artworkUrl,
            streamUrl = url,
            isOwnedContent = !summary.isReceived,
        )
    }
}
