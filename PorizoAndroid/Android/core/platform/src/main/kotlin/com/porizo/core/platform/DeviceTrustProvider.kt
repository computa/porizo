package com.porizo.core.platform

import android.content.Context
import com.porizo.core.domain.platform.DeviceTrustGateway
import com.porizo.core.domain.platform.DeviceTrustSnapshot
import com.google.android.gms.appset.AppSet
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Singleton
class DeviceTrustProvider @Inject constructor(
    @ApplicationContext private val context: Context,
) : DeviceTrustGateway {
    override suspend fun snapshot(requestHash: String?): DeviceTrustSnapshot {
        if (requestHash.isNullOrBlank()) {
            return DeviceTrustSnapshot(
                appSetId = null,
                integrityToken = null,
                status = "Device trust requires a backend request hash.",
            )
        }

        val appSetIdResult = runCatching {
            AppSet.getClient(context).appSetIdInfo.awaitTask().id
        }
        val tokenResult = runCatching {
            IntegrityManagerFactory.create(context)
                .requestIntegrityToken(
                    IntegrityTokenRequest.builder()
                        .setNonce(requestHash)
                        .build(),
                )
                .awaitTask()
                .token()
        }
        val token = tokenResult.getOrNull()?.takeIf { it.isNotBlank() }
        return DeviceTrustSnapshot(
            appSetId = appSetIdResult.getOrNull(),
            integrityToken = token,
            status = when {
                token != null && appSetIdResult.isSuccess -> "Play Integrity token ready."
                token != null -> "Play Integrity token ready; App Set ID unavailable: ${appSetIdResult.failureMessage()}."
                else -> "Play Integrity token unavailable: ${tokenResult.failureMessage()}."
            },
        )
    }

    private suspend fun <T> Task<T>.awaitTask(): T =
        suspendCancellableCoroutine { continuation ->
            addOnSuccessListener { value ->
                if (continuation.isActive) continuation.resume(value)
            }
            addOnFailureListener { error ->
                if (continuation.isActive) continuation.resumeWithException(error)
            }
            addOnCanceledListener {
                continuation.cancel()
            }
        }

    private fun Result<*>.failureMessage(): String =
        exceptionOrNull()?.message?.takeIf { it.isNotBlank() }
            ?: "not available"
}
