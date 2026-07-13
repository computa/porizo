package com.porizo.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.auth.AuthLogic
import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.PendingMagicLoginStore
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.MagicLoginTransactionStatus
import com.porizo.core.model.PendingMagicLogin
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
    private val pendingMagicLoginStore: PendingMagicLoginStore,
) : ViewModel() {
    private var countdownJob: Job? = null
    private var statusJob: Job? = null
    private var magicActionJob: Job? = null
    private var magicRequestJob: Job? = null
    private var restoreJob: Job? = null
    private val _uiState = MutableStateFlow(
        AuthUiState(isGoogleSignInConfigured = googleAuthConfig.webClientId.isNotBlank()),
    )
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        restore()
    }

    fun restore() {
        if (restoreJob?.isActive == true) return
        restoreJob = viewModelScope.launch {
            val session = runCatching { authRepository.restoreSession() }.getOrNull()
            val userId = session?.userId?.takeIf { userId -> userId.isNotBlank() }
            val pushWarningMessage = userId?.let(::syncPushIdentity)
            if (userId != null) {
                pendingMagicLoginStore.getPending()?.let { pendingMagicLoginStore.remove(it.transactionId) }
                _uiState.update {
                    it.copy(
                        phase = AuthPhase.Authenticated(userId),
                        errorMessage = null,
                        pushWarningMessage = pushWarningMessage,
                    )
                }
                return@launch
            }

            val pending = pendingMagicLoginStore.getPending()
            val requestSecret = pending?.let { pendingMagicLoginStore.getRequestSecret(it.transactionId) }
            when {
                pending == null -> _uiState.update {
                    it.copy(phase = AuthPhase.SignedOut, errorMessage = null, pushWarningMessage = null)
                }
                requestSecret == null -> _uiState.update {
                    it.copy(phase = AuthPhase.MagicLinkWrongDevice, errorMessage = null, pushWarningMessage = null)
                }
                else -> {
                    showPending(pending)
                    refreshMagicLoginStatus(waitForRestore = false)
                }
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

    fun beginMagicLogin() {
        _uiState.update { it.copy(phase = AuthPhase.MagicEmailEntry, errorMessage = null) }
    }

    fun updateEmail(value: String) {
        _uiState.update { it.copy(email = value) }
    }

    fun sendMagicLink() {
        val email = uiState.value.email.trim().lowercase()
        if (!uiState.value.canSendMagicLink) return
        requestMagicLink(email)
    }

    fun resendMagicLink() {
        val phase = uiState.value.phase as? AuthPhase.MagicLinkSent ?: return
        if (phase.resendSecondsRemaining > 0 || uiState.value.isWorking) return
        requestMagicLink(phase.email)
    }

    fun changeMagicLoginEmail() {
        pendingMagicLoginStore.getPending()?.let { pendingMagicLoginStore.remove(it.transactionId) }
        countdownJob?.cancel()
        statusJob?.cancel()
        _uiState.update {
            it.copy(
                phase = AuthPhase.MagicEmailEntry,
                email = "",
                isCheckingMagicLink = false,
                errorMessage = null,
            )
        }
    }

    private fun requestMagicLink(email: String) {
        if (magicRequestJob?.isActive == true || magicActionJob?.isActive == true) return
        magicRequestJob = viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true, errorMessage = null, pushWarningMessage = null) }
            try {
                val result = authRepository.requestMagicLogin(email, "login", UUID.randomUUID().toString())
                val oldTransactionId = pendingMagicLoginStore.getPending()?.transactionId
                val pending = PendingMagicLogin(
                    transactionId = result.transactionId,
                    email = email,
                    expiresAt = result.expiresAt,
                    resendAvailableAtEpochSeconds = Instant.now().epochSecond + RESEND_COOLDOWN_SECONDS,
                )
                pendingMagicLoginStore.save(pending, result.requestSecret)
                oldTransactionId?.takeIf { it != result.transactionId }?.let(pendingMagicLoginStore::remove)
                showPending(pending)
            } catch (error: Throwable) {
                _uiState.update { it.copy(errorMessage = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isWorking = false) }
            }
        }
    }

    fun consumeMagicLink(route: DeepLinkRoute.AndroidMagicLogin) {
        statusJob?.cancel()
        runMagicLoginAction {
            restoreJob?.join()
            if (uiState.value.isAuthenticated) return@runMagicLoginAction
            val requestSecret = pendingMagicLoginStore.getRequestSecret(route.transactionId)
            if (requestSecret == null) {
                _uiState.update {
                    it.copy(phase = AuthPhase.MagicLinkWrongDevice, errorMessage = null, isCheckingMagicLink = false)
                }
                return@runMagicLoginAction
            }
            _uiState.update { it.copy(phase = AuthPhase.MagicLinkExchanging) }
            val session = authRepository.exchangeMagicLogin(route.transactionId, route.linkSecret, requestSecret)
            pendingMagicLoginStore.remove(route.transactionId)
            setAuthenticated(session.userId)
        }
    }

    fun resumeMagicLogin(route: DeepLinkRoute.MagicLoginResume) {
        refreshMagicLoginStatus(route.transactionId)
    }

    fun refreshMagicLoginStatus(transactionId: String? = null) =
        refreshMagicLoginStatus(transactionId, waitForRestore = true)

    private fun refreshMagicLoginStatus(
        transactionId: String? = null,
        waitForRestore: Boolean,
    ) {
        if (uiState.value.isAuthenticated || magicActionJob?.isActive == true) return
        if (statusJob?.isActive == true) {
            if (transactionId == null) return
            statusJob?.cancel()
        }
        statusJob = viewModelScope.launch {
            if (waitForRestore) restoreJob?.join()
            if (uiState.value.isAuthenticated) return@launch
            val pending = pendingMagicLoginStore.getPending() ?: return@launch
            if (transactionId != null && transactionId != pending.transactionId) {
                _uiState.update { it.copy(phase = AuthPhase.MagicLinkWrongDevice, errorMessage = null) }
                return@launch
            }
            val requestSecret = pendingMagicLoginStore.getRequestSecret(pending.transactionId)
            if (requestSecret == null) {
                _uiState.update { it.copy(phase = AuthPhase.MagicLinkWrongDevice, errorMessage = null) }
                return@launch
            }
            _uiState.update { it.copy(isCheckingMagicLink = true, errorMessage = null) }
            try {
                val status = authRepository.getMagicLoginStatus(pending.transactionId, requestSecret)
                if (pendingMagicLoginStore.getPending()?.transactionId != pending.transactionId) {
                    return@launch
                }
                when (status.status) {
                    MagicLoginTransactionStatus.Pending -> showPending(pending.copy(expiresAt = status.expiresAt))
                    MagicLoginTransactionStatus.Approved,
                    MagicLoginTransactionStatus.Consumed,
                    -> completeApprovedMagicLogin(pending, requestSecret)
                    MagicLoginTransactionStatus.Expired -> expirePending(pending)
                    MagicLoginTransactionStatus.Locked -> {
                        pendingMagicLoginStore.remove(pending.transactionId)
                        _uiState.update { it.copy(phase = AuthPhase.MagicLinkLocked(pending.email)) }
                    }
                    MagicLoginTransactionStatus.Conflict -> {
                        pendingMagicLoginStore.remove(pending.transactionId)
                        _uiState.update { it.copy(phase = AuthPhase.MagicLinkConflict(pending.email)) }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                handleMagicLoginFailure(error, pending)
            } finally {
                _uiState.update { it.copy(isCheckingMagicLink = false) }
            }
        }
    }

    private suspend fun completeApprovedMagicLogin(pending: PendingMagicLogin, requestSecret: String) {
        _uiState.update { it.copy(phase = AuthPhase.MagicLinkExchanging) }
        val session = authRepository.completeMagicLogin(pending.transactionId, requestSecret)
        pendingMagicLoginStore.remove(pending.transactionId)
        setAuthenticated(session.userId)
    }

    private fun expirePending(pending: PendingMagicLogin) {
        pendingMagicLoginStore.remove(pending.transactionId)
        countdownJob?.cancel()
        _uiState.update { it.copy(phase = AuthPhase.MagicLinkExpired(pending.email), errorMessage = null) }
    }

    private fun showPending(pending: PendingMagicLogin) {
        val secondsRemaining = (pending.resendAvailableAtEpochSeconds - Instant.now().epochSecond)
            .coerceAtLeast(0)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        _uiState.update {
            it.copy(
                phase = AuthPhase.MagicLinkSent(pending.email, secondsRemaining),
                email = pending.email,
                errorMessage = null,
            )
        }
        startCountdown()
    }

    private fun startCountdown() {
        countdownJob?.cancel()
        countdownJob = viewModelScope.launch {
            while (true) {
                val phase = uiState.value.phase as? AuthPhase.MagicLinkSent ?: break
                if (phase.resendSecondsRemaining <= 0) break
                delay(1_000)
                _uiState.update { state ->
                    val current = state.phase as? AuthPhase.MagicLinkSent ?: return@update state
                    state.copy(phase = current.copy(resendSecondsRemaining = current.resendSecondsRemaining - 1))
                }
            }
        }
    }

    private fun runMagicLoginAction(action: suspend () -> Unit) {
        if (magicActionJob?.isActive == true) return
        magicActionJob = viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true, errorMessage = null) }
            try {
                action()
            } catch (error: Throwable) {
                val pending = pendingMagicLoginStore.getPending()
                if (pending != null) handleMagicLoginFailure(error, pending)
                else _uiState.update { it.copy(errorMessage = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isWorking = false) }
            }
        }
    }

    private fun handleMagicLoginFailure(error: Throwable, pending: PendingMagicLogin) {
        val code = (error as? PorizoFailure.Server)?.code.orEmpty().uppercase()
        when {
            "EXPIRED" in code -> expirePending(pending)
            "LOCKED" in code -> {
                pendingMagicLoginStore.remove(pending.transactionId)
                countdownJob?.cancel()
                _uiState.update { it.copy(phase = AuthPhase.MagicLinkLocked(pending.email)) }
            }
            "LEGACY_ACCOUNT_RECOVERY_REQUIRED" in code -> {
                pendingMagicLoginStore.remove(pending.transactionId)
                countdownJob?.cancel()
                val details = (error as? PorizoFailure.Server)?.details
                _uiState.update {
                    it.copy(
                        phase = AuthPhase.MagicLinkLegacyRecovery(
                            email = pending.email,
                            maskedEmail = details?.maskedEmail,
                            authMethods = details?.authMethods.orEmpty(),
                        ),
                    )
                }
            }
            "CONFLICT" in code -> {
                pendingMagicLoginStore.remove(pending.transactionId)
                countdownJob?.cancel()
                _uiState.update { it.copy(phase = AuthPhase.MagicLinkConflict(pending.email)) }
            }
            else -> {
                showPending(pending)
                _uiState.update {
                    it.copy(errorMessage = "We couldn't check the sign-in link. Check your connection and try again.")
                }
            }
        }
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
        pendingMagicLoginStore.getPending()?.let { pendingMagicLoginStore.remove(it.transactionId) }
        countdownJob?.cancel()
        statusJob?.cancel()
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

    private companion object {
        const val RESEND_COOLDOWN_SECONDS = 60L
    }

    private fun Throwable.userMessage(): String =
        when (this) {
            is PorizoFailure -> message ?: "Something went wrong."
            else -> message ?: "Something went wrong."
        }
}
