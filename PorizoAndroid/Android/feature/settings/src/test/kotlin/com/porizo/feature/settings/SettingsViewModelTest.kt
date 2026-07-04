package com.porizo.feature.settings

import com.porizo.core.domain.platform.DeviceTrustGateway
import com.porizo.core.domain.platform.DeviceTrustSnapshot
import com.porizo.core.domain.platform.NativeRecording
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PlayBillingGateway
import com.porizo.core.domain.platform.PlayProductSummary
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.platform.PushRoute
import com.porizo.core.domain.platform.PushRouteStore
import com.porizo.core.domain.platform.VoiceRecorder
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.BillingRepository
import com.porizo.core.domain.repository.DeviceTrustRepository
import com.porizo.core.domain.repository.PushRepository
import com.porizo.core.domain.repository.VoiceEnrollmentRepository
import com.porizo.core.model.AuthSession
import com.porizo.core.model.AuthUser
import com.porizo.core.model.BillingEntitlements
import com.porizo.core.model.ChunkUploadResult
import com.porizo.core.model.DeviceIntegrityNonce
import com.porizo.core.model.DeviceIntegrityVerification
import com.porizo.core.model.DeviceRegistration
import com.porizo.core.model.EnrollmentSession
import com.porizo.core.model.GoogleReceiptResult
import com.porizo.core.model.GoogleSubscriptionSummary
import com.porizo.core.model.PhoneRegisterResult
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.model.SendPhoneCodeResult
import com.porizo.core.model.SocialAuthResult
import com.porizo.core.model.SubscriptionPlan
import com.porizo.core.model.SubscriptionStatus
import com.porizo.core.model.UploadUrl
import com.porizo.core.model.VerifyPhoneCodeResult
import com.porizo.core.model.VoiceProfile
import com.porizo.core.model.VoiceProfileStatus
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

class SettingsViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun startupRecoversSavedPurchaseReceiptAndAcknowledgesAfterBackendAcceptance() = runTest(dispatcher) {
        val billingRepository = FakeBillingRepository()
        val billingGateway = FakePlayBillingGateway(
            pendingProductIds = listOf("porizo_plus_monthly"),
            tokenByProduct = mapOf("porizo_plus_monthly" to "purchase-token"),
        )

        val viewModel = SettingsViewModel(
            authRepository = FakeAuthRepository(),
            billingRepository = billingRepository,
            pushRepository = FakePushRepository(),
            voiceEnrollmentRepository = FakeVoiceEnrollmentRepository(),
            billingProvider = billingGateway,
            pushProvider = FakePushGateway(),
            pushRouteStore = FakePushRouteStore(),
            deviceTrustProvider = FakeDeviceTrustGateway(),
            deviceTrustRepository = FakeDeviceTrustRepository(),
            recorderProvider = FakeVoiceRecorder(),
            config = SettingsPlatformConfig("", emptyList(), emptyList(), voiceEnrollmentEnabled = false),
        )

        advanceUntilIdle()

