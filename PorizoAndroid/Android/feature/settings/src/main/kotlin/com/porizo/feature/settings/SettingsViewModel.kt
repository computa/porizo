package com.porizo.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PlayBillingGateway
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.platform.PushRoute
import com.porizo.core.domain.platform.PushRouteStore
import com.porizo.core.domain.platform.VoiceRecorder
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.BillingRepository
import com.porizo.core.domain.repository.PushRepository
import com.porizo.core.domain.repository.VoiceEnrollmentRepository
import com.porizo.core.model.EnrollmentSession
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.UploadUrl
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val billingRepository: BillingRepository,
    private val pushRepository: PushRepository,
    private val voiceEnrollmentRepository: VoiceEnrollmentRepository,
    private val billingProvider: PlayBillingGateway,
    private val pushProvider: PushGateway,
    private val pushRouteStore: PushRouteStore,
    private val recorderProvider: VoiceRecorder,
    private val config: SettingsPlatformConfig,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private var activeEnrollment: EnrollmentSession? = null
    private var activeUploadUrl: UploadUrl? = null

    fun selectProduct(productId: String) {
        _uiState.update { it.copy(selectedProductId = productId) }
    }

    fun loadBilling() {
        runBilling {
            val entitlements = billingRepository.entitlements()
            val subscriptionStatus = billingRepository.subscriptionStatus()
            val plans = billingRepository.plans()
            val subscriptionIds = plans.flatMap { it.googleSubscriptionProductIds }
                .ifEmpty { config.subscriptionProductIds }
                .distinct()
                .sorted()
            val status = billingProvider.queryProducts(
                subscriptionIds = subscriptionIds,
                oneTimeIds = config.oneTimeProductIds,
            )
            delay(1_200)
            val loadedProducts = billingProvider.loadedProducts()
            val selected = _uiState.value.selectedProductId
                .takeIf { current -> loadedProducts.any { it.id == current } }
                ?: loadedProducts.firstOrNull { it.productType == "subs" }?.id
                ?: subscriptionIds.firstOrNull()
                ?: ""
            _uiState.update {
                it.copy(
                    entitlements = entitlements,
                    subscriptionStatus = subscriptionStatus,
                    plans = plans,
                    loadedProducts = loadedProducts,
                    selectedProductId = selected,
                    billingStatus = billingProvider.status().takeIf { value -> value.isNotBlank() } ?: status,
                )
            }
        }
    }

    fun launchPurchase() {
        val productId = _uiState.value.selectedProductId.trim()
        if (productId.isEmpty()) {
            _uiState.update { it.copy(billingStatus = "Select a product first.") }
            return
        }
        runBilling {
            val userId = authRepository.restoreSession()?.userId?.take(64)
            val status = billingProvider.launchPurchase(productId, userId)
            delay(2_000)
            val token = billingProvider.lastPurchaseToken(productId).orEmpty()
            val previousToken = _uiState.value.purchaseToken
            _uiState.update {
                it.copy(
                    billingStatus = if (token.isBlank()) status else "Purchase token captured. Sync receipt to activate.",
                    purchaseToken = token.ifBlank { previousToken },
                )
            }
        }
    }

    fun refreshPurchases() {
        runBilling {
            val status = billingProvider.queryActivePurchases()
            delay(1_000)
            val productId = _uiState.value.selectedProductId
            val token = billingProvider.lastPurchaseToken(productId).orEmpty()
            val previousToken = _uiState.value.purchaseToken
            _uiState.update {
                it.copy(
                    billingStatus = if (token.isBlank()) billingProvider.status().ifBlank { status } else "Active purchase token loaded.",
                    purchaseToken = token.ifBlank { previousToken },
                    loadedProducts = billingProvider.loadedProducts(),
                )
            }
        }
    }

    fun syncGoogleReceipt() {
        val productId = _uiState.value.selectedProductId.trim()
        val purchaseToken = _uiState.value.purchaseToken.trim()
        if (productId.isEmpty() || purchaseToken.isEmpty()) {
            _uiState.update { it.copy(billingStatus = "A product and purchase token are required.") }
            return
        }
        runBilling {
            val result = billingRepository.submitGoogleReceipt(productId, purchaseToken)
            _uiState.update {
                it.copy(
                    billingStatus = if (result.success) "Google receipt synced." else "Google receipt was not accepted.",
                    entitlements = result.entitlements ?: it.entitlements,
                )
            }
        }
    }

    fun enablePush() {
        runPush {
            val initStatus = pushProvider.initialize(config.oneSignalAppId, verbose = false)
            val session = authRepository.restoreSession()
            val loginStatus = session?.userId
                ?.takeIf { it.isNotBlank() }
                ?.let(pushProvider::login)
                ?: "No signed-in user for OneSignal login."
            val permissionStatus = pushProvider.requestNotificationPermission()
            val optInStatus = pushProvider.optIn()
            delay(1_000)
            val pushToken = pushProvider.pushToken().orEmpty()
            if (pushToken.isNotBlank()) {
                pushRepository.registerPushToken(pushToken)
            }
            _uiState.update {
                it.copy(
                    pushToken = pushToken,
                    pushSubscriptionId = pushProvider.subscriptionId().orEmpty(),
                    pushStatus = listOf(initStatus, loginStatus, permissionStatus, optInStatus)
                        .joinToString(" "),
                )
            }
        }
    }

    fun disablePush() {
        runPush {
            val logoutStatus = pushProvider.logout()
            pushRepository.clearPushToken()
            _uiState.update {
                it.copy(
                    pushToken = "",
                    pushSubscriptionId = "",
                    pushStatus = logoutStatus,
                )
            }
        }
    }

    fun consumePendingPushRoute(): PushRoute? = pushRouteStore.consume()

    fun loadVoiceStatus() {
        runVoice {
            val status = voiceEnrollmentRepository.voiceProfileStatus()
            _uiState.update {
                it.copy(
                    voiceProfileStatus = status,
                    voiceStatus = status.status ?: "Voice profile loaded.",
                )
            }
        }
    }

    fun requestMicrophonePermission() {
        _uiState.update {
            it.copy(voiceStatus = recorderProvider.requestMicrophonePermission())
        }
    }

    fun startEnrollment() {
        runVoice {
            startEnrollmentInternal()
        }
    }

    fun startRecording() {
        runVoice {
            if (activeEnrollment == null || activeUploadUrl == null) {
                startEnrollmentInternal()
            }
            when (val result = recorderProvider.startRecording()) {
                is PlatformResult.Failure -> throw PorizoFailure.Unknown(result.message)
                is PlatformResult.Success -> _uiState.update {
                    it.copy(
                        recordingPath = result.value,
                        voiceStatus = "Recording started.",
                    )
                }
            }
        }
    }

    fun stopAndUploadRecording() {
        runVoice {
            val enrollment = activeEnrollment ?: throw PorizoFailure.Unknown("Start voice enrollment first.")
            val uploadUrl = activeUploadUrl ?: throw PorizoFailure.Unknown("No upload URL is available.")
            val recording = when (val result = recorderProvider.stopRecording()) {
                is PlatformResult.Failure -> throw PorizoFailure.Unknown(result.message)
                is PlatformResult.Success -> result.value
            }
            if (recording.durationSec < MIN_RECORDING_SECONDS) {
                recorderProvider.delete(recording)
                throw PorizoFailure.Unknown("Recording was too short.")
            }
            val bytes = recorderProvider.readBytes(recording)
                ?: throw PorizoFailure.Unknown("Recording file is missing.")
            val chunk = voiceEnrollmentRepository.uploadChunk(
                sessionId = enrollment.sessionId,
                uploadUrl = uploadUrl,
                bytes = bytes,
                contentType = "audio/wav",
                durationSec = recording.durationSec,
                checksum = recording.checksum,
            )
            recorderProvider.delete(recording)
            activeUploadUrl = chunk.nextUploadUrl ?: activeUploadUrl
            _uiState.update {
                it.copy(
                    recordingPath = null,
                    voiceStatus = "Voice sample uploaded.",
                )
            }
        }
    }

    fun createVoiceProfile() {
        runVoice {
            val sessionId = activeEnrollment?.sessionId ?: _uiState.value.activeEnrollmentId
            if (sessionId.isNullOrBlank()) {
                throw PorizoFailure.Unknown("Start voice enrollment first.")
            }
            val profile = voiceEnrollmentRepository.createVoiceProfile(sessionId)
            _uiState.update {
                it.copy(
                    activeEnrollmentId = null,
                    enrollmentPrompt = null,
                    voiceStatus = profile.status,
                )
            }
            activeEnrollment = null
            activeUploadUrl = null
        }
    }

    private suspend fun startEnrollmentInternal() {
        val enrollment = voiceEnrollmentRepository.startEnrollment()
        activeEnrollment = enrollment
        activeUploadUrl = enrollment.uploadUrls?.firstOrNull()
        _uiState.update {
            it.copy(
                activeEnrollmentId = enrollment.sessionId,
                enrollmentPrompt = enrollment.prompts?.firstOrNull()?.text,
                voiceStatus = "Voice enrollment started.",
            )
        }
    }

    private fun runBilling(action: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isBillingWorking = true, billingStatus = "Working...") }
            try {
                action()
            } catch (error: Throwable) {
                _uiState.update { it.copy(billingStatus = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isBillingWorking = false) }
            }
        }
    }

    private fun runPush(action: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isPushWorking = true, pushStatus = "Working...") }
            try {
                action()
            } catch (error: Throwable) {
                _uiState.update { it.copy(pushStatus = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isPushWorking = false) }
            }
        }
    }

    private fun runVoice(action: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isVoiceWorking = true, voiceStatus = "Working...") }
            try {
                action()
            } catch (error: Throwable) {
                _uiState.update { it.copy(voiceStatus = error.userMessage()) }
            } finally {
                _uiState.update { it.copy(isVoiceWorking = false) }
            }
        }
    }

    private fun Throwable.userMessage(): String =
        when (this) {
            is PorizoFailure -> message ?: "Something went wrong."
            else -> message ?: "Something went wrong."
        }

    private companion object {
        const val MIN_RECORDING_SECONDS = 1.0
    }
}
