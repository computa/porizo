package com.porizo.core.data

import com.porizo.core.datastore.AndroidSessionStore
import com.porizo.core.datastore.RenderPollStore
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.BillingRepository
import com.porizo.core.domain.repository.ConfirmStoryResult
import com.porizo.core.domain.repository.ContinueStoryResult
import com.porizo.core.domain.repository.CreateRepository
import com.porizo.core.domain.repository.LibraryRepository
import com.porizo.core.domain.repository.PushRepository
import com.porizo.core.domain.repository.RenderRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.repository.StartStoryResult
import com.porizo.core.domain.repository.VoiceEnrollmentRepository
import com.porizo.core.model.ApproveLyricsResult
import com.porizo.core.model.AuthSession
import com.porizo.core.model.AuthUser
import com.porizo.core.model.BillingEntitlements
import com.porizo.core.model.ChunkUploadResult
import com.porizo.core.model.CreateShareResult
import com.porizo.core.model.DeviceRegistration
import com.porizo.core.model.EnrollmentSession
import com.porizo.core.model.GoogleReceiptResult
import com.porizo.core.model.JobStatus
import com.porizo.core.model.PendingRender
import com.porizo.core.model.PhoneRegisterResult
import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo
import com.porizo.core.model.PoemSummary
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.model.RenderFullResult
import com.porizo.core.model.RenderPreviewResult
import com.porizo.core.model.SendPhoneCodeResult
import com.porizo.core.model.ShareClaimResult
import com.porizo.core.model.ShareInfo
import com.porizo.core.model.ShareStreamResult
import com.porizo.core.model.SocialAuthResult
import com.porizo.core.model.StoryGuidance
import com.porizo.core.model.StoryLyrics
import com.porizo.core.model.StoryToPoemResult
import com.porizo.core.model.StoryToTrackResult
import com.porizo.core.model.SubscriptionPlan
import com.porizo.core.model.SubscriptionStatus
import com.porizo.core.model.TrackDetail
import com.porizo.core.model.TrackSummary
import com.porizo.core.model.UploadUrl
import com.porizo.core.model.VerifyPhoneCodeResult
import com.porizo.core.model.VoiceProfile
import com.porizo.core.model.VoiceProfileStatus
import com.porizo.core.network.ChunkUploadedRequestDto
import com.porizo.core.network.ClaimShareRequestDto
import com.porizo.core.network.CompleteEnrollmentRequestDto
import com.porizo.core.network.ContinueStoryRequestDto
import com.porizo.core.network.CreateShareRequestDto
import com.porizo.core.network.DeviceRegisterRequestDto
import com.porizo.core.network.EnrollmentStartRequestDto
import com.porizo.core.network.ErrorEnvelopeDto
import com.porizo.core.network.GoogleReceiptRequestDto
import com.porizo.core.network.NetworkErrorMapper
import com.porizo.core.network.PhoneRegisterRequestDto
import com.porizo.core.network.PorizoApiService
import com.porizo.core.network.PorizoNetworkClient
import com.porizo.core.network.ReceiverClaimRequestDto
import com.porizo.core.network.RefreshRequestDto
import com.porizo.core.network.SendPhoneCodeRequestDto
import com.porizo.core.network.SocialLoginRequestDto
import com.porizo.core.network.StartStoryRequestDto
import com.porizo.core.network.StoryGuidanceDto
import com.porizo.core.network.StoryToTrackRequestDto
import com.porizo.core.network.VerifyPhoneCodeRequestDto
import com.porizo.core.network.toModel
import com.squareup.moshi.Moshi
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response

private suspend fun <T> networkCall(
    errorMapper: NetworkErrorMapper,
    block: suspend () -> T,
): T =
    try {
        block()
    } catch (error: Throwable) {
        throw errorMapper.map(error)
    }

