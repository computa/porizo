package com.porizo.core.media

data class PlaybackMetadata(
    val title: String,
    val artist: String?,
    val artworkUrl: String?,
)

interface AudioPlaybackEngine {
    fun prepare(url: String, headers: Map<String, String>, metadata: PlaybackMetadata): Result<Unit>
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun release()
    fun currentPositionMs(): Long
    fun durationMs(): Long
    fun isPlaying(): Boolean
}
