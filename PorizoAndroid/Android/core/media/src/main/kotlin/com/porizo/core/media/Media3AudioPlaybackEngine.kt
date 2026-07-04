package com.porizo.core.media

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession

@androidx.annotation.OptIn(UnstableApi::class)
class Media3AudioPlaybackEngine internal constructor(
    private val context: Context,
    private val sessionPublisher: MediaSessionPublisher,
) : AudioPlaybackEngine {
    constructor(context: Context) : this(context, AndroidMediaSessionPublisher(context))

    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null

    override fun prepare(url: String, headers: Map<String, String>, metadata: PlaybackMetadata): Result<Unit> =
        runCatching {
            release()
            val dataSourceFactory = DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(headers)
            val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)
            val exoPlayer = ExoPlayer.Builder(context.applicationContext)
                .setMediaSourceFactory(mediaSourceFactory)
                .build()

            val mediaMetadata = MediaMetadata.Builder()
                .setTitle(metadata.title)
                .setArtist(metadata.artist)
                .setArtworkUri(metadata.artworkUrl?.let(android.net.Uri::parse))
                .build()
            val mediaItem = MediaItem.Builder()
                .setUri(url)
                .setMediaMetadata(mediaMetadata)
                .build()

            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
            player = exoPlayer
            val session = MediaSession.Builder(context.applicationContext, exoPlayer)
                .build()
            mediaSession = session
            sessionPublisher.publish(session)
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
        mediaSession?.let(sessionPublisher::retract)
        mediaSession?.release()
        mediaSession = null
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