class DefaultAuthRepository(
    private val service: PorizoApiService,
    private val sessionStore: AndroidSessionStore,
    private val platform: String,
    private val appVersion: String,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : AuthRepository {
    override suspend fun restoreSession(): AuthSession? = sessionStore.loadAuthSession()

    override suspend fun saveSession(session: AuthSession) {
        sessionStore.saveAuthSession(session)
    }

    override suspend fun clearSession() {
        sessionStore.clearAuthSession()
        sessionStore.clearDeviceToken()
    }

    override suspend fun currentUser(): AuthUser =
        networkCall(errorMapper) { service.getMe().toModel() }

    override suspend fun sendPhoneVerificationCode(phoneNumber: String): SendPhoneCodeResult =
        networkCall(errorMapper) {
            service.sendPhoneVerificationCode(SendPhoneCodeRequestDto(phoneNumber)).toModel()
        }

    override suspend fun verifyPhoneCode(phoneNumber: String, code: String): VerifyPhoneCodeResult =
        networkCall(errorMapper) {
            service.verifyPhoneCode(VerifyPhoneCodeRequestDto(phoneNumber, code)).toModel()
                .also { result ->
                    val userId = result.userId
                    val access = result.accessToken
                    val refresh = result.refreshToken
                    if (userId != null && access != null && refresh != null) {
                        sessionStore.saveAuthSession(AuthSession(userId, access, refresh, DEFAULT_EXPIRES_IN))
                        sessionStore.clearDeviceToken()
                    }
                }
        }

    override suspend fun registerPhoneAccount(
        registrationToken: String,
        phoneNumber: String,
    ): PhoneRegisterResult =
        networkCall(errorMapper) {
            val result = service.registerPhoneAccount(
                PhoneRegisterRequestDto(registrationToken, phoneNumber),
            ).toModel()
            val userId = result.userId
            val access = result.accessToken
            val refresh = result.refreshToken
            if (userId != null && access != null && refresh != null) {
                sessionStore.saveAuthSession(AuthSession(userId, access, refresh, result.expiresInSeconds ?: DEFAULT_EXPIRES_IN))
                sessionStore.clearDeviceToken()
                result
            } else if (result.accountExists == true) {
                val methods = result.authMethods?.joinToString(", ") ?: "another sign-in method"
                throw PorizoFailure.Server(
                    status = 409,
                    code = "ACCOUNT_EXISTS",
                    message = "This phone matches an existing account. Sign in with $methods.",
                )
            } else {
                throw PorizoFailure.Unknown("Phone registration did not include auth tokens.")
            }
        }

    override suspend fun socialLogin(
        provider: String,
        idToken: String,
        name: String?,
        confirmLink: Boolean,
    ): SocialAuthResult =
        networkCall(errorMapper) {
            service.socialLogin(
                SocialLoginRequestDto(provider, idToken, name, confirmLink.takeIf { it }),
            ).toModel().also { result ->
                val userId = result.userId
                val access = result.accessToken
                val refresh = result.refreshToken
                if (userId != null && access != null && refresh != null) {
                    sessionStore.saveAuthSession(AuthSession(userId, access, refresh, result.expiresInSeconds ?: DEFAULT_EXPIRES_IN))
                    sessionStore.clearDeviceToken()
                }
            }
        }

    override suspend fun refresh(refreshToken: String): RefreshTokenResult =
        networkCall(errorMapper) {
            service.refresh(RefreshRequestDto(refreshToken)).toModel().also { result ->
                val existing = sessionStore.loadAuthSession()
                sessionStore.saveAuthSession(
                    AuthSession(
                        userId = existing?.userId.orEmpty(),
                        accessToken = result.accessToken,
                        refreshToken = result.refreshToken,
                        expiresInSeconds = result.expiresInSeconds ?: DEFAULT_EXPIRES_IN,
                    ),
                )
            }
        }

    override suspend fun logout() {
        runCatching { service.logout() }
        clearSession()
    }

    override suspend fun registerDevice(): DeviceRegistration =
        networkCall(errorMapper) {
            service.registerDevice(
                DeviceRegisterRequestDto(
                    deviceId = sessionStore.getOrCreateDeviceId(),
                    platform = platform,
                    appVersion = appVersion,
                    pushToken = null,
                ),
            ).toModel().also { sessionStore.saveDeviceToken(it.deviceToken, it.expiresAt) }
        }

    private companion object {
        const val DEFAULT_EXPIRES_IN = 3600
    }
}

class DefaultCreateRepository(
    private val service: PorizoApiService,
    private val moshi: Moshi = PorizoNetworkClient.moshi(),
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(moshi),
) : CreateRepository {
    private val guidanceAdapter = moshi.adapter(StoryGuidanceDto::class.java)
    private val errorAdapter = moshi.adapter(ErrorEnvelopeDto::class.java)

    override suspend fun startStory(
        initialPrompt: String,
        occasion: String,
        recipientName: String,
    ): StartStoryResult =
        networkCall(errorMapper) {
            val response = service.startStory(StartStoryRequestDto(initialPrompt, occasion, recipientName))
            StartStoryResult(response.storyId, response.question, response.sessionVersion)
        }

    override suspend fun continueStory(
        storyId: String,
        answer: String,
        expectedSessionVersion: Int?,
    ): ContinueStoryResult =
        networkCall(errorMapper) {
            val response = service.continueStory(storyId, ContinueStoryRequestDto(answer, expectedSessionVersion))
            ContinueStoryResult(
                question = response.question,
                sessionVersion = response.sessionVersion,
                canFinish = response.canFinish,
                isComplete = response.isComplete,
            )
        }

    override suspend fun confirmStory(storyId: String): ConfirmStoryResult =
        networkCall(errorMapper) {
            val response = service.confirmStory(storyId)
            when {
                response.isSuccessful -> ConfirmStoryResult.Confirmed
                response.code() == 422 -> ConfirmStoryResult.NeedsInput(parseGuidance(response))
                else -> throw parseResponseFailure(response, "Confirm failed with status ${response.code()}.")
            }
        }

    override suspend fun generateStoryLyrics(storyId: String): StoryLyrics =
        networkCall(errorMapper) { service.generateStoryLyrics(storyId).toModel() }

    override suspend fun storyToTrack(storyId: String, voiceMode: String): StoryToTrackResult =
        networkCall(errorMapper) { service.storyToTrack(storyId, StoryToTrackRequestDto(voiceMode)).toModel() }

    override suspend fun storyToPoem(storyId: String): StoryToPoemResult =
        networkCall(errorMapper) { service.storyToPoem(storyId).toModel() }

    private fun parseGuidance(response: Response<*>): StoryGuidance {
        val body = response.errorBody()?.string().orEmpty()
        return runCatching { guidanceAdapter.fromJson(body)?.toModel() }.getOrNull()
            ?: StoryGuidance(message = "A little more detail will help.", question = null)
    }

    private fun parseResponseFailure(response: Response<*>, fallback: String): PorizoFailure.Server {
        val envelope = runCatching {
            response.errorBody()?.string()?.takeIf { it.isNotBlank() }?.let { errorAdapter.fromJson(it) }
        }.getOrNull()
        return PorizoFailure.Server(
            status = response.code(),
            code = envelope?.code ?: envelope?.error,
            message = envelope?.message ?: fallback,
        )
    }
}

class DefaultRenderRepository(
    private val service: PorizoApiService,
    private val renderPollStore: RenderPollStore,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : RenderRepository {
    override suspend fun approveLyrics(trackId: String, versionNum: Int): ApproveLyricsResult =
        networkCall(errorMapper) { service.approveLyrics(trackId, versionNum).toModel() }

    override suspend fun renderPreview(trackId: String, versionNum: Int): RenderPreviewResult =
        networkCall(errorMapper) { service.renderPreview(trackId, versionNum).toModel() }

    override suspend fun renderFull(trackId: String, versionNum: Int): RenderFullResult =
        networkCall(errorMapper) { service.renderFull(trackId, versionNum).toModel() }

    override suspend fun retryPreview(trackId: String, versionNum: Int): RenderPreviewResult =
        networkCall(errorMapper) { service.retryPreview(trackId, versionNum).toModel() }

    override suspend fun getJobStatus(jobId: String): JobStatus =
        networkCall(errorMapper) { service.getJobStatus(jobId).toModel() }

    override suspend fun getTrack(trackId: String): TrackDetail =
        networkCall(errorMapper) { service.getTrack(trackId).toModel() }

    override suspend fun loadPendingRender(): PendingRender? = renderPollStore.load()

    override suspend fun savePendingRender(render: PendingRender) {
        renderPollStore.save(render)
    }

    override suspend fun clearPendingRender() {
        renderPollStore.clear()
    }
}

class DefaultLibraryRepository(
    private val service: PorizoApiService,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : LibraryRepository {
    override suspend fun tracks(): List<TrackSummary> =
        networkCall(errorMapper) { service.getTracks(limit = 50, offset = 0).tracks.map { it.toModel() } }

    override suspend fun track(trackId: String): TrackDetail =
        networkCall(errorMapper) { service.getTrack(trackId).toModel() }

    override suspend fun deleteTrack(trackId: String) {
        networkCall(errorMapper) {
            val response = service.deleteTrack(trackId)
            if (!response.isSuccessful) {
                throw PorizoFailure.Server(
                    status = response.code(),
                    code = null,
                    message = "Track delete failed with status ${response.code()}.",
                )
            }
        }
    }

    override suspend fun poems(): List<PoemSummary> =
        networkCall(errorMapper) { service.getPoems().poems.map { it.toModel() } }

    override suspend fun deletePoem(poemId: String) {
        networkCall(errorMapper) {
            val response = service.deletePoem(poemId)
            if (!response.isSuccessful) {
                throw PorizoFailure.Server(
                    status = response.code(),
                    code = null,
                    message = "Poem delete failed with status ${response.code()}.",
                )
            }
        }
    }

    override suspend fun poemAudio(poemId: String): String? =
        networkCall(errorMapper) { service.generatePoemAudio(poemId).audioUrl ?: "/poems/$poemId/audio" }
}

class DefaultShareRepository(
    private val service: PorizoApiService,
    private val sessionStore: AndroidSessionStore,
    private val authRepository: AuthRepository,
    private val platform: String,
    private val appVersion: String,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : ShareRepository {
    override suspend fun createTrackShare(trackId: String, versionNum: Int, requirePin: Boolean): CreateShareResult =
        networkCall(errorMapper) {
            service.createShare(trackId, CreateShareRequestDto(requirePin, versionNum)).toModel()
        }

    override suspend fun createPoemShare(poemId: String): CreateShareResult =
        networkCall(errorMapper) { service.createPoemShare(poemId).toModel() }

    override suspend fun shareInfo(shareId: String): ShareInfo =
        networkCall(errorMapper) {
            service.getShareInfo(
                shareId = shareId,
                deviceId = sessionStore.getOrCreateDeviceId(),
                deviceToken = sessionStore.currentDeviceToken(),
            ).toModel()
        }

    override suspend fun claimShare(shareId: String, pin: String?): ShareClaimResult =
        networkCall(errorMapper) {
            service.claimShare(
                shareId = shareId,
                deviceToken = ensureDeviceToken(),
                body = ClaimShareRequestDto(pin.cleanPin(), appVersion),
            ).toModel()
        }

    override suspend fun shareStream(shareId: String): ShareStreamResult =
        networkCall(errorMapper) {
            service.getShareStream(
                shareId = shareId,
                deviceId = sessionStore.getOrCreateDeviceId(),
                platform = platform,
                deviceToken = ensureDeviceToken(),
            ).toModel()
        }

    override suspend fun poemShareInfo(shareId: String): PoemShareInfo =
        networkCall(errorMapper) { service.getPoemShareInfo(shareId).toModel() }

    override suspend fun poemShareBody(shareId: String): PoemBody? =
        poemShareInfo(shareId).poem

    override suspend fun claimPoemShare(shareId: String, pin: String?): ShareClaimResult =
        networkCall(errorMapper) {
            service.claimPoemShare(shareId, ClaimShareRequestDto(pin.cleanPin(), null)).toModel()
        }

    override suspend fun resolveReceiverHandoff(handoffId: String) =
        networkCall(errorMapper) { service.resolveReceiverHandoff(handoffId).toModel() }

    override suspend fun claimReceiverToken(claimToken: String, pin: String?): ShareClaimResult =
        networkCall(errorMapper) {
            service.claimReceiverToken(
                claimToken = claimToken,
                deviceToken = ensureDeviceToken(),
                body = ReceiverClaimRequestDto(
                    deviceId = sessionStore.getOrCreateDeviceId(),
                    platform = platform,
                    appVersion = appVersion,
                    pin = pin.cleanPin(),
                ),
            ).toModel()
        }

    private suspend fun ensureDeviceToken(): String =
        sessionStore.currentDeviceToken() ?: authRepository.registerDevice().deviceToken

    private fun String?.cleanPin(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
}

class DefaultBillingRepository(
    private val service: PorizoApiService,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : BillingRepository {
    override suspend fun entitlements(): BillingEntitlements =
        networkCall(errorMapper) { service.getBillingEntitlements().toModel() }

    override suspend fun plans(): List<SubscriptionPlan> =
        networkCall(errorMapper) { service.getBillingPlans().plans.map { it.toModel() } }

    override suspend fun subscriptionStatus(): SubscriptionStatus =
        networkCall(errorMapper) { service.getSubscriptionStatus().toModel() }

    override suspend fun submitGoogleReceipt(productId: String, purchaseToken: String): GoogleReceiptResult =
        networkCall(errorMapper) {
            service.validateGoogleSubscription(GoogleReceiptRequestDto(purchaseToken, productId)).toModel()
        }
}

class DefaultPushRepository(
    private val service: PorizoApiService,
    private val sessionStore: AndroidSessionStore,
    private val platform: String,
    private val appVersion: String,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : PushRepository {
    override suspend fun registerPushToken(token: String) {
        networkCall(errorMapper) {
            service.registerDevice(
                DeviceRegisterRequestDto(
                    deviceId = sessionStore.getOrCreateDeviceId(),
                    platform = platform,
                    appVersion = appVersion,
                    pushToken = token,
                ),
            ).toModel().also { sessionStore.saveDeviceToken(it.deviceToken, it.expiresAt) }
        }
    }

    override suspend fun clearPushToken() {
        sessionStore.clearDeviceToken()
    }
}

class DefaultVoiceEnrollmentRepository(
    private val service: PorizoApiService,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
) : VoiceEnrollmentRepository {
    override suspend fun startEnrollment(): EnrollmentSession =
        networkCall(errorMapper) {
            service.startEnrollment(
                EnrollmentStartRequestDto(
                    consentAccepted = true,
                    consentVersion = "android_v1",
                    consentScopes = listOf("voice_suno_persona_v1"),
                    voiceSunoPersonaConsent = true,
                ),
            ).toModel()
        }

    override suspend fun uploadChunk(
        sessionId: String,
        uploadUrl: UploadUrl,
        bytes: ByteArray,
        contentType: String,
        durationSec: Double,
        checksum: String?,
    ): ChunkUploadResult =
        networkCall(errorMapper) {
            val mediaType = contentType.toMediaType()
            val uploadResponse = service.uploadEnrollmentChunk(
                uploadUrl = uploadUrl.url,
                headers = uploadUrl.headers.orEmpty(),
                body = bytes.toRequestBody(mediaType),
            )
            if (!uploadResponse.isSuccessful) {
                throw PorizoFailure.Server(
                    status = uploadResponse.code(),
                    code = "UPLOAD_FAILED",
                    message = "Audio upload failed with status ${uploadResponse.code()}.",
                )
            }
            service.completeChunkUpload(
                ChunkUploadedRequestDto(
                    sessionId = sessionId,
                    chunkId = uploadUrl.chunkId,
                    durationSec = durationSec,
                    clientChecksum = checksum,
                ),
            ).toModel()
        }

    override suspend fun createVoiceProfile(sessionId: String): VoiceProfile =
        networkCall(errorMapper) {
            service.completeEnrollment(
                CompleteEnrollmentRequestDto(
                    sessionId = sessionId,
                    consentScopes = listOf("voice_suno_persona_v1"),
                    voiceSunoPersonaConsent = true,
                ),
            ).toModel()
        }

    override suspend fun voiceProfileStatus(): VoiceProfileStatus =
        networkCall(errorMapper) { service.getVoiceProfile().toModel() }
}
