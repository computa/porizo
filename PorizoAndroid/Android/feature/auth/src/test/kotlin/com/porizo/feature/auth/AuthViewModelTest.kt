package com.porizo.feature.auth

import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.GoogleSignInToken
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.PendingMagicLoginStore
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.model.AuthSession
import com.porizo.core.model.AuthUser
import com.porizo.core.model.DeviceRegistration
import com.porizo.core.model.PhoneRegisterResult
import com.porizo.core.model.MagicLoginRequest
import com.porizo.core.model.MagicLoginSession
import com.porizo.core.model.MagicLoginStatus
import com.porizo.core.model.MagicLoginTransactionStatus
import com.porizo.core.model.PendingMagicLogin
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.model.SendPhoneCodeResult
import com.porizo.core.model.SocialAuthChallenge
import com.porizo.core.model.SocialAuthResult
import com.porizo.core.model.VerifyPhoneCodeResult
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import java.time.Instant
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
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
    fun unconfiguredGoogleSignInDoesNotCallPlatformOrBackend() = runTest(dispatcher) {
        val authRepository = RecordingAuthRepository()
        val google = RecordingGoogleSignInGateway()
        val viewModel = AuthViewModel(
            authRepository = authRepository,
            googleAuthConfig = GoogleAuthConfig(webClientId = ""),
            googleSignInGateway = google,
            pushGateway = NoopPushGateway,
            pendingMagicLoginStore = RecordingPendingMagicLoginStore(),
        )
        advanceUntilIdle()

        viewModel.signInWithGoogle()
        advanceUntilIdle()

        assertEquals(0, google.signInCalls)
        assertEquals(0, authRepository.socialLoginCalls)
        assertEquals(GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE, viewModel.uiState.value.errorMessage)
    }

    @Test
    fun configuredGoogleSignInSubmitsIdTokenAndAuthenticates() = runTest(dispatcher) {
        val authRepository = RecordingAuthRepository(
            challengeResult = SocialAuthChallenge("challenge-1", "nonce-1", "2999-01-01T00:00:00Z"),
        )
        val google = RecordingGoogleSignInGateway(idToken = "google-id-token")
        val viewModel = AuthViewModel(
            authRepository = authRepository,
            googleAuthConfig = GoogleAuthConfig(webClientId = "web-client.apps.googleusercontent.com"),
            googleSignInGateway = google,
            pushGateway = NoopPushGateway,
            pendingMagicLoginStore = RecordingPendingMagicLoginStore(),
        )
        advanceUntilIdle()

        viewModel.signInWithGoogle()
        advanceUntilIdle()

        assertEquals(listOf("web-client.apps.googleusercontent.com"), google.webClientIds)
        assertEquals(listOf("nonce-1"), google.nonces)
        assertEquals(1, authRepository.socialLoginCalls)
        assertEquals(1, authRepository.challengeCalls)
        assertEquals("google", authRepository.socialProvider)
        assertEquals("google-id-token", authRepository.socialIdToken)
        assertEquals("challenge-1", authRepository.socialChallenge?.challengeId)
        assertEquals("nonce-1", authRepository.socialChallenge?.nonce)
        assertTrue(viewModel.uiState.value.phase is AuthPhase.Authenticated)
    }

    @Test
    fun googleChallengeFailureDoesNotLaunchPlatformSignIn() = runTest(dispatcher) {
        val authRepository = RecordingAuthRepository(
            challengeFailure = PorizoFailure.Unknown("Could not start sign-in."),
        )
        val google = RecordingGoogleSignInGateway(idToken = "google-id-token")
        val viewModel = AuthViewModel(
            authRepository = authRepository,
            googleAuthConfig = GoogleAuthConfig(webClientId = "web-client.apps.googleusercontent.com"),
            googleSignInGateway = google,
            pushGateway = NoopPushGateway,
            pendingMagicLoginStore = RecordingPendingMagicLoginStore(),
        )
        advanceUntilIdle()

        viewModel.signInWithGoogle()
        advanceUntilIdle()

        assertEquals(1, authRepository.challengeCalls)
        assertEquals(0, google.signInCalls)
        assertEquals(0, authRepository.socialLoginCalls)
        assertEquals("Could not start sign-in.", viewModel.uiState.value.errorMessage)
    }

    @Test
    fun magicLinkUsesStoredRequesterSecretOnce() = runTest(dispatcher) {
        val repository = RecordingAuthRepository()
        val store = RecordingPendingMagicLoginStore()
        val viewModel = AuthViewModel(repository, GoogleAuthConfig(""), RecordingGoogleSignInGateway(), NoopPushGateway, store)
        advanceUntilIdle()

        viewModel.beginMagicLogin()
        viewModel.updateEmail("person@example.com")
        viewModel.sendMagicLink()
        advanceUntilIdle()

        assertEquals("android", repository.magicPlatform)
        assertTrue(repository.requesterKeyLength in 16..512)
        viewModel.consumeMagicLink(DeepLinkRoute.AndroidMagicLogin("tx-1", "link-secret"))
        advanceUntilIdle()

        assertEquals("request-secret", repository.exchangedRequestSecret)
        assertEquals("link-secret", repository.exchangedLinkSecret)
        assertEquals(null, store.getRequestSecret("tx-1"))
        assertTrue(viewModel.uiState.value.phase is AuthPhase.Authenticated)
    }

    @Test
    fun forwardedMagicLinkWithoutRequesterSecretDoesNotExchange() = runTest(dispatcher) {
        val repository = RecordingAuthRepository()
        val viewModel = AuthViewModel(
            repository, GoogleAuthConfig(""), RecordingGoogleSignInGateway(), NoopPushGateway,
            RecordingPendingMagicLoginStore(),
        )
        advanceUntilIdle()
        viewModel.consumeMagicLink(DeepLinkRoute.AndroidMagicLogin("forwarded", "link-secret"))
        advanceUntilIdle()

        assertEquals(0, repository.exchangeCalls)
        assertTrue(viewModel.uiState.value.phase is AuthPhase.MagicLinkWrongDevice)
    }

    @Test
    fun successfulRequestPersistsCheckEmailPresentation() = runTest(dispatcher) {
        val store = RecordingPendingMagicLoginStore()
        val viewModel = createViewModel(RecordingAuthRepository(), store)
        advanceUntilIdle()

        viewModel.beginMagicLogin()
        viewModel.updateEmail(" Person@Example.com ")
        viewModel.sendMagicLink()
        runCurrent()

        val phase = viewModel.uiState.value.phase as AuthPhase.MagicLinkSent
        assertEquals("person@example.com", phase.email)
        assertTrue(phase.resendSecondsRemaining > 0)
        assertEquals("person@example.com", store.getPending()?.email)
        assertEquals("request-secret", store.getRequestSecret("tx-1"))
    }

    @Test
    fun rapidDuplicateSendStartsOnlyOneRequest() = runTest(dispatcher) {
        val repository = RecordingAuthRepository()
        val viewModel = createViewModel(repository, RecordingPendingMagicLoginStore())
        advanceUntilIdle()
        viewModel.beginMagicLogin()
        viewModel.updateEmail("person@example.com")

        viewModel.sendMagicLink()
        viewModel.sendMagicLink()
        advanceUntilIdle()

        assertEquals(1, repository.magicRequestCalls)
    }

    @Test
    fun restoredAuthenticatedSessionSupersedesPendingMagicLogin() = runTest(dispatcher) {
        val store = RecordingPendingMagicLoginStore().apply { save(futurePending(), "request-secret") }
        val repository = RecordingAuthRepository(
            restoredSession = AuthSession("existing-user", "access", "refresh", 3_600),
        )
        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()

        viewModel.consumeMagicLink(DeepLinkRoute.AndroidMagicLogin("tx-1", "link-secret"))
        advanceUntilIdle()

        assertEquals(0, repository.exchangeCalls)
        assertEquals(null, store.getPending())
        assertEquals(AuthPhase.Authenticated("existing-user"), viewModel.uiState.value.phase)
    }

    @Test
    fun coldStartMagicLinkWaitsForExistingSessionRestoration() = runTest(dispatcher) {
        val restoreGate = CompletableDeferred<Unit>()
        val store = RecordingPendingMagicLoginStore().apply { save(futurePending(), "request-secret") }
        val repository = RecordingAuthRepository(
            restoredSession = AuthSession("existing-user", "access", "refresh", 3_600),
            restoreGate = restoreGate,
        )
        val viewModel = createViewModel(repository, store)

        viewModel.consumeMagicLink(DeepLinkRoute.AndroidMagicLogin("tx-1", "link-secret"))
        runCurrent()

        assertEquals(0, repository.exchangeCalls)
        restoreGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(0, repository.exchangeCalls)
        assertEquals(AuthPhase.Authenticated("existing-user"), viewModel.uiState.value.phase)
    }

    @Test
    fun legacyRecoveryPreservesOriginalAuthMethods() = runTest(dispatcher) {
        val store = RecordingPendingMagicLoginStore().apply { save(futurePending(), "request-secret") }
        val repository = RecordingAuthRepository(
            exchangeFailure = PorizoFailure.Server(
                status = 409,
                code = "LEGACY_ACCOUNT_RECOVERY_REQUIRED",
                message = "Recover the existing account.",
                details = PorizoFailure.ServerDetails(
                    maskedEmail = "p***@example.com",
                    authMethods = listOf("phone", "apple"),
                ),
            ),
        )
        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()

        viewModel.consumeMagicLink(DeepLinkRoute.AndroidMagicLogin("tx-1", "link-secret"))
        advanceUntilIdle()

        val phase = viewModel.uiState.value.phase as AuthPhase.MagicLinkLegacyRecovery
        assertEquals("p***@example.com", phase.maskedEmail)
        assertEquals(listOf("phone", "apple"), phase.authMethods)
        assertEquals(null, store.getPending())
    }

    @Test
    fun resendIsBlockedUntilCooldownFinishes() = runTest(dispatcher) {
        val repository = RecordingAuthRepository()
        val viewModel = createViewModel(repository, RecordingPendingMagicLoginStore())
        advanceUntilIdle()
        viewModel.beginMagicLogin()
        viewModel.updateEmail("person@example.com")
        viewModel.sendMagicLink()
        runCurrent()

        viewModel.resendMagicLink()
        runCurrent()
        assertEquals(1, repository.magicRequestCalls)

        advanceTimeBy(60_000)
        runCurrent()
        viewModel.resendMagicLink()
        runCurrent()
        assertEquals(2, repository.magicRequestCalls)
    }

    @Test
    fun pendingCheckEmailStateRestoresAfterRestart() = runTest(dispatcher) {
        val store = RecordingPendingMagicLoginStore().apply {
            save(futurePending(), "request-secret")
        }
        val repository = RecordingAuthRepository(status = MagicLoginTransactionStatus.Pending)

        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()

        assertEquals("person@example.com", (viewModel.uiState.value.phase as AuthPhase.MagicLinkSent).email)
        assertEquals(1, repository.statusCalls)
    }

    @Test
    fun cancelledStatusCheckCannotRestoreOldCheckEmailState() = runTest(dispatcher) {
        val statusGate = CompletableDeferred<Unit>()
        val store = RecordingPendingMagicLoginStore().apply { save(futurePending(), "request-secret") }
        val repository = RecordingAuthRepository(statusGate = statusGate)
        val viewModel = createViewModel(repository, store)
        runCurrent()

        viewModel.changeMagicLoginEmail()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.phase is AuthPhase.MagicEmailEntry)
        assertEquals(null, viewModel.uiState.value.errorMessage)
    }

    @Test
    fun staleStatusResponseCannotOverwriteResentTransaction() = runTest(dispatcher) {
        val statusGate = CompletableDeferred<Unit>()
        val store = RecordingPendingMagicLoginStore().apply { save(futurePending(), "request-secret") }
        val repository = RecordingAuthRepository(
            statusGate = statusGate,
            requestedTransactionId = "tx-2",
        )
        val viewModel = createViewModel(repository, store)
        runCurrent()

        viewModel.resendMagicLink()
        runCurrent()
        assertEquals("tx-2", store.getPending()?.transactionId)

        statusGate.complete(Unit)
        advanceUntilIdle()

        assertEquals("tx-2", store.getPending()?.transactionId)
        assertTrue(viewModel.uiState.value.phase is AuthPhase.MagicLinkSent)
    }

    @Test
    fun browserApprovedResumeCompletesWithStoredRequesterSecret() = runTest(dispatcher) {
        val store = RecordingPendingMagicLoginStore().apply {
            save(futurePending(), "request-secret")
        }
        val repository = RecordingAuthRepository(status = MagicLoginTransactionStatus.Pending)
        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()

        repository.status = MagicLoginTransactionStatus.Approved
        viewModel.resumeMagicLogin(DeepLinkRoute.MagicLoginResume("tx-1"))
        advanceUntilIdle()

        assertEquals("request-secret", repository.completedRequestSecret)
        assertEquals(1, repository.completeCalls)
        assertEquals(null, store.getPending())
        assertTrue(viewModel.uiState.value.phase is AuthPhase.Authenticated)
    }

    @Test
    fun mismatchedBrowserResumeNeverCallsStatusOrComplete() = runTest(dispatcher) {
        val store = RecordingPendingMagicLoginStore().apply {
            save(futurePending(), "request-secret")
        }
        val repository = RecordingAuthRepository(status = MagicLoginTransactionStatus.Pending)
        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()
        val initialStatusCalls = repository.statusCalls

        viewModel.resumeMagicLogin(DeepLinkRoute.MagicLoginResume("forwarded"))
        advanceUntilIdle()

        assertEquals(initialStatusCalls, repository.statusCalls)
        assertEquals(0, repository.completeCalls)
        assertTrue(viewModel.uiState.value.phase is AuthPhase.MagicLinkWrongDevice)
    }

    @Test
    fun expiredPendingRequestUsesServerStatusBeforeDiscardingRecoveryProof() = runTest(dispatcher) {
        val pending = futurePending().copy(expiresAt = "2000-01-01T00:00:00Z")
        val store = RecordingPendingMagicLoginStore().apply { save(pending, "request-secret") }
        val repository = RecordingAuthRepository(status = MagicLoginTransactionStatus.Expired)

        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.phase is AuthPhase.MagicLinkExpired)
        assertEquals(1, repository.statusCalls)
        assertEquals(null, store.getPending())
    }

    @Test
    fun consumedResponseCanBeRecoveredAfterOriginalExpiry() = runTest(dispatcher) {
        val pending = futurePending().copy(expiresAt = "2000-01-01T00:00:00Z")
        val store = RecordingPendingMagicLoginStore().apply { save(pending, "request-secret") }
        val repository = RecordingAuthRepository(status = MagicLoginTransactionStatus.Consumed)

        val viewModel = createViewModel(repository, store)
        advanceUntilIdle()

        assertEquals(1, repository.statusCalls)
        assertEquals(1, repository.completeCalls)
        assertEquals(null, store.getPending())
        assertTrue(viewModel.uiState.value.phase is AuthPhase.Authenticated)
    }

    private fun createViewModel(
        repository: RecordingAuthRepository,
        store: RecordingPendingMagicLoginStore,
    ) = AuthViewModel(repository, GoogleAuthConfig(""), RecordingGoogleSignInGateway(), NoopPushGateway, store)

    private fun futurePending() = PendingMagicLogin(
        transactionId = "tx-1",
        email = "person@example.com",
        expiresAt = Instant.now().plusSeconds(3_600).toString(),
        resendAvailableAtEpochSeconds = Instant.now().epochSecond,
    )
}

