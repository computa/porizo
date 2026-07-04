package com.porizo.core.media

import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.player.PlayerUiState
import com.porizo.core.model.PlayableTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class PorizoPlayer(
    private val engine: AudioPlaybackEngine,
    private val baseUrl: String,
    private val accessTokenProvider: () -> String?,
) : PlayerController {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(PlayerUiState())
    private var pollJob: Job? = null

    override val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    override fun play(track: PlayableTrack) {
        val absoluteUrl = StreamingPolicy.absoluteUrl(track.streamUrl, baseUrl)
        val headers = StreamingPolicy.headersFor(track, accessTokenProvider())
        engine.prepare(absoluteUrl, headers)
            .onSuccess {
                engine.play()
                _state.value = PlayerUiState(
                    currentTrack = track.copy(streamUrl = absoluteUrl),
                    isPlaying = true,
                )
                startPolling()
            }
            .onFailure { error ->
                _state.update {
                    it.copy(
                        currentTrack = track.copy(streamUrl = absoluteUrl),
                        isPlaying = false,
                        lastError = error.message ?: "Unable to prepare audio.",
                    )
                }
            }
    }

    override fun toggle() {
        val current = _state.value.currentTrack ?: return
        if (_state.value.isPlaying) {
            engine.pause()
            syncFromEngine()
        } else {
            engine.play()
            _state.update { it.copy(currentTrack = current, isPlaying = true, lastError = null) }
            startPolling()
        }
    }

    override fun seekToFraction(fraction: Float) {
        val durationMs = engine.durationMs()
        if (durationMs <= 0L) return
        val target = (durationMs * fraction.coerceIn(0f, 1f)).toLong()
        engine.seekTo(target)
        syncFromEngine()
    }

    override fun clear() {
        pollJob?.cancel()
        pollJob = null
        engine.release()
        _state.value = PlayerUiState()
    }

    override fun syncFromEngine() {
        val current = _state.value.currentTrack
        val durationMs = engine.durationMs()
        val isPlaying = engine.isPlaying()
        _state.update {
            it.copy(
                currentTrack = current,
                isPlaying = isPlaying,
                positionSeconds = engine.currentPositionMs() / 1000.0,
                durationSeconds = if (durationMs > 0L) durationMs / 1000.0 else it.durationSeconds,
            )
        }
        if (!isPlaying) {
            pollJob?.cancel()
            pollJob = null
        }
    }

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (true) {
                delay(POLL_INTERVAL_MS)
                syncFromEngine()
                if (!_state.value.isPlaying) return@launch
            }
        }
    }

    private companion object {
        const val POLL_INTERVAL_MS = 500L
    }
}

object StreamingPolicy {
    fun headersFor(track: PlayableTrack, accessToken: String?): Map<String, String> =
        if (track.isOwnedContent && !accessToken.isNullOrBlank()) {
            mapOf("Authorization" to "Bearer $accessToken")
        } else {
            emptyMap()
        }

    fun absoluteUrl(rawUrl: String, baseUrl: String): String {
        val trimmed = rawUrl.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
        val base = baseUrl.trimEnd('/')
        val path = if (trimmed.startsWith("/")) trimmed else "/$trimmed"
        return base + path
    }
}
