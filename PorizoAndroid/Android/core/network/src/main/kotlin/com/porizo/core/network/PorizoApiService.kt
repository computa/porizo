package com.porizo.core.network

import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.DELETE
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.HeaderMap
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Url

interface PorizoApiService {
    @POST("auth/phone/send-code")
    suspend fun sendPhoneVerificationCode(@Body body: SendPhoneCodeRequestDto): SendPhoneCodeDto

    @POST("auth/phone/verify")
    suspend fun verifyPhoneCode(@Body body: VerifyPhoneCodeRequestDto): VerifyPhoneCodeDto

    @POST("auth/phone/register")
    suspend fun registerPhoneAccount(@Body body: PhoneRegisterRequestDto): PhoneRegisterDto

    @POST("auth/social")
    suspend fun socialLogin(@Body body: SocialLoginRequestDto): SocialAuthDto

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequestDto): RefreshDto

    @GET("auth/me")
    suspend fun getMe(): AuthUserDto

    @POST("auth/logout")
    suspend fun logout(): Response<Unit>

    @POST("device/register")
    suspend fun registerDevice(@Body body: DeviceRegisterRequestDto): DeviceRegistrationDto

    @GET("tracks")
    suspend fun getTracks(@Query("limit") limit: Int, @Query("offset") offset: Int): TracksDto

    @GET("tracks/{trackId}")
    suspend fun getTrack(@Path("trackId") trackId: String): TrackDetailDto

    @DELETE("tracks/{trackId}")
    suspend fun deleteTrack(@Path("trackId") trackId: String): Response<Unit>

    @POST("tracks")
    suspend fun createTrack(@Body body: CreateTrackRequestDto): CreateTrackDto

    @POST("tracks/{trackId}/versions")
    suspend fun createVersion(
        @Path("trackId") trackId: String,
        @Body body: CreateVersionRequestDto,
    ): CreateVersionDto

    @POST("tracks/{trackId}/versions/{versionNum}/render_preview")
    suspend fun renderPreview(
        @Path("trackId") trackId: String,
        @Path("versionNum") versionNum: Int,
        @Body body: Map<String, String> = emptyMap(),
    ): RenderPreviewDto

    @POST("tracks/{trackId}/versions/{versionNum}/render_full")
    suspend fun renderFull(
        @Path("trackId") trackId: String,
        @Path("versionNum") versionNum: Int,
        @Body body: Map<String, String> = emptyMap(),
    ): RenderFullDto

    @POST("tracks/{trackId}/versions/{versionNum}/retry")
    suspend fun retryPreview(
        @Path("trackId") trackId: String,
        @Path("versionNum") versionNum: Int,
        @Body body: Map<String, String> = emptyMap(),
    ): RenderPreviewDto

    @POST("tracks/{trackId}/versions/{versionNum}/lyrics/approve")
    suspend fun approveLyrics(
        @Path("trackId") trackId: String,
        @Path("versionNum") versionNum: Int,
        @Body body: Map<String, String> = emptyMap(),
    ): ApproveLyricsDto

    @GET("tracks/{trackId}/versions/{versionNum}/lyrics")
    suspend fun getLyrics(
        @Path("trackId") trackId: String,
        @Path("versionNum") versionNum: Int,
    ): LyricsWrapperDto

    @PUT("tracks/{trackId}/versions/{versionNum}/lyrics")
    suspend fun updateLyrics(
        @Path("trackId") trackId: String,
        @Path("versionNum") versionNum: Int,
        @Body body: LyricsWrapperDto,
    ): Response<Unit>

    @POST("tracks/{trackId}/share")
    suspend fun createShare(
        @Path("trackId") trackId: String,
        @Body body: CreateShareRequestDto,
    ): CreateShareDto

    @GET("jobs/{jobId}")
    suspend fun getJobStatus(@Path("jobId") jobId: String): JobStatusDto

    @GET("poems")
    suspend fun getPoems(): PoemsDto

    @DELETE("poems/{poemId}")
    suspend fun deletePoem(@Path("poemId") poemId: String): Response<Unit>

    @POST("poems/{poemId}/audio")
    suspend fun generatePoemAudio(
        @Path("poemId") poemId: String,
        @Body body: Map<String, String> = emptyMap(),
    ): PoemAudioDto

    @POST("story/{storyId}/to-poem")
    suspend fun storyToPoem(
        @Path("storyId") storyId: String,
        @Body body: Map<String, String> = emptyMap(),
    ): StoryToPoemDto

    @POST("poems/{poemId}/share")
    suspend fun createPoemShare(
        @Path("poemId") poemId: String,
        @Body body: Map<String, String> = emptyMap(),
    ): CreateShareDto

    @GET("poem-share/{shareId}")
    suspend fun getPoemShareInfo(@Path("shareId") shareId: String): PoemShareInfoDto

    @POST("poem-share/{shareId}/claim")
    suspend fun claimPoemShare(
        @Path("shareId") shareId: String,
        @Header("x-device-token") deviceToken: String?,
        @Body body: ClaimShareRequestDto,
    ): ShareClaimDto

    @GET("share/{shareId}")
    suspend fun getShareInfo(
        @Path("shareId") shareId: String,
        @Header("x-device-id") deviceId: String,
        @Header("x-device-token") deviceToken: String?,
    ): ShareInfoDto

    @POST("share/{shareId}/claim")
    suspend fun claimShare(
        @Path("shareId") shareId: String,
        @Header("x-device-token") deviceToken: String,
        @Body body: ClaimShareRequestDto,
    ): ShareClaimDto

    @GET("receiver-handoff/{handoffId}")
    suspend fun resolveReceiverHandoff(@Path("handoffId") handoffId: String): ReceiverHandoffDto

    @POST("receiver-claim/{claimToken}")
    suspend fun claimReceiverToken(
        @Path("claimToken") claimToken: String,
        @Header("x-device-token") deviceToken: String,
        @Body body: ReceiverClaimRequestDto,
    ): ShareClaimDto

    @GET("receiver-claim/{claimToken}/stream")
    suspend fun getReceiverClaimStream(
        @Path("claimToken") claimToken: String,
        @Header("x-device-token") deviceToken: String,
    ): ShareStreamDto

    @GET("share/{shareId}/stream")
    suspend fun getShareStream(
        @Path("shareId") shareId: String,
        @Header("x-device-id") deviceId: String,
        @Header("x-platform") platform: String,
        @Header("x-device-token") deviceToken: String,
    ): ShareStreamDto

    @GET("billing/entitlements")
    suspend fun getBillingEntitlements(): BillingEntitlementsDto

    @POST("billing/receipt/google")
    suspend fun validateGoogleSubscription(@Body body: GoogleReceiptRequestDto): GoogleReceiptDto

    @POST("billing/receipt/google/consumable")
    suspend fun validateGoogleConsumable(@Body body: GoogleConsumableReceiptRequestDto): GoogleReceiptDto

    @GET("billing/plans")
    suspend fun getBillingPlans(): PlansDto

    @GET("billing/subscription-status")
    suspend fun getSubscriptionStatus(): SubscriptionStatusDto

    @POST("voice/enrollment/start")
    suspend fun startEnrollment(@Body body: EnrollmentStartRequestDto): EnrollmentSessionDto

    @PUT
    suspend fun uploadEnrollmentChunk(
        @Url uploadUrl: String,
        @HeaderMap headers: Map<String, String>,
        @Body body: RequestBody,
    ): Response<ResponseBody>

    @POST("voice/enrollment/chunk_uploaded")
    suspend fun completeChunkUpload(@Body body: ChunkUploadedRequestDto): ChunkUploadDto

    @POST("voice/enrollment/complete")
    suspend fun completeEnrollment(@Body body: CompleteEnrollmentRequestDto): VoiceProfileDto

    @GET("voice/profile")
    suspend fun getVoiceProfile(): VoiceProfileStatusDto

    @POST("story/start")
    suspend fun startStory(@Body body: StartStoryRequestDto): StartStoryDto

    @POST("story/{storyId}/continue")
    suspend fun continueStory(
        @Path("storyId") storyId: String,
        @Body body: ContinueStoryRequestDto,
    ): ContinueStoryDto

    @POST("story/{storyId}/confirm")
    suspend fun confirmStory(
        @Path("storyId") storyId: String,
        @Body body: Map<String, String> = emptyMap(),
    ): Response<ConfirmStoryDto>

    @POST("story/{storyId}/lyrics")
    suspend fun generateStoryLyrics(
        @Path("storyId") storyId: String,
        @Body body: Map<String, String> = emptyMap(),
    ): StoryLyricsDto

    @POST("story/{storyId}/to-track")
    suspend fun storyToTrack(
        @Path("storyId") storyId: String,
        @Body body: StoryToTrackRequestDto,
    ): StoryToTrackDto
}
