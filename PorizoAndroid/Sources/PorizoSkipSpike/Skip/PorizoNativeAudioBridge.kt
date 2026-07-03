package porizo.skip.spike

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import org.json.JSONObject

/**
 * ExoPlayer-backed streaming audio bridge (U2).
 *
 * The Swift side (AndroidAudioPlayer) owns URL/header policy and drives this via
 * plain string/primitive calls, mirroring the recorder/push/billing bridges.
 *
 * Threading: ExoPlayer must be created and controlled on the thread it was built
 * on. We build and drive it on the main looper. Playback progress and state are
 * cached in @Volatile fields (updated on the main thread) so the Swift poller can
 * read them without blocking or thread-hopping.
 */
object PorizoNativeAudioBridge {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var appContext: Context? = null

    @Volatile private var cachedPositionMs: Long = 0L
    @Volatile private var cachedDurationMs: Long = 0L
    @Volatile private var cachedIsPlaying: Boolean = false
    @Volatile private var lastStatus: String = "Audio idle."

    private val progressTicker = object : Runnable {
        override fun run() {
            val p = player
            if (p != null) {
                cachedPositionMs = maxOf(0L, p.currentPosition)
                val dur = p.duration
                cachedDurationMs = if (dur > 0) dur else 0L
                cachedIsPlaying = p.isPlaying
                if (p.isPlaying) {
                    mainHandler.postDelayed(this, 250)
                }
            }
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun ensurePlayer(context: Context): ExoPlayer {
        val existing = player
        if (existing != null) return existing
        val created = ExoPlayer.Builder(context.applicationContext).build()
        created.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                cachedIsPlaying = isPlaying
                if (isPlaying) {
                    mainHandler.removeCallbacks(progressTicker)
                    mainHandler.post(progressTicker)
                }
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) {
                    val dur = created.duration
                    cachedDurationMs = if (dur > 0) dur else 0L
                }
            }
        })
        player = created
        return created
    }

    /**
     * Prepare a stream. headersJson is a JSON object of HTTP header name→value
     * (empty object for pre-signed URLs). Returns "OK" or "ERROR|<reason>".
     */
    fun prepare(context: Context, url: String, headersJson: String): String {
        appContext = context.applicationContext
        val headers = parseHeaders(headersJson)
        var result = "OK"
        runOnMain {
            try {
                val p = ensurePlayer(context)
                val factory = DefaultHttpDataSource.Factory()
                if (headers.isNotEmpty()) {
                    factory.setDefaultRequestProperties(headers)
                }
                val source = ProgressiveMediaSource.Factory(factory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(url)))
                p.setMediaSource(source)
                p.prepare()
                cachedPositionMs = 0L
                cachedDurationMs = 0L
                lastStatus = "Prepared."
            } catch (e: Exception) {
                result = "ERROR|${e.message ?: "prepare failed"}"
                lastStatus = result
            }
        }
        return result
    }

    fun play(): String {
        runOnMain {
            player?.play()
            lastStatus = "Playing."
        }
        return "OK"
    }

    fun pause(): String {
        runOnMain {
            player?.pause()
            lastStatus = "Paused."
        }
        return "OK"
    }

    fun seek(positionMs: Long): String {
        runOnMain {
            player?.seekTo(maxOf(0L, positionMs))
            cachedPositionMs = maxOf(0L, positionMs)
        }
        return "OK"
    }

    fun release(): String {
        runOnMain {
            mainHandler.removeCallbacks(progressTicker)
            player?.release()
            player = null
            cachedPositionMs = 0L
            cachedDurationMs = 0L
            cachedIsPlaying = false
            lastStatus = "Released."
        }
        return "OK"
    }

    fun currentPositionMs(): Long = cachedPositionMs
    fun durationMs(): Long = cachedDurationMs
    fun isPlaying(): Boolean = cachedIsPlaying
    fun status(): String = lastStatus

    private fun parseHeaders(headersJson: String): Map<String, String> {
        if (headersJson.isBlank()) return emptyMap()
        return try {
            val obj = JSONObject(headersJson)
            val map = HashMap<String, String>()
            val keys = obj.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                map[key] = obj.getString(key)
            }
            map
        } catch (_: Exception) {
            emptyMap()
        }
    }
}
