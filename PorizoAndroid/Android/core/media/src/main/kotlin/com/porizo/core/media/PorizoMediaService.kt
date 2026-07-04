package com.porizo.core.media

import android.content.Intent
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Foreground media service that publishes the lock-screen / notification
 * transport controls. The framework instantiates this itself, so it never
 * constructs an ExoPlayer or a MediaSession — it only surfaces the session the
 * engine registered in [MediaSessionHolder].
 */
@UnstableApi
class PorizoMediaService : MediaSessionService() {
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        MediaSessionHolder.current()

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Standard Media3 idle-stop check: when the app task is swiped away and
        // nothing is actively queued to play, tear the service down.
        val session = MediaSessionHolder.current()
        if (session == null || !session.player.playWhenReady || session.player.mediaItemCount == 0) {
            stopSelf()
        }
        super.onTaskRemoved(rootIntent)
    }
}