private class RecordingGoogleSignInGateway(
    private val idToken: String = "token",
) : GoogleSignInGateway {
    val webClientIds = mutableListOf<String>()
    val nonces = mutableListOf<String>()
    val signInCalls: Int
        get() = webClientIds.size

    override suspend fun signIn(webClientId: String, nonce: String): PlatformResult<GoogleSignInToken> {
        webClientIds += webClientId
        nonces += nonce
        return PlatformResult.Success(GoogleSignInToken(idToken))
    }
}

private class RecordingAuthRepository(
    private val challengeResult: SocialAuthChallenge = SocialAuthChallenge("challenge", "nonce", null),
    private val challengeFailure: Throwable? = null,
    var status: MagicLoginTransactionStatus = MagicLoginTransactionStatus.Pending,
    private val restoredSession: AuthSession? = null,
    private val restoreGate: CompletableDeferred<Unit>? = null,
    private val statusGate: CompletableDeferred<Unit>? = null,
    private val requestedTransactionId: String = "tx-1",
    private val exchangeFailure: Throwable? = null,
) : AuthRepository {
    var requesterKeyLength = 0
    var magicPlatform: String? = null
    var exchangedRequestSecret: String? = null
    var exchangedLinkSecret: String? = null
    var exchangeCalls = 0
    var magicRequestCalls = 0
    var statusCalls = 0
    var completeCalls = 0
    var completedRequestSecret: String? = null

    override suspend fun requestMagicLogin(email: String, purpose: String, requesterKey: String): MagicLoginRequest {
        magicRequestCalls += 1
        requesterKeyLength = requesterKey.length
        magicPlatform = "android"
        return MagicLoginRequest(requestedTransactionId, "request-secret", "2999-01-01T00:00:00Z")
    }

    override suspend fun exchangeMagicLogin(transactionId: String, linkSecret: String, requestSecret: String): MagicLoginSession {
        exchangeCalls += 1
        exchangeFailure?.let { throw it }
        exchangedLinkSecret = linkSecret
        exchangedRequestSecret = requestSecret
        return MagicLoginSession("user-1", "access", "refresh", 3600)
    }

    override suspend fun getMagicLoginStatus(transactionId: String, requestSecret: String): MagicLoginStatus {
        statusCalls += 1
        statusGate?.await()
        return MagicLoginStatus(status, "2999-01-01T00:00:00Z")
    }

    override suspend fun completeMagicLogin(transactionId: String, requestSecret: String): MagicLoginSession {
        completeCalls += 1
        completedRequestSecret = requestSecret
        return MagicLoginSession("user-1", "access", "refresh", 3600)
    }
    var challengeCalls = 0
    var socialLoginCalls = 0
    var socialProvider: String? = null
    var socialIdToken: String? = null
    var socialChallenge: SocialAuthChallenge? = null

    override suspend fun socialLogin(
        provider: String,
        idToken: String,
        name: String?,
        confirmLink: Boolean,
        challenge: SocialAuthChallenge?,
    ): SocialAuthResult {
        socialLoginCalls += 1
        socialProvider = provider
        socialIdToken = idToken
        socialChallenge = challenge
        return SocialAuthResult(
            userId = "user-1",
            accessToken = "access",
            refreshToken = "refresh",
            expiresInSeconds = 3600,
            isNewUser = false,
            requiresLinkConfirmation = false,
            existingAccountEmail = null,
            provider = provider,
        )
    }

    override suspend fun createSocialAuthChallenge(provider: String): SocialAuthChallenge {
        challengeCalls += 1
        challengeFailure?.let { throw it }
        return challengeResult
    }

    override suspend fun restoreSession(): AuthSession? {
        restoreGate?.await()
        return restoredSession
    }
    override suspend fun saveSession(session: AuthSession) = Unit
    override suspend fun clearSession() = Unit
    override suspend fun currentUser(): AuthUser = error("unused")
    override suspend fun sendPhoneVerificationCode(phoneNumber: String): SendPhoneCodeResult = error("unused")
    override suspend fun verifyPhoneCode(phoneNumber: String, code: String): VerifyPhoneCodeResult = error("unused")
    override suspend fun registerPhoneAccount(registrationToken: String, phoneNumber: String): PhoneRegisterResult = error("unused")
    override suspend fun refresh(refreshToken: String): RefreshTokenResult = error("unused")
    override suspend fun logout() = Unit
    override suspend fun registerDevice(): DeviceRegistration = error("unused")
}

private class RecordingPendingMagicLoginStore : PendingMagicLoginStore {
    private val secrets = mutableMapOf<String, String>()
    private var pending: PendingMagicLogin? = null

    override fun save(pending: PendingMagicLogin, requestSecret: String) {
        this.pending = pending
        secrets[pending.transactionId] = requestSecret
    }

    override fun getPending(): PendingMagicLogin? = pending
    override fun getRequestSecret(transactionId: String): String? = secrets[transactionId]
    override fun remove(transactionId: String) {
        secrets.remove(transactionId)
        if (pending?.transactionId == transactionId) pending = null
    }
}

private object NoopPushGateway : PushGateway {
    override fun initialize(appId: String, verbose: Boolean): String = "ok"
    override fun login(userId: String): String = "ok"
    override fun logout(): String = "ok"
    override fun optIn(): String = "ok"
    override fun requestNotificationPermission(): String = "ok"
    override fun pushToken(): String? = null
    override fun subscriptionId(): String? = null
}
