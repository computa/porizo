package com.porizo.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.auth.AuthLogic
import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.model.PorizoFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val googleAuthConfig: GoogleAuthConfig,
    private val googleSignInGateway: GoogleSignInGateway,
    private val pushGateway: PushGateway,
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        AuthUiState(isGoogleSignInConfigured = googleAuthConfig.webClientId.isNotBlank()),
    )
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        restore()
    }

    fun restore() {
        viewModelScope.launch {
            val session = runCatching { authRepository.restoreSession() }.getOrNull()
            val userId = session?.userId?.takeIf { userId -> userId.isNotBlank() }
            val pushWarningMessage = userId?.let(::syncPushIdentity)
            _uiState.update {
                it.copy(
                    phase = userId
                        ?.let(AuthPhase::Authenticated)
                        ?: AuthPhase.SignedOut,
                    errorMessage = null,
                    pushWarningMessage = pushWarningMessage,
                )
            }
        }
    }

    /// DEBUG-only: flip the UI to an authenticated state so authed-state layouts
    /// (My Songs/My Poems, signed-in Settings rows) can be driven on the emulator
    /// without a full login — the Android analog of iOS `--bypass-auth`. Note this
    /// only changes the auth CHROME; repository calls still need a real backend
    /// token, so list DATA stays empty until a genuine session exists. Callers
    /// must guard with BuildConfig.DEBUG.
    fun debugBypassAuth(userId: String = "debug-user") {
        setAuthenticated(userId)
    }

    fun showOptions() {
        _uiState.update { it.copy(phase = AuthPhase.SignedOut, errorMessage = null, pushWarningMessage = null) }
    }

    fun beginPhone() {
        _uiState.update { it.copy(phase = AuthPhase.PhoneEntry, errorMessage = null, pushWarningMessage = null) }
    }

    fun updatePhoneNumber(value: String) {
        _uiState.update {
            it.copy(
                phoneNumber = value,
                normalizedPhoneNumber = PhoneNumberFormatting.normalizedE164PhoneNumber(value),
            )
        }
    }

    fun updateCode(value: String) {
        _uiState.update { it.copy(code = value) }
    }

    fun sendPhoneCode() {
        val phone = uiState.value.normalizedPhoneNumber ?: return
        runAuthAction {
            authRepository.sendPhoneVerificationCode(phone)
            _uiState.update { it.copy(phase = AuthPhase.PhoneVerify(phone), code = "") }
        }
    }

    fun verifyPhoneCode() {
        val state = uiState.value
        val phase = state.phase as? AuthPhase.PhoneVerify ?: return
        val code = state.code.trim()
        if (code.isEmpty()) return

        runAuthAction {
            val result = authRepository.verifyPhoneCode(phase.phoneNumber, code)
            when (val outcome = AuthLogic.phoneVerifyOutcome(result)) {
                is AuthLogic.PhoneVerifyOutcome.Authenticated ->
                    setAuthenticated(outcome.userId) { it.copy(code = "") }
                is AuthLogic.PhoneVerifyOutcome.NeedsRegistration ->
                    _uiState.update {
                        it.copy(
                            phase = AuthPhase.ProfileCompletion(outcome.registrationToken, phase.phoneNumber),
                            code = "",
                        )
                    }
                is AuthLogic.PhoneVerifyOutcome.Rejected ->
                    _uiState.update {
                        val suffix = outcome.remainingAttempts?.let { attempts -> " ($attempts attempts left)" }.orEmpty()
                        it.copy(errorMessage = "That code did not match.$suffix")
                    }
            }
        }
    }

    fun completeRegistration() {
        val phase = uiState.value.phase as? AuthPhase.ProfileCompletion ?: return
        runAuthAction {
            val result = authRepository.registerPhoneAccount(
                registrationToken = phase.registrationToken,
                phoneNumber = phase.phoneNumber,
            )
            val userId = result.userId ?: throw PorizoFailure.Unknown("Phone registration did not return an account.")
            setAuthenticated(userId)
        }
    }

    fun signInWithGoogle() {
        if (googleAuthConfig.webClientId.isBlank()) {
            _uiState.update {
                it.copy(errorMessage = GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE)
            }
            return
        }
        runAuthAction {
            val challenge = authRepository.createSocialAuthChallenge("google")
            when (val token = googleSignInGateway.signIn(googleAuthConfig.webClientId, challenge.nonce)) {
                is PlatformResult.Failure -> throw PorizoFailure.Unknown(token.message)
                is PlatformResult.Success -> submitGoogleToken(
                    idToken = token.value.idToken,
                    confirmLink = false,
                    challenge = challenge,
                )
            }
        }
    }

    fun confirmGoogleLink(idToken: String) {
        val challenge = (uiState.value.phase as? AuthPhase.LinkConfirmation)?.challenge
        runAuthAction {
            submitGoogleToken(idToken, confirmLink = true, challenge = challenge)
        }
    }

    fun logout() {
        runAuthAction {
            authRepository.logout()
            val pushWarningMessage = syncPushLogout()
            _uiState.update { initialState().copy(pushWarningMessage = pushWarningMessage) }
        }
    }

    private suspend fun submitGoogleToken(
        idToken: String,
        confirmLink: Boolean,
        challenge: com.porizo.core.model.SocialAuthChallenge?,
    ) {
        val result = authRepository.socialLogin(
            provider = "google",
            idToken = idToken,
            name = null,
            confirmLink = confirmLink,
            challenge = challenge,
        )
        if (result.requiresLinkConfirmation == true) {
            _uiState.update {
                it.copy(
                    phase = AuthPhase.LinkConfirmation(
                        idToken = idToken,
                        email = result.existingAccountEmail,
                        challenge = challenge,
                    ),
                )
            }
            return
        }

        val userId = result.userId
            ?: throw PorizoFailure.Unknown("Google sign-in did not return an account.")
        setAuthenticated(userId)
    }

    private fun runAuthAction(action: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true, errorMessage = null, pushWarningMessage = null) }
            try {
                action()
            } catch (error: Throwable) {
                _uiState.update { it.copy(errorMessage = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isWorking = false) }
            }
        }
    }

    private fun setAuthenticated(
        userId: String,
        transform: (AuthUiState) -> AuthUiState = { it },
    ) {
        val pushWarningMessage = syncPushIdentity(userId)
        _uiState.update { state ->
            transform(state).copy(
                phase = AuthPhase.Authenticated(userId),
                pushWarningMessage = pushWarningMessage,
            )
        }
    }

    private fun syncPushIdentity(userId: String): String? =
        pushWarningFrom(
            runCatching { pushGateway.login(userId) }
                .getOrElse { error -> "Push identity sync failed: ${error.userMessage()}" },
        )

    private fun syncPushLogout(): String? =
        pushWarningFrom(
            runCatching { pushGateway.logout() }
                .getOrElse { error -> "Push identity cleanup failed: ${error.userMessage()}" },
        )

    private fun pushWarningFrom(message: String): String? =
        message.takeIf {
            it.contains("failed", ignoreCase = true) ||
                it.contains("not configured", ignoreCase = true) ||
                it.contains("not initialized", ignoreCase = true)
        }

    private fun initialState(): AuthUiState =
        AuthUiState(isGoogleSignInConfigured = googleAuthConfig.webClientId.isNotBlank())

    private fun Throwable.userMessage(): String =
        when (this) {
            is PorizoFailure -> message ?: "Something went wrong."
            else -> message ?: "Something went wrong."
        }
}