        assertEquals(listOf("porizo_plus_monthly" to "purchase-token"), billingRepository.submittedReceipts)
        assertEquals(listOf("porizo_plus_monthly"), billingGateway.acknowledgedProductIds)
        assertTrue(viewModel.uiState.value.billingStatus.contains("Recovered 1"))
    }

    @Test
    fun startupRecoversSavedConsumableReceiptAndConsumesAfterBackendAcceptance() = runTest(dispatcher) {
        val billingRepository = FakeBillingRepository()
        val billingGateway = FakePlayBillingGateway(
            pendingProductIds = listOf("gift_bundle_1"),
            tokenByProduct = mapOf("gift_bundle_1" to "gift-token"),
        )

        val viewModel = SettingsViewModel(
            authRepository = FakeAuthRepository(),
            billingRepository = billingRepository,
            pushRepository = FakePushRepository(),
            voiceEnrollmentRepository = FakeVoiceEnrollmentRepository(),
            billingProvider = billingGateway,
            pushProvider = FakePushGateway(),
            pushRouteStore = FakePushRouteStore(),
            deviceTrustProvider = FakeDeviceTrustGateway(),
            deviceTrustRepository = FakeDeviceTrustRepository(),
            recorderProvider = FakeVoiceRecorder(),
            config = SettingsPlatformConfig("", emptyList(), listOf("gift_bundle_1"), voiceEnrollmentEnabled = false),
        )

        advanceUntilIdle()

        assertEquals(listOf("gift_bundle_1" to "gift-token"), billingRepository.submittedConsumableReceipts)
        assertEquals(emptyList(), billingGateway.acknowledgedProductIds)
        assertEquals(listOf("gift_bundle_1"), billingGateway.consumedProductIds)
        assertTrue(viewModel.uiState.value.billingStatus.contains("Recovered 1"))
    }

    @Test
    fun enablePushRequestsBackendNonceAndVerifiesReturnedIntegrityToken() = runTest(dispatcher) {
        val pushRepository = FakePushRepository()
        val deviceTrustRepository = FakeDeviceTrustRepository()
        val deviceTrustGateway = FakeDeviceTrustGateway(
            snapshot = DeviceTrustSnapshot(
                appSetId = "app-set-id",
                integrityToken = "integrity-token",
                status = "token ready",
            ),
        )
        val viewModel = SettingsViewModel(
            authRepository = FakeAuthRepository(),
            billingRepository = FakeBillingRepository(),
            pushRepository = pushRepository,
            voiceEnrollmentRepository = FakeVoiceEnrollmentRepository(),
            billingProvider = FakePlayBillingGateway(emptyList(), emptyMap()),
            pushProvider = FakePushGateway(pushToken = "push-token", subscriptionId = "subscription-id"),
            pushRouteStore = FakePushRouteStore(),
            deviceTrustProvider = deviceTrustGateway,
            deviceTrustRepository = deviceTrustRepository,
            recorderProvider = FakeVoiceRecorder(),
            config = SettingsPlatformConfig("onesignal", emptyList(), emptyList(), voiceEnrollmentEnabled = false),
        )

        viewModel.enablePush()
        advanceUntilIdle()

        assertEquals(listOf<Pair<String?, String?>>("subscription-id" to "android"), deviceTrustRepository.nonceRequests)
        assertEquals(listOf<String?>("request-hash"), deviceTrustGateway.requestHashes)
        assertEquals(
            listOf<Triple<String, String, String?>>(Triple("nonce-1", "integrity-token", "app-set-id")),
            deviceTrustRepository.verifyRequests,
        )
        assertEquals(listOf("subscription-id"), pushRepository.registeredTokens)
        assertEquals("app-set-id", viewModel.uiState.value.appSetId)
        assertTrue(viewModel.uiState.value.deviceTrustStatus.contains("verified", ignoreCase = true))
    }
}

private class FakeAuthRepository : AuthRepository {
    override suspend fun restoreSession(): AuthSession? =
        AuthSession("user-1", "access", "refresh", 3600, issuedAtEpochSeconds = 1)

    override suspend fun saveSession(session: AuthSession) = Unit
    override suspend fun clearSession() = Unit
    override suspend fun currentUser(): AuthUser = error("unused")
    override suspend fun sendPhoneVerificationCode(phoneNumber: String): SendPhoneCodeResult = error("unused")
    override suspend fun verifyPhoneCode(phoneNumber: String, code: String): VerifyPhoneCodeResult = error("unused")
    override suspend fun registerPhoneAccount(registrationToken: String, phoneNumber: String): PhoneRegisterResult = error("unused")
    override suspend fun socialLogin(provider: String, idToken: String, name: String?, confirmLink: Boolean): SocialAuthResult = error("unused")
    override suspend fun refresh(refreshToken: String): RefreshTokenResult = error("unused")
    override suspend fun logout() = Unit
    override suspend fun registerDevice(): DeviceRegistration = error("unused")
}

private class FakeBillingRepository : BillingRepository {
    val submittedReceipts = mutableListOf<Pair<String, String>>()
    val submittedConsumableReceipts = mutableListOf<Pair<String, String>>()

    override suspend fun entitlements(): BillingEntitlements = entitlement()
    override suspend fun plans(): List<SubscriptionPlan> = emptyList()
    override suspend fun subscriptionStatus(): SubscriptionStatus = SubscriptionStatus(null, null, null, null)
    override suspend fun submitGoogleReceipt(productId: String, purchaseToken: String): GoogleReceiptResult {
        submittedReceipts += productId to purchaseToken
        return GoogleReceiptResult(
            success = true,
            subscription = GoogleSubscriptionSummary("sub-1", "plus", "active", null, true),
            entitlements = entitlement(),
        )
    }
    override suspend fun submitGoogleConsumableReceipt(productId: String, purchaseToken: String): GoogleReceiptResult {
        submittedConsumableReceipts += productId to purchaseToken
        return GoogleReceiptResult(
            success = true,
            subscription = null,
            entitlements = entitlement(),
        )
    }

