package com.porizo.core.network

import com.porizo.core.model.ApproveLyricsResult
import com.porizo.core.model.AuthUser
import com.porizo.core.model.BillingEntitlements
import com.porizo.core.model.ChunkUploadResult
import com.porizo.core.model.CreateShareResult
import com.porizo.core.model.CreateTrackRequest
import com.porizo.core.model.CreateTrackResult
import com.porizo.core.model.CreateVersionResult
import com.porizo.core.model.DeviceRegistration
import com.porizo.core.model.EnrollmentPrompt
import com.porizo.core.model.EnrollmentQuality
import com.porizo.core.model.EnrollmentSession
import com.porizo.core.model.GoogleReceiptResult
import com.porizo.core.model.GoogleSubscriptionSummary
import com.porizo.core.model.JobStatus
import com.porizo.core.model.LyricsDocument
import com.porizo.core.model.LyricsSection
import com.porizo.core.model.PhoneRegisterResult
import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo
import com.porizo.core.model.PoemSummary
import com.porizo.core.model.RecordingSettings
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.model.RenderFullResult
import com.porizo.core.model.RenderPreviewResult
import com.porizo.core.model.SendPhoneCodeResult
import com.porizo.core.model.ShareClaimResult
import com.porizo.core.model.ShareInfo
import com.porizo.core.model.ShareStreamResult
import com.porizo.core.model.ShareTrackInfo
import com.porizo.core.model.SocialAuthResult
import com.porizo.core.model.StoryGuidance
import com.porizo.core.model.StoryLyrics
import com.porizo.core.model.StoryToPoemResult
import com.porizo.core.model.StoryToTrackResult
import com.porizo.core.model.SubscriptionPlan
import com.porizo.core.model.SubscriptionPlanProductIds
import com.porizo.core.model.SubscriptionStatus
import com.porizo.core.model.SubscriptionStatusSummary
import com.porizo.core.model.TrackDetail
import com.porizo.core.model.TrackSummary
import com.porizo.core.model.TrackVersion
import com.porizo.core.model.UploadUrl
import com.porizo.core.model.VerifyPhoneCodeResult
import com.porizo.core.model.VoiceProfile
import com.porizo.core.model.VoiceProfileStatus

fun CreateTrackRequest.toDto() = CreateTrackRequestDto(
    title = title,
    occasion = occasion,
    recipientName = recipientName,
    style = style,
    durationTarget = durationTarget,
    voiceMode = voiceMode,
    message = message,
    specificMemory = specificMemory,
    specialPhrases = specialPhrases,
    whatMakesThemSpecial = whatMakesThemSpecial,
)

fun PhoneRegisterDto.toModel() = PhoneRegisterResult(
    userId = userId,
    accessToken = accessToken,
    refreshToken = refreshToken,
    expiresInSeconds = expiresIn,
    accountExists = accountExists,
    authMethods = authMethods,
    maskedEmail = maskedEmail,
    maskedPhone = maskedPhone,
)

fun SendPhoneCodeDto.toModel() = SendPhoneCodeResult(success, expiresAt, maskedPhone)

fun VerifyPhoneCodeDto.toModel() = VerifyPhoneCodeResult(
    success = success,
    verified = verified,
    registrationToken = registrationToken,
    remainingAttempts = remainingAttempts,
    accessToken = accessToken,
    refreshToken = refreshToken,
    userId = userId,
    isNewUser = isNewUser,
    existingUser = existingUser,
)

fun DeviceRegistrationDto.toModel() = DeviceRegistration(deviceToken, expiresAt)

fun SocialAuthDto.toModel() = SocialAuthResult(
    userId = userId,
    accessToken = accessToken,
    refreshToken = refreshToken,
    expiresInSeconds = expiresIn,
    isNewUser = isNewUser,
    requiresLinkConfirmation = requiresLinkConfirmation,
    existingAccountEmail = existingAccountEmail,
    provider = provider,
)

fun RefreshDto.toModel() = RefreshTokenResult(accessToken, refreshToken, expiresIn)

fun AuthUserDto.toModel() = AuthUser(
    userId = userId,
    email = email,
    displayName = displayName,
    phoneNumber = phoneNumber,
    emailVerified = emailVerified,
    needsProfileCompletion = needsProfileCompletion,
)

fun CreateTrackDto.toModel() = CreateTrackResult(trackId, status)

fun CreateVersionDto.toModel() = CreateVersionResult(trackVersionId, versionNum, status)

