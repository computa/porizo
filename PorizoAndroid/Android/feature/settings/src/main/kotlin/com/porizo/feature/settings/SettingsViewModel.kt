package com.porizo.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.platform.DeviceTrustGateway
import com.porizo.core.domain.platform.DeviceTrustSnapshot
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PlayBillingGateway
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.platform.PushRoute
import com.porizo.core.domain.platform.PushRouteStore
import com.porizo.core.domain.platform.VoiceRecorder
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.BillingRepository
import com.porizo.core.domain.repository.DeviceTrustRepository
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
    private val deviceTrustProvider: DeviceTrustGateway,
    private val deviceTrustRepository: DeviceTrustRepository,
    private val recorderProvider: VoiceRecorder,
    private val config: SettingsPlatformConfig,
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        SettingsUiState(
            voiceEnrollmentEnabled = config.voiceEnrollmentEnabled,
            voiceStatus = if (config.voiceEnrollmentEnabled) {
                "Voice profile not loaded."
            } else {
                "My Voice is coming soon."
            },
        ),
    )
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private var activeEnrollment: EnrollmentSession? = null
    private var activeUploadUrl: UploadUrl? = null

    init {
        recoverPendingReceipts()
    }

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
                ?: loadedProducts.firstOrNull()?.id
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
            val isConsumable = isConsumableProduct(productId)
            val result = if (isConsumable) {
                billingRepository.submitGoogleConsumableReceipt(productId, purchaseToken)
            } else {
                billingRepository.submitGoogleReceipt(productId, purchaseToken)
            }
            val settlementStatus = if (result.success) {
                if (isConsumable) {
                    billingProvider.consumePurchase(productId)
                } else {
                    billingProvider.acknowledgePurchase(productId)
                }
            } else {
                null
            }
            _uiState.update {
                it.copy(
                    billingStatus = if (result.success) {
                        val label = if (isConsumable) "Gift purchase synced." else "Google receipt synced."
                        "$label ${settlementStatus.orEmpty()}".trim()
                    } else {
                        "Google receipt was not accepted."
                    },
                    purchaseToken = if (result.success && isConsumable) "" else it.purchaseToken,
                    entitlements = result.entitlements ?: it.entitlements,
                )
            }
        }
    }

    private fun recoverPendingReceipts() {
        viewModelScope.launch {
            val pendingProductIds = billingProvider.pendingReceiptProductIds()
            if (pendingProductIds.isEmpty()) return@launch
            val session = authRepository.restoreSession()
            if (session == null) {
                _uiState.update {
                    it.copy(billingStatus = "Purchase receipt saved. Sign in to finish activation.")
                }
                return@launch
            }

            _uiState.update {
                it.copy(
                    isBillingWorking = true,
                    billingStatus = "Recovering ${pendingProductIds.size} saved purchase receipt(s)...",
                )
            }

            var synced = 0
            var failed = 0
            var latestEntitlements = _uiState.value.entitlements
            pendingProductIds.forEach { productId ->
                val token = billingProvider.lastPurchaseToken(productId).orEmpty()
                if (token.isBlank()) return@forEach
                runCatching {
                    if (isConsumableProduct(productId)) {
                        billingRepository.submitGoogleConsumableReceipt(productId, token)
                    } else {
                        billingRepository.submitGoogleReceipt(productId, token)
                    }
                }
                    .onSuccess { result ->
                        if (result.success) {
                            synced += 1
                            latestEntitlements = result.entitlements ?: latestEntitlements
                            if (isConsumableProduct(productId)) {
                                billingProvider.consumePurchase(productId)
                            } else {
                                billingProvider.acknowledgePurchase(productId)
                            }
                        } else {
                            failed += 1
                        }
                    }
                    .onFailure { failed += 1 }
            }

            _uiState.update {
                it.copy(
                    isBillingWorking = false,
                    entitlements = latestEntitlements,
                    billingStatus = when {
                        synced > 0 && failed == 0 -> "Recovered $synced saved purchase receipt(s)."
                        synced > 0 -> "Recovered $synced saved receipt(s); $failed still need retry."
                        else -> "Saved purchase receipt still needs retry."
                    },
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
            val pushSubscriptionId = pushProvider.subscriptionId().orEmpty()
            val backendPushIdentifier = pushSubscriptionId.ifBlank { pushToken }
            val trustSnapshot = checkDeviceTrust(backendPushIdentifier.takeIf { it.isNotBlank() })
            val registrationStatus = if (backendPushIdentifier.isNotBlank()) {
                pushRepository.registerPushToken(backendPushIdentifier)
                "Backend push identifier registered."
            } else {
                "No OneSignal subscription id or push token available yet."
            }
            _uiState.update {
                it.copy(
                    pushToken = pushToken,
                    pushSubscriptionId = pushSubscriptionId,
                    appSetId = trustSnapshot.appSetId,
                    deviceTrustStatus = trustSnapshot.status,
                    pushStatus = listOf(initStatus, loginStatus, permissionStatus, optInStatus, registrationStatus, trustSnapshot.status)
                        .joinToString(" "),
                )
            }
        }
    }

    private suspend fun checkDeviceTrust(deviceId: String?): DeviceTrustSnapshot =
        runCatching {
            val nonce = deviceTrustRepository.requestNonce(deviceId = deviceId, platform = ANDROID_PLATFORM)
            val snapshot = deviceTrustProvider.snapshot(nonce.requestHash ?: nonce.nonce)
            val integrityToken = snapshot.integrityToken?.takeIf { it.isNotBlank() }
                ?: return@runCatching snapshot
            val verification = deviceTrustRepository.verify(
                nonce = nonce.nonce,
                integrityToken = integrityToken,
                appSetId = snapshot.appSetId,
                packageName = null,
            )
            snapshot.copy(
                appSetId = verification.appSetId ?: snapshot.appSetId,
                status = when {
                    verification.verified -> "Play Integrity verified."
                    verification.status != null -> "Play Integrity not verified: ${verification.status}."
                    else -> "Play Integrity not verified."
                },
            )
        }.getOrElse { error ->
            DeviceTrustSnapshot(
                appSetId = null,
                integrityToken = null,
                status = "Device trust check failed: ${error.userMessage()}",
            )
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
        if (!config.voiceEnrollmentEnabled) {
            _uiState.update { it.copy(voiceStatus = "My Voice is coming soon.") }
            return
        }
        _uiState.update {
            it.copy(voiceStatus = recorderProvider.requestMicrophonePermission())
        }
    }

    fun startEnrollment() {
        if (!config.voiceEnrollmentEnabled) {
            _uiState.update { it.copy(voiceStatus = "My Voice is coming soon.") }
            return
        }
        runVoice {
            startEnrollmentInternal()
        }
    }

    fun startRecording() {
        if (!config.voiceEnrollmentEnabled) {
            _uiState.update { it.copy(voiceStatus = "My Voice is coming soon.") }
            return
        }
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
        if (!config.voiceEnrollmentEnabled) {
            _uiState.update { it.copy(voiceStatus = "My Voice is coming soon.") }
            return
        }
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
        if (!config.voiceEnrollmentEnabled) {
            _uiState.update { it.copy(voiceStatus = "My Voice is coming soon.") }
            return
        }
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

    private fun isConsumableProduct(productId: String): Boolean {
        if (productId in config.oneTimeProductIds) return true
        return _uiState.value.loadedProducts
            .firstOrNull { it.id == productId }
            ?.productType == GOOGLE_IN_APP_PRODUCT_TYPE
    }

    private companion object {
        const val MIN_RECORDING_SECONDS = 1.0
        const val GOOGLE_IN_APP_PRODUCT_TYPE = "inapp"
        const val ANDROID_PLATFORM = "android"
    }
}
