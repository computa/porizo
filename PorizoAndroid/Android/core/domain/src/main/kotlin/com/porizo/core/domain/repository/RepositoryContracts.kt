package com.porizo.core.domain.repository

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
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.model.RenderFullResult
import com.porizo.core.model.RenderPreviewResult
import com.porizo.core.model.ReceiverHandoffResult
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

interface AuthRepository {
    suspend fun restoreSession(): AuthSession?
    suspend fun saveSession(session: AuthSession)
    suspend fun clearSession()
    suspend fun currentUser(): AuthUser
    suspend fun sendPhoneVerificationCode(phoneNumber: String): SendPhoneCodeResult
    suspend fun verifyPhoneCode(phoneNumber: String, code: String): VerifyPhoneCodeResult
    suspend fun registerPhoneAccount(registrationToken: String, phoneNumber: String): PhoneRegisterResult
    suspend fun socialLogin(
        provider: String,
        idToken: String,
        name: String?,
        confirmLink: Boolean,
    ): SocialAuthResult
    suspend fun refresh(refreshToken: String): RefreshTokenResult
    suspend fun logout()
    suspend fun registerDevice(): DeviceRegistration
}

sealed interface ConfirmStoryResult {
    data object Confirmed : ConfirmStoryResult
    data class NeedsInput(val guidance: StoryGuidance) : ConfirmStoryResult
}

interface CreateRepository {
    suspend fun startStory(
        initialPrompt: String,
        occasion: String,
        recipientName: String,
    ): StartStoryResult

    suspend fun continueStory(
        storyId: String,
        answer: String,
        expectedSessionVersion: Int?,
    ): ContinueStoryResult

    suspend fun confirmStory(storyId: String): ConfirmStoryResult
    suspend fun generateStoryLyrics(storyId: String): StoryLyrics
    suspend fun storyToTrack(storyId: String, voiceMode: String): StoryToTrackResult
    suspend fun storyToPoem(storyId: String): StoryToPoemResult
}

data class StartStoryResult(
    val storyId: String,
    val question: String?,
    val sessionVersion: Int?,
)

data class ContinueStoryResult(
    val question: String?,
    val sessionVersion: Int?,
    val canFinish: Boolean?,
    val isComplete: Boolean?,
)

interface RenderRepository {
    suspend fun approveLyrics(trackId: String, versionNum: Int): ApproveLyricsResult
    suspend fun renderPreview(trackId: String, versionNum: Int): RenderPreviewResult
    suspend fun renderFull(trackId: String, versionNum: Int): RenderFullResult
    suspend fun retryPreview(trackId: String, versionNum: Int): RenderPreviewResult
    suspend fun getJobStatus(jobId: String): JobStatus
    suspend fun getTrack(trackId: String): TrackDetail
    suspend fun loadPendingRender(): PendingRender?
    suspend fun savePendingRender(render: PendingRender)
    suspend fun clearPendingRender()
}

interface LibraryRepository {
    suspend fun tracks(): List<TrackSummary>
    suspend fun track(trackId: String): TrackDetail
    suspend fun deleteTrack(trackId: String)
    suspend fun poems(): List<PoemSummary>
    suspend fun deletePoem(poemId: String)
    suspend fun poemAudio(poemId: String): String?
}

interface ShareRepository {
    suspend fun createTrackShare(trackId: String, versionNum: Int, requirePin: Boolean): CreateShareResult
    suspend fun createPoemShare(poemId: String): CreateShareResult
    suspend fun shareInfo(shareId: String): ShareInfo
    suspend fun claimShare(shareId: String, pin: String?): ShareClaimResult
    suspend fun shareStream(shareId: String): ShareStreamResult
    suspend fun poemShareInfo(shareId: String): PoemShareInfo
    suspend fun poemShareBody(shareId: String): PoemBody?
    suspend fun claimPoemShare(shareId: String, pin: String?): ShareClaimResult
    suspend fun resolveReceiverHandoff(handoffId: String): ReceiverHandoffResult
    suspend fun claimReceiverToken(claimToken: String, pin: String?): ShareClaimResult
}

interface BillingRepository {
    suspend fun entitlements(): BillingEntitlements
    suspend fun plans(): List<SubscriptionPlan>
    suspend fun subscriptionStatus(): SubscriptionStatus
    suspend fun submitGoogleReceipt(productId: String, purchaseToken: String): GoogleReceiptResult
}

interface PushRepository {
    suspend fun registerPushToken(token: String)
    suspend fun clearPushToken()
}

interface VoiceEnrollmentRepository {
    suspend fun startEnrollment(): EnrollmentSession
    suspend fun uploadChunk(
        sessionId: String,
        uploadUrl: UploadUrl,
        bytes: ByteArray,
        contentType: String,
        durationSec: Double,
        checksum: String?,
    ): ChunkUploadResult
    suspend fun createVoiceProfile(sessionId: String): VoiceProfile
    suspend fun voiceProfileStatus(): VoiceProfileStatus
}
