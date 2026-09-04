package com.porizo.core.media

import androidx.media3.session.MediaSession

/**
 * Process-scoped bridge between the [Media3AudioPlaybackEngine] (which owns the
 * ExoPlayer + MediaSession) and [PorizoMediaService] (which the framework
 * instantiates itself, with no handle to the engine).
 *
 * The engine registers its session here after building it; the service reads it
 * back in [PorizoMediaService.onGetSession]. This is the only shared mutable
 * state — it holds no player logic.
 *
 * Invariant: the slot holds the currently valid session, or null. There is a
 * single logical writer (the active engine); [register] replaces the slot so the
 * last registration wins, and [clear] is owner-scoped — it only nulls the slot
 * when the caller still owns the live session. This prevents an out-of-order
 * teardown of a superseded engine from wiping a newer engine's live session
 * (ABA / stale-owner wipe).
 */
object MediaSessionHolder {
    @Volatile
    private var session: MediaSession? = null

    /** Publishes [session] as the active one; the last registration wins. */
    fun register(session: MediaSession) {
        synchronized(this) {
            this.session = session
        }
    }

    /**
     * Retracts [session] only if it is still the active one. A stale owner
     * calling this after a newer session was registered is a no-op, so it can
     * never wipe the live session out from under the running service.
     */
    fun clear(session: MediaSession) {
        synchronized(this) {
            if (this.session === session) this.session = null
        }
    }

    /**
     * The active session, or null when no engine has registered one (before the
     * first [register] or after the owning engine has [clear]ed it).
     */
    fun current(): MediaSession? = session
}
