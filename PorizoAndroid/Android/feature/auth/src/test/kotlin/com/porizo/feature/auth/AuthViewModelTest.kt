package com.porizo.feature.auth

import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.GoogleSignInToken
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.model.AuthSession
import com.porizo.core.model.AuthUser
import com.porizo.core.model.DeviceRegistration
import com.porizo.core.model.PhoneRegisterResult
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
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
        )
        advanceUntilIdle()

        viewModel.signInWithGoogle()
        advanceUntilIdle()

        assertEquals(1, authRepository.challengeCalls)
        assertEquals(0, google.signInCalls)
        assertEquals(0, authRepository.socialLoginCalls)
        assertEquals("Could not start sign-in.", viewModel.uiState.value.errorMessage)
    }
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
) : AuthRepository {
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

    override suspend fun restoreSession(): AuthSession? = null
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

private object NoopPushGateway : PushGateway {
    override fun initialize(appId: String, verbose: Boolean): String = "ok"
    override fun login(userId: String): String = "ok"
    override fun logout(): String = "ok"
    override fun optIn(): String = "ok"
    override fun requestNotificationPermission(): String = "ok"
    override fun pushToken(): String? = null
    override fun subscriptionId(): String? = null
}
