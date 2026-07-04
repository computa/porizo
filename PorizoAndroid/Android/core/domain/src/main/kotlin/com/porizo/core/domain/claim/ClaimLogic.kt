package com.porizo.core.domain.claim

import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.ShareInfo

object ClaimLogic {
    sealed interface State {
        data class Claimable(val needsPin: Boolean) : State
        data object Claimed : State
        data object Unavailable : State
    }

    fun stateFor(info: ShareInfo): State =
        when (info.status) {
            "unbound" -> State.Claimable(needsPin = info.pinRequiredForClaim ?: false)
            "claimed" -> State.Claimed
            else -> State.Unavailable
        }

    fun previewUrl(info: ShareInfo): String? =
        info.webStreamUrl?.takeIf { it.isNotBlank() }

    fun shouldReregisterAndRetry(error: Throwable): Boolean {
        val server = error as? PorizoFailure.Server ?: return false
        if (server.status != 401) return false
        return when (server.code.orEmpty().uppercase()) {
            "INVALID_DEVICE_TOKEN", "SIGN_IN_REQUIRED" -> true
            else -> false
        }
    }
}
