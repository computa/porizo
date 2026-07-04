package com.porizo.feature.claim

import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.player.PlayerUiState
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.model.AuthSession
import com.porizo.core.model.AuthUser
import com.porizo.core.model.CreateShareResult
import com.porizo.core.model.DeviceRegistration
import com.porizo.core.model.PhoneRegisterResult
import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.ReceiverHandoffResult
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.model.SendPhoneCodeResult
import com.porizo.core.model.ShareClaimResult
import com.porizo.core.model.ShareInfo
import com.porizo.core.model.ShareStreamResult
import com.porizo.core.model.SocialAuthResult
import com.porizo.core.model.VerifyPhoneCodeResult
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

class ClaimViewModelTest {
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
    fun receiverHandoffClaimRetriesDeviceRegistrationAndEmitsCompletion() = runTest(dispatcher) {
        val shareRepository = RetryingReceiverShareRepository()
        val authRepository = RecordingAuthRepository()
        val player = RecordingPlayerController()
        val viewModel = ClaimViewModel(
            shareRepository = shareRepository,
            authRepository = authRepository,
            player = player,
        )

        viewModel.open(DeepLinkRoute.ReceiverHandoff("handoff-1"))
        advanceUntilIdle()
        viewModel.updatePin("12a34")

        val completion = async { viewModel.completionEvents.first() }
        viewModel.claim()
        advanceUntilIdle()

        assertEquals(1, authRepository.deviceRegistrationCount)
        assertEquals(
            listOf<Pair<String, String?>>("claim-token" to "1234", "claim-token" to "1234"),
            shareRepository.receiverClaims,
        )
        assertEquals(ClaimPhase.Claimed, viewModel.uiState.value.phase)
        assertEquals("https://stream.local/claim.m3u8", player.playedTrack?.streamUrl)
        assertEquals(
            ClaimCompletion(
                kind = ClaimKind.ReceiverHandoff,
                shareId = null,
                receiverClaimToken = "claim-token",
                playableTrack = player.playedTrack,
            ),
            completion.await(),
        )
    }
}

private class RetryingReceiverShareRepository : ShareRepository {
    val receiverClaims = mutableListOf<Pair<String, String?>>()

    override suspend fun resolveReceiverHandoff(handoffId: String): ReceiverHandoffResult =
        ReceiverHandoffResult(
            receiverSessionId = "receiver-session",
            contentKind = "song",
            receiverClaimToken = "claim-token",
            receiverClaimExpiresAt = null,
        )

    override suspend fun claimReceiverToken(claimToken: String, pin: String?): ShareClaimResult {
        receiverClaims += claimToken to pin
        if (receiverClaims.size == 1) {
            throw PorizoFailure.Server(
                status = 401,
                code = "INVALID_DEVICE_TOKEN",
                message = "Device registration expired.",
            )
        }
        return ShareClaimResult(
            status = "claimed",
            appSaveAllowed = true,
            expiresAt = null,
            trackId = "track-1",
            receiverClaimStreamPath = "/receiver-claim/claim-token/stream",
        )
    }

    override suspend fun receiverClaimStream(claimToken: String): ShareStreamResult =
        ShareStreamResult(
            streamUrl = "https://stream.local/claim.m3u8",
            format = "hls",
            keyUrl = null,
            expiresAt = null,
        )

    override suspend fun createTrackShare(trackId: String, versionNum: Int, requirePin: Boolean): CreateShareResult = error("unused")
    override suspend fun createPoemShare(poemId: String): CreateShareResult = error("unused")
    override suspend fun shareInfo(shareId: String): ShareInfo = error("unused")
    override suspend fun claimShare(shareId: String, pin: String?): ShareClaimResult = error("unused")
    override suspend fun shareStream(shareId: String): ShareStreamResult = error("unused")
    override suspend fun poemShareInfo(shareId: String): PoemShareInfo = error("unused")
    override suspend fun poemShareBody(shareId: String): PoemBody? = error("unused")
    override suspend fun claimPoemShare(shareId: String, pin: String?): ShareClaimResult = error("unused")
}

private class RecordingAuthRepository : AuthRepository {
    var deviceRegistrationCount = 0

    override suspend fun registerDevice(): DeviceRegistration {
        deviceRegistrationCount += 1
        return DeviceRegistration(deviceToken = "device-token", expiresAt = "2026-07-04T00:00:00Z")
    }

    override suspend fun restoreSession(): AuthSession? = null
    override suspend fun saveSession(session: AuthSession) = Unit
    override suspend fun clearSession() = Unit
    override suspend fun currentUser(): AuthUser = error("unused")
    override suspend fun sendPhoneVerificationCode(phoneNumber: String): SendPhoneCodeResult = error("unused")
    override suspend fun verifyPhoneCode(phoneNumber: String, code: String): VerifyPhoneCodeResult = error("unused")
    override suspend fun registerPhoneAccount(registrationToken: String, phoneNumber: String): PhoneRegisterResult = error("unused")
    override suspend fun socialLogin(provider: String, idToken: String, name: String?, confirmLink: Boolean): SocialAuthResult = error("unused")
    override suspend fun refresh(refreshToken: String): RefreshTokenResult = error("unused")
    override suspend fun logout() = Unit
}

private class RecordingPlayerController : PlayerController {
    override val state = MutableStateFlow(PlayerUiState())
    var playedTrack: PlayableTrack? = null
    override fun play(track: PlayableTrack) {
        playedTrack = track
    }
    override fun toggle() = Unit
    override fun seekToFraction(fraction: Float) = Unit
    override fun clear() = Unit
    override fun syncFromEngine() = Unit
}
