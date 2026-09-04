package com.porizo.feature.auth

import com.porizo.core.model.SocialAuthChallenge

sealed interface AuthPhase {
    data object SignedOut : AuthPhase
    data object PhoneEntry : AuthPhase
    data object MagicEmailEntry : AuthPhase
    data class MagicLinkSent(val email: String, val resendSecondsRemaining: Int) : AuthPhase
    data object MagicLinkExchanging : AuthPhase
    data class MagicLinkExpired(val email: String) : AuthPhase
    data object MagicLinkWrongDevice : AuthPhase
    data class MagicLinkConflict(val email: String) : AuthPhase
    data class MagicLinkLegacyRecovery(
        val email: String,
        val maskedEmail: String?,
        val authMethods: List<String>,
    ) : AuthPhase
    data class MagicLinkLocked(val email: String) : AuthPhase
    data class PhoneVerify(val phoneNumber: String) : AuthPhase
    data class ProfileCompletion(val registrationToken: String, val phoneNumber: String) : AuthPhase
    data class LinkConfirmation(
        val idToken: String,
        val email: String?,
        val challenge: SocialAuthChallenge?,
    ) : AuthPhase
    data class Authenticated(val userId: String) : AuthPhase
}

internal const val GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE =
    "Google sign-in is unavailable in this build. Use phone sign-in for now."

data class AuthUiState(
    val phase: AuthPhase = AuthPhase.SignedOut,
    val phoneNumber: String = "",
    val email: String = "",
    val normalizedPhoneNumber: String? = null,
    val code: String = "",
    val isWorking: Boolean = false,
    val isCheckingMagicLink: Boolean = false,
    val isGoogleSignInConfigured: Boolean = false,
    val errorMessage: String? = null,
    val pushWarningMessage: String? = null,
) {
    val isAuthenticated: Boolean
        get() = phase is AuthPhase.Authenticated

    val canSendPhoneCode: Boolean
        get() = normalizedPhoneNumber != null && !isWorking

    val canSendMagicLink: Boolean
        get() = email.trim().matches(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) && !isWorking

    val googleSignInUnavailableMessage: String?
        get() = if (isGoogleSignInConfigured) {
            null
        } else {
            GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE
        }
}
