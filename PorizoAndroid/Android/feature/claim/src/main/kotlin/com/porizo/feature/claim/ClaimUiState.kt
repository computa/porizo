package com.porizo.feature.claim

import com.porizo.core.model.PlayableTrack

sealed interface ClaimPhase {
    data object Idle : ClaimPhase
    data object Loading : ClaimPhase
    data object Preview : ClaimPhase
    data object Claiming : ClaimPhase
    data object Claimed : ClaimPhase
    data object Unavailable : ClaimPhase
    data class Failed(val message: String) : ClaimPhase
}

enum class ClaimKind {
    TrackShare,
    PoemShare,
    ReceiverHandoff,
}

data class ClaimCompletion(
    val kind: ClaimKind,
    val shareId: String?,
    val receiverClaimToken: String?,
    val playableTrack: PlayableTrack? = null,
)

data class ClaimUiState(
    val phase: ClaimPhase = ClaimPhase.Idle,
    val kind: ClaimKind? = null,
    val shareId: String? = null,
    val receiverClaimToken: String? = null,
    val title: String? = null,
    val subtitle: String? = null,
    val previewUrl: String? = null,
    val poemVerses: List<String> = emptyList(),
    val needsPin: Boolean = false,
    val pin: String = "",
) {
    val isVisible: Boolean
        get() = phase != ClaimPhase.Idle
}
