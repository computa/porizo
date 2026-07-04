package com.porizo.core.domain.auth

import com.porizo.core.model.VerifyPhoneCodeResult

object AuthLogic {
    enum class RefreshDisposition {
        HardLogout,
        RecheckCachedToken,
        RetryTransient,
    }

    sealed interface PhoneVerifyOutcome {
        data class Authenticated(
            val userId: String,
            val accessToken: String,
            val refreshToken: String,
        ) : PhoneVerifyOutcome

        data class NeedsRegistration(val registrationToken: String) : PhoneVerifyOutcome
        data class Rejected(val remainingAttempts: Int?) : PhoneVerifyOutcome
    }

    private val definitiveCodes = setOf(
        "token_reuse_detected",
        "token_revoked",
        "token_expired",
        "invalid_token",
        "invalid_refresh_token",
        "token_family_compromised",
        "session_revoked",
        "session_expired",
    )

    fun classifyRefreshError(code: String?): RefreshDisposition {
        val normalized = code.orEmpty().lowercase()
        return when {
            normalized == "token_already_rotated" -> RefreshDisposition.RecheckCachedToken
            normalized in definitiveCodes -> RefreshDisposition.HardLogout
            else -> RefreshDisposition.RetryTransient
        }
    }

    fun shouldProactivelyRefresh(secondsUntilExpiry: Int): Boolean =
        secondsUntilExpiry < 300

    fun phoneVerifyOutcome(response: VerifyPhoneCodeResult): PhoneVerifyOutcome {
        val userId = response.userId
        val access = response.accessToken
        val refresh = response.refreshToken
        if (userId != null && access != null && refresh != null) {
            return PhoneVerifyOutcome.Authenticated(userId, access, refresh)
        }
        val registrationToken = response.registrationToken
        if (registrationToken != null) {
            return PhoneVerifyOutcome.NeedsRegistration(registrationToken)
        }
        return PhoneVerifyOutcome.Rejected(response.remainingAttempts)
    }
}
