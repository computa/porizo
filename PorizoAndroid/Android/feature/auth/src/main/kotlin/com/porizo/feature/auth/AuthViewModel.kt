package com.porizo.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.auth.AuthLogic
import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.PlatformResult
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
) : ViewModel() {
    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        restore()
    }

    fun restore() {
        viewModelScope.launch {
            val session = runCatching { authRepository.restoreSession() }.getOrNull()
            _uiState.update {
                it.copy(
                    phase = session?.userId?.takeIf { userId -> userId.isNotBlank() }
                        ?.let(AuthPhase::Authenticated)
                        ?: AuthPhase.SignedOut,
                    errorMessage = null,
                )
            }
        }
    }

    fun showOptions() {
        _uiState.update { it.copy(phase = AuthPhase.SignedOut, errorMessage = null) }
    }

    fun beginPhone() {
        _uiState.update { it.copy(phase = AuthPhase.PhoneEntry, errorMessage = null) }
    }

    fun updatePhoneNumber(value: String) {
        _uiState.update { it.copy(phoneNumber = value) }
    }

    fun updateCode(value: String) {
        _uiState.update { it.copy(code = value) }
    }

    fun sendPhoneCode() {
        val phone = uiState.value.phoneNumber.trim()
        if (phone.isEmpty()) return
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
                    _uiState.update { it.copy(phase = AuthPhase.Authenticated(outcome.userId), code = "") }
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
            _uiState.update { it.copy(phase = AuthPhase.Authenticated(userId)) }
        }
    }

    fun signInWithGoogle() {
        runAuthAction {
            when (val token = googleSignInGateway.signIn(googleAuthConfig.webClientId)) {
                is PlatformResult.Failure -> throw PorizoFailure.Unknown(token.message)
                is PlatformResult.Success -> submitGoogleToken(token.value.idToken, confirmLink = false)
            }
        }
    }

    fun confirmGoogleLink(idToken: String) {
        runAuthAction {
            submitGoogleToken(idToken, confirmLink = true)
        }
    }

    fun logout() {
        runAuthAction {
            authRepository.logout()
            _uiState.update { AuthUiState() }
        }
    }

    private suspend fun submitGoogleToken(idToken: String, confirmLink: Boolean) {
        val result = authRepository.socialLogin(
            provider = "google",
            idToken = idToken,
            name = null,
            confirmLink = confirmLink,
        )
        if (result.requiresLinkConfirmation == true) {
            _uiState.update {
                it.copy(
                    phase = AuthPhase.LinkConfirmation(
                        idToken = idToken,
                        email = result.existingAccountEmail,
                    ),
                )
            }
            return
        }

        val userId = result.userId
            ?: throw PorizoFailure.Unknown("Google sign-in did not return an account.")
        _uiState.update { it.copy(phase = AuthPhase.Authenticated(userId)) }
    }

    private fun runAuthAction(action: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true, errorMessage = null) }
            try {
                action()
            } catch (error: Throwable) {
                _uiState.update { it.copy(errorMessage = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isWorking = false) }
            }
        }
    }

    private fun Throwable.userMessage(): String =
        when (this) {
            is PorizoFailure -> message ?: "Something went wrong."
            else -> message ?: "Something went wrong."
        }
}
