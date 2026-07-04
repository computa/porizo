package com.porizo.core.media

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class PorizoPlayerErrorTest {
    private class FakeEngine : AudioPlaybackEngine {
        var error: String? = null
        var playing: Boolean = true

        override fun prepare(url: String, headers: Map<String, String>, metadata: PlaybackMetadata): Result<Unit> {
            error = null
            return Result.success(Unit)
        }

        override fun play() {
            error = null
        }

        override fun pause() {}
        override fun seekTo(positionMs: Long) {}
        override fun release() {}
        override fun currentPositionMs(): Long = 0L
        override fun durationMs(): Long = 0L
        override fun isPlaying(): Boolean = playing
        override fun lastError(): String? = error
    }

    @Test
    fun midStreamEngineErrorSurfacesAndStopsPlayback() {
        val engine = FakeEngine()
        val player = PorizoPlayer(
            engine = engine,
            baseUrl = "https://api.porizo.test/",
            accessTokenProvider = { null },
        )

        engine.error = "Source error"
        player.syncFromEngine()

        assertEquals("Source error", player.state.value.lastError)
        assertFalse(player.state.value.isPlaying)
    }
}