fun TrackSummaryDto.toModel() = TrackSummary(
    id = id,
    title = title,
    occasion = occasion,
    recipientName = recipientName,
    status = status,
    latestVersion = latestVersion,
    shareTokenId = shareTokenId,
    artworkUrl = artworkUrl,
    libraryOrigin = libraryOrigin,
    canShare = canShare,
    canDelete = canDelete,
)

fun TrackVersionDto.toModel() = TrackVersion(
    id = id,
    versionNum = versionNum,
    status = status,
    previewUrl = previewUrl,
    fullUrl = fullUrl,
    previewJobId = previewJobId,
    fullJobId = fullJobId,
    lastErrorCode = lastErrorCode,
    lastErrorMessage = lastErrorMessage,
)

fun TrackDetailDto.toModel() = TrackDetail(track = track.toModel(), versions = versions.map { it.toModel() })

fun PoemSummaryDto.toModel() = PoemSummary(
    id = id,
    title = title,
    recipientName = recipientName,
    occasion = occasion,
    tone = tone,
    status = status,
    verses = verses,
    libraryOrigin = libraryOrigin,
)

fun PoemBodyDto.toModel() = PoemBody(id, title, recipientName, verses, previewLines)

fun StoryToPoemDto.toModel() = StoryToPoemResult(poem = poem.toModel())

fun PoemShareInfoDto.toModel() = PoemShareInfo(
    status = status,
    canAccess = canAccess,
    poem = poem?.toModel(),
    requiresPin = requiresPin,
    requiresPinForClaim = requiresPinForClaim,
)

fun StoryGuidanceDto.toModel() = StoryGuidance(message, question)

fun StoryLyricsDto.toModel() = StoryLyrics(lyrics, qualityScore)

fun StoryToTrackDto.toModel() = StoryToTrackResult(trackId, versionNum)

fun ShareTrackInfoDto.toModel() = ShareTrackInfo(
    title = title,
    recipientName = recipientName,
    senderName = senderName,
    durationSec = durationSec,
    coverImageUrl = coverImageUrl,
    artworkUrl = artworkUrl,
)

fun CreateShareDto.toModel() = CreateShareResult(shareId, shareUrl, claimPin, expiresAt)

fun ShareInfoDto.toModel() = ShareInfo(
    status = status,
    appOnly = appOnly,
    canAccess = canAccess,
    appRequired = appRequired,
    claimRequiresApp = claimRequiresApp,
    pinRequiredForClaim = pinRequiredForClaim,
    receiverSaveRequiresSession = receiverSaveRequiresSession,
    track = track?.toModel(),
    trackPreview = trackPreview?.toModel(),
    webStreamUrl = webStreamUrl,
    appDownloadUrl = appDownloadUrl,
    isDemo = isDemo,
)

fun ShareClaimDto.toModel() = ShareClaimResult(
    status = status,
    appSaveAllowed = appSaveAllowed,
    expiresAt = expiresAt,
    trackId = trackId,
    trackVersionId = trackVersionId,
    streamPath = streamPath,
    receiverClaimStreamPath = receiverClaimStreamPath,
)

fun ReceiverHandoffDto.toModel() = com.porizo.core.model.ReceiverHandoffResult(
    receiverSessionId,
    contentKind,
    receiverClaimToken,
    receiverClaimExpiresAt,
)

fun ShareStreamDto.toModel() = ShareStreamResult(streamUrl, format, keyUrl, expiresAt)

fun RenderPreviewDto.toModel() = RenderPreviewResult(jobId, estimatedCompletionSec, pollUrl)

fun RenderFullDto.toModel() = RenderFullResult(jobId, estimatedCompletionSec)

fun ApproveLyricsDto.toModel() = ApproveLyricsResult(status)

fun LyricsDocumentDto.toModel() = LyricsDocument(
    title = title,
    style = style,
    sections = sections.map { it.toModel() },
    anchorLine = anchorLine,
)

fun LyricsSectionDto.toModel() = LyricsSection(
    name = name,
    lines = lines,
    startTime = startTime,
    endTime = endTime,
)

fun LyricsDocument.toDto() = LyricsDocumentDto(
    title = title,
    style = style,
    sections = sections.map { it.toDto() },
    anchorLine = anchorLine,
)

fun LyricsSection.toDto() = LyricsSectionDto(
    name = name,
    lines = lines,
    startTime = startTime,
    endTime = endTime,
)

