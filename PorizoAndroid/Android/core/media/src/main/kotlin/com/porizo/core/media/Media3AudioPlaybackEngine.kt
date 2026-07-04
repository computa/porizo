package com.porizo.core.media

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

@androidx.annotation.OptIn(UnstableApi::class)
class Media3AudioPlaybackEngine(
    private val context: Context,
) : AudioPlaybackEngine {
    private var player: ExoPlayer? = null

    override fun prepare(url: String, headers: Map<String, String>): Result<Unit> =
        runCatching {
            release()
            val dataSourceFactory = DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(headers)
            val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
            val exoPlayer = ExoPlayer.Builder(context.applicationContext)
                .setMediaSourceFactory(mediaSourceFactory)
                .build()

            exoPlayer.setMediaItem(MediaItem.fromUri(url))
            exoPlayer.prepare()
            player = exoPlayer
        }

    override fun play() {
        player?.play()
    }

    override fun pause() {
        player?.pause()
    }

    override fun seekTo(positionMs: Long) {
        player?.seekTo(positionMs.coerceAtLeast(0L))
    }

    override fun release() {
        player?.release()
        player = null
    }

    override fun currentPositionMs(): Long =
        player?.currentPosition ?: 0L

    override fun durationMs(): Long =
        player?.duration?.takeIf { it > 0 } ?: 0L

    override fun isPlaying(): Boolean =
        player?.isPlaying == true
}
