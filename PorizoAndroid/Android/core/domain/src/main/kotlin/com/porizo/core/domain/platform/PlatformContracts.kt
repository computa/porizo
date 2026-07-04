package com.porizo.core.domain.platform

sealed interface PlatformResult<out T> {
    data class Success<T>(val value: T) : PlatformResult<T>
    data class Failure(val message: String) : PlatformResult<Nothing>
}

data class GoogleSignInToken(
    val idToken: String,
)

interface GoogleSignInGateway {
    suspend fun signIn(webClientId: String): PlatformResult<GoogleSignInToken>
}

data class PlayProductSummary(
    val id: String,
    val productType: String,
    val title: String,
    val price: String,
)

interface PlayBillingGateway {
    fun queryProducts(subscriptionIds: List<String>, oneTimeIds: List<String>): String
    fun launchPurchase(productId: String, obfuscatedAccountId: String?): String
    fun queryActivePurchases(): String
    fun lastPurchaseToken(productId: String): String?
    fun loadedProducts(): List<PlayProductSummary>
    fun status(): String
}

interface PushGateway {
    fun initialize(appId: String, verbose: Boolean): String
    fun login(userId: String): String
    fun logout(): String
    fun optIn(): String
    fun requestNotificationPermission(): String
    fun pushToken(): String?
    fun subscriptionId(): String?
}

sealed interface PushRoute {
    data class TrackReveal(val trackId: String) : PushRoute
    data object Informational : PushRoute
}

interface PushRouteStore {
    fun consume(): PushRoute?
}

data class NativeRecording(
    val path: String,
    val durationSec: Double,
    val bytes: Long,
    val checksum: String?,
)

interface VoiceRecorder {
    fun hasMicrophonePermission(): Boolean
    fun requestMicrophonePermission(): String
    fun startRecording(): PlatformResult<String>
    fun stopRecording(): PlatformResult<NativeRecording>
    fun readBytes(recording: NativeRecording): ByteArray?
    fun delete(recording: NativeRecording): String
    fun status(): String
}
