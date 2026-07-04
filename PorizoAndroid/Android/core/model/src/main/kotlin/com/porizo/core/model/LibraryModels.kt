package com.porizo.core.model

data class TrackSummary(
    val id: String,
    val title: String,
    val occasion: String?,
    val recipientName: String?,
    val status: String,
    val latestVersion: Int?,
    val shareTokenId: String?,
    val artworkUrl: String?,
    val libraryOrigin: String?,
    val canShare: Boolean?,
    val canDelete: Boolean?,
) {
    val isReceived: Boolean
        get() = libraryOrigin == "received"
}

data class TrackVersion(
    val id: String,
    val versionNum: Int,
    val status: String,
    val previewUrl: String?,
    val fullUrl: String?,
    val previewJobId: String?,
    val fullJobId: String?,
    val lastErrorCode: String?,
    val lastErrorMessage: String?,
) {
    val playableUrl: String?
        get() = fullUrl ?: previewUrl
}

data class TrackDetail(
    val track: TrackSummary,
    val versions: List<TrackVersion>,
)

data class PoemSummary(
    val id: String,
    val title: String,
    val recipientName: String,
    val occasion: String,
    val tone: String,
    val status: String,
    val verses: List<String>,
    val libraryOrigin: String?,
) {
    val isReceived: Boolean
        get() = libraryOrigin == "received"
}

data class PoemBody(
    val id: String?,
    val title: String?,
    val recipientName: String?,
    val verses: List<String>?,
    val previewLines: List<String>?,
)

data class PlayableTrack(
    val id: String,
    val title: String,
    val recipientName: String?,
    val artworkUrl: String?,
    val streamUrl: String,
    val isOwnedContent: Boolean,
    val requiresAuthorization: Boolean = isOwnedContent,
    val requiresDeviceToken: Boolean = false,
)
