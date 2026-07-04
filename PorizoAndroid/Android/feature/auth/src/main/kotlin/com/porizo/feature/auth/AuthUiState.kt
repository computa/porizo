package com.porizo.feature.auth

sealed interface AuthPhase {
    data object SignedOut : AuthPhase
    data object PhoneEntry : AuthPhase
    data class PhoneVerify(val phoneNumber: String) : AuthPhase
    data class ProfileCompletion(val registrationToken: String, val phoneNumber: String) : AuthPhase
    data class LinkConfirmation(val idToken: String, val email: String?) : AuthPhase
    data class Authenticated(val userId: String) : AuthPhase
}

data class AuthUiState(
    val phase: AuthPhase = AuthPhase.SignedOut,
    val phoneNumber: String = "",
    val code: String = "",
    val isWorking: Boolean = false,
    val errorMessage: String? = null,
) {
    val isAuthenticated: Boolean
        get() = phase is AuthPhase.Authenticated
}
