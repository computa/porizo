package com.porizo.core.domain.player

import com.porizo.core.model.PlayableTrack
import kotlinx.coroutines.flow.StateFlow

data class PlayerUiState(
    val currentTrack: PlayableTrack? = null,
    val isPlaying: Boolean = false,
    val positionSeconds: Double = 0.0,
    val durationSeconds: Double = 0.0,
    val lastError: String? = null,
) {
    val progressFraction: Double
        get() = if (durationSeconds > 0.0) {
            (positionSeconds / durationSeconds).coerceIn(0.0, 1.0)
        } else {
            0.0
        }
}

interface PlayerController {
    val state: StateFlow<PlayerUiState>

    fun play(track: PlayableTrack)
    fun toggle()
    fun seekToFraction(fraction: Float)
    fun clear()
    fun syncFromEngine()
}