fun JobStatusDto.toModel() = JobStatus(
    id = id,
    status = status,
    progress = progress,
    resultUrl = resultUrl,
    errorCode = errorCode,
    errorMessage = errorMessage,
    errorTerms = errorTerms,
    errorCategory = errorCategory,
    errorSubcategory = errorSubcategory,
    canAutoRewrite = canAutoRewrite,
    suggestedAction = suggestedAction,
    provider = provider,
    step = step,
    stepIndex = stepIndex,
    workflowType = workflowType,
    startedAt = startedAt,
    completedAt = completedAt,
)

fun BillingEntitlementsDto.toModel() = BillingEntitlements(
    tier = tier,
    baseSongsRemaining = baseSongsRemaining,
    songsRemaining = songsRemaining,
    songsAllowance = songsAllowance,
    poemsRemaining = poemsRemaining,
    poemsAllowance = poemsAllowance,
    trialSongsRemaining = trialSongsRemaining,
    giftWalletBalance = giftWalletBalance,
    availableSongCredits = availableSongCredits,
    payPerSongEnabled = payPerSongEnabled,
    giftTokensRemaining = giftTokensRemaining,
    autoRenewEnabled = autoRenewEnabled,
)

fun GoogleSubscriptionSummaryDto.toModel() = GoogleSubscriptionSummary(id, tier, status, expiresAt, autoRenewing)

fun GoogleReceiptDto.toModel() = GoogleReceiptResult(
    success = success,
    subscription = subscription?.toModel(),
    entitlements = entitlements?.toModel(),
)

fun SubscriptionPlanProductIdsDto.toModel() = SubscriptionPlanProductIds(monthly, annual)

fun SubscriptionPlanDto.toModel() = SubscriptionPlan(
    id = id,
    name = name,
    tier = tier,
    songsPerMonth = songsPerMonth,
    poemsPerMonth = poemsPerMonth,
    priceMonthlyCents = priceMonthlyCents,
    priceAnnualCents = priceAnnualCents,
    description = description,
    features = features,
    isActive = isActive,
    sortOrder = sortOrder,
    googleProductIds = googleProductIds?.toModel(),
)

fun SubscriptionStatusSummaryDto.toModel() = SubscriptionStatusSummary(
    id = id,
    tier = tier,
    status = status,
    productId = productId,
    platform = platform,
    expiresAt = expiresAt,
    autoRenewEnabled = autoRenewEnabled,
    isInGracePeriod = isInGracePeriod,
)

fun SubscriptionStatusDto.toModel() = SubscriptionStatus(
    hasActiveSubscription = hasActiveSubscription,
    hasSubscription = hasSubscription,
    subscription = subscription?.toModel(),
    entitlements = entitlements?.toModel(),
)

fun EnrollmentSessionDto.toModel() = EnrollmentSession(
    sessionId = sessionId,
    sessionExpiresAt = sessionExpiresAt,
    prompts = prompts?.map { it.toModel() },
    promptSetId = promptSetId,
    uploadUrls = uploadUrls?.map { it.toModel() },
    recordingSettings = recordingSettings?.toModel(),
)

fun EnrollmentPromptDto.toModel() = EnrollmentPrompt(id, text, type, durationHintSec, pitchHint)

fun UploadUrlDto.toModel() = UploadUrl(chunkId, url, method, headers, expiresAt)

fun RecordingSettingsDto.toModel() = RecordingSettings(sampleRate, channels, format, maxChunkDurationSec)

fun ChunkUploadDto.toModel() = ChunkUploadResult(
    status = status,
    qcJobId = qcJobId,
    nextUploadUrl = nextUploadUrl?.toModel(),
    chunkId = chunkId,
    durationSec = durationSec,
)

fun VoiceProfileDto.toModel() = VoiceProfile(
    voiceProfileId = voiceProfileId,
    qualityScore = qualityScore,
    status = status,
    jobId = jobId,
    estimatedCompletionSec = estimatedCompletionSec,
    outcome = outcome,
    quality = quality?.toModel(),
)

fun EnrollmentQualityDto.toModel() = EnrollmentQuality(
    tier = tier,
    score = score,
    label = label,
    disclosure = disclosure,
    canImprove = canImprove,
    improvementTips = improvementTips,
)

fun VoiceProfileStatusDto.toModel() = VoiceProfileStatus(
    profileId = profileId,
    status = status,
    qualityScore = qualityScore,
    qualityTier = qualityTier,
    createdAt = createdAt,
    myVoiceReady = myVoiceReady,
)
