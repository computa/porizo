package com.porizo.core.media

interface AudioPlaybackEngine {
    fun prepare(url: String, headers: Map<String, String>): Result<Unit>
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun release()
    fun currentPositionMs(): Long
    fun durationMs(): Long
    fun isPlaying(): Boolean
}
