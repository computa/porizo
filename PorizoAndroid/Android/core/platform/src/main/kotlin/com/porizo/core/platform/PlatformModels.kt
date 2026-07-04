package com.porizo.core.platform

sealed interface PlatformResult<out T> {
    data class Success<T>(val value: T) : PlatformResult<T>
    data class Failure(val message: String) : PlatformResult<Nothing>
}

data class GoogleSignInToken(
    val idToken: String,
)

data class PlayProductSummary(
    val id: String,
    val productType: String,
    val title: String,
    val price: String,
)

data class NativeRecording(
    val path: String,
    val durationSec: Double,
    val bytes: Long,
    val checksum: String?,
)

sealed interface PushRoute {
    data class TrackReveal(val trackId: String) : PushRoute
    data object Informational : PushRoute
}