    private fun entitlement(): BillingEntitlements =
        BillingEntitlements(
            tier = "plus",
            baseSongsRemaining = null,
            songsRemaining = 9,
            songsAllowance = 10,
            poemsRemaining = 5,
            poemsAllowance = 5,
            trialSongsRemaining = null,
            giftWalletBalance = null,
            availableSongCredits = 9,
            payPerSongEnabled = null,
            giftTokensRemaining = null,
            autoRenewEnabled = true,
        )
}

private class FakePlayBillingGateway(
    private val pendingProductIds: List<String>,
    private val tokenByProduct: Map<String, String>,
) : PlayBillingGateway {
    val acknowledgedProductIds = mutableListOf<String>()
    val consumedProductIds = mutableListOf<String>()

    override fun queryProducts(subscriptionIds: List<String>, oneTimeIds: List<String>): String = "unused"
    override fun launchPurchase(productId: String, obfuscatedAccountId: String?): String = "unused"
    override fun queryActivePurchases(): String = "unused"
    override fun lastPurchaseToken(productId: String): String? = tokenByProduct[productId]
    override fun pendingReceiptProductIds(): List<String> = pendingProductIds
    override fun acknowledgePurchase(productId: String): String {
        acknowledgedProductIds += productId
        return "acknowledged"
    }
    override fun consumePurchase(productId: String): String {
        consumedProductIds += productId
        return "consumed"
    }
    override fun loadedProducts(): List<PlayProductSummary> = emptyList()
    override fun status(): String = "test"
}

private class FakePushRepository : PushRepository {
    val registeredTokens = mutableListOf<String>()

    override suspend fun registerPushToken(token: String) {
        registeredTokens += token
    }
    override suspend fun clearPushToken() = Unit
}

private class FakeVoiceEnrollmentRepository : VoiceEnrollmentRepository {
    override suspend fun startEnrollment(): EnrollmentSession = error("unused")
    override suspend fun uploadChunk(
        sessionId: String,
        uploadUrl: UploadUrl,
        bytes: ByteArray,
        contentType: String,
        durationSec: Double,
        checksum: String?,
    ): ChunkUploadResult = error("unused")
    override suspend fun createVoiceProfile(sessionId: String): VoiceProfile = error("unused")
    override suspend fun voiceProfileStatus(): VoiceProfileStatus = error("unused")
}

private class FakePushGateway(
    private val pushToken: String? = null,
    private val subscriptionId: String? = null,
) : PushGateway {
    override fun initialize(appId: String, verbose: Boolean): String = "unused"
    override fun login(userId: String): String = "unused"
    override fun logout(): String = "unused"
    override fun optIn(): String = "unused"
    override fun requestNotificationPermission(): String = "unused"
    override fun pushToken(): String? = pushToken
    override fun subscriptionId(): String? = subscriptionId
}

private class FakePushRouteStore : PushRouteStore {
    override fun consume(): PushRoute? = null
}

private class FakeDeviceTrustGateway(
    private val snapshot: DeviceTrustSnapshot = DeviceTrustSnapshot(null, null, "test"),
) : DeviceTrustGateway {
    val requestHashes = mutableListOf<String?>()

    override suspend fun snapshot(requestHash: String?): DeviceTrustSnapshot {
        requestHashes += requestHash
        return snapshot
    }
}

private class FakeDeviceTrustRepository : DeviceTrustRepository {
    val nonceRequests = mutableListOf<Pair<String?, String?>>()
    val verifyRequests = mutableListOf<Triple<String, String, String?>>()

    override suspend fun requestNonce(deviceId: String?, platform: String?): DeviceIntegrityNonce {
        nonceRequests += deviceId to platform
        return DeviceIntegrityNonce("nonce-1", "request-hash", "2026-07-04T00:00:00Z")
    }

    override suspend fun verify(
        nonce: String,
        integrityToken: String,
        appSetId: String?,
        packageName: String?,
    ): DeviceIntegrityVerification {
        verifyRequests += Triple(nonce, integrityToken, appSetId)
        return DeviceIntegrityVerification(true, true, "verified", appSetId)
    }
}

private class FakeVoiceRecorder : VoiceRecorder {
    override fun hasMicrophonePermission(): Boolean = false
    override fun requestMicrophonePermission(): String = "unused"
    override fun startRecording(): PlatformResult<String> = error("unused")
    override fun stopRecording(): PlatformResult<NativeRecording> = error("unused")
    override fun readBytes(recording: NativeRecording): ByteArray? = null
    override fun delete(recording: NativeRecording): String = "unused"
    override fun status(): String = "unused"
}
