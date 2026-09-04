package com.porizo.core.media

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.media3.session.MediaSession

/**
 * Publishes a [MediaSession] to the lock-screen / notification transport and
 * retracts it again. This isolates the foreground-service orchestration from the
 * playback engine, which is only responsible for ExoPlayer adaptation.
 */
internal interface MediaSessionPublisher {
    /** Registers [session] in the holder and starts [PorizoMediaService]. */
    fun publish(session: MediaSession)

    /** Retracts [session] from the holder (owner-scoped). */
    fun retract(session: MediaSession)
}

/**
 * Default [MediaSessionPublisher] backed by the process-scoped
 * [MediaSessionHolder] and the [PorizoMediaService] foreground service.
 *
 * Background-start restrictions can make [Context.startService] throw; the
 * failure is swallowed (so audio still plays) but logged so the swallow is
 * observable.
 */
internal class AndroidMediaSessionPublisher(
    context: Context,
) : MediaSessionPublisher {
    private val appContext: Context = context.applicationContext

    override fun publish(session: MediaSession) {
        MediaSessionHolder.register(session)
        runCatching {
            appContext.startService(Intent(appContext, PorizoMediaService::class.java))
        }.onFailure { error ->
            Log.w(TAG, "Failed to start PorizoMediaService; lock-screen controls unavailable", error)
        }
    }

    override fun retract(session: MediaSession) {
        MediaSessionHolder.clear(session)
    }

    private companion object {
        const val TAG = "MediaSessionPublisher"
    }
}
