package com.porizo.core.model

data class ShareTrackInfo(
    val title: String?,
    val recipientName: String?,
    val senderName: String?,
    val durationSec: Int?,
    val coverImageUrl: String?,
    val artworkUrl: String?,
)

data class CreateShareResult(
    val shareId: String,
    val shareUrl: String,
    val claimPin: String?,
    val expiresAt: String?,
)

data class ShareInfo(
    val status: String,
    val appOnly: Boolean?,
    val canAccess: Boolean?,
    val appRequired: Boolean?,
    val claimRequiresApp: Boolean?,
    val pinRequiredForClaim: Boolean?,
    val receiverSaveRequiresSession: Boolean?,
    val track: ShareTrackInfo?,
    val trackPreview: ShareTrackInfo?,
    val webStreamUrl: String?,
    val appDownloadUrl: String?,
    val isDemo: Boolean?,
)

data class ShareClaimResult(
    val status: String,
    val appSaveAllowed: Boolean?,
    val expiresAt: String?,
    val trackId: String? = null,
    val trackVersionId: String? = null,
    val streamPath: String? = null,
    val receiverClaimStreamPath: String? = null,
)

data class ReceiverHandoffResult(
    val receiverSessionId: String,
    val contentKind: String,
    val receiverClaimToken: String,
    val receiverClaimExpiresAt: String?,
)

data class ShareStreamResult(
    val streamUrl: String,
    val format: String?,
    val keyUrl: String?,
    val expiresAt: String?,
)

data class PoemShareInfo(
    val status: String,
    val canAccess: Boolean?,
    val poem: PoemBody?,
    val requiresPin: Boolean?,
    val requiresPinForClaim: Boolean?,
)
