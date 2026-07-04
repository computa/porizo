package com.porizo.feature.claim

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.claim.ClaimLogic
import com.porizo.core.domain.claim.PoemClaimLogic
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.media.PorizoPlayer
import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.PorizoFailure
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class ClaimViewModel @Inject constructor(
    private val shareRepository: ShareRepository,
    private val authRepository: AuthRepository,
    private val player: PorizoPlayer,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ClaimUiState())
    val uiState: StateFlow<ClaimUiState> = _uiState.asStateFlow()

    fun open(route: DeepLinkRoute) {
        when (route) {
            is DeepLinkRoute.Share -> loadShare(route.id)
            is DeepLinkRoute.PoemShare -> loadPoemShare(route.id)
            is DeepLinkRoute.ReceiverHandoff -> loadReceiverHandoff(route.id)
            else -> Unit
        }
    }

    fun updatePin(value: String) {
        _uiState.update { it.copy(pin = value.filter(Char::isDigit).take(MAX_PIN_LENGTH)) }
    }

    fun playPreview() {
        val state = uiState.value
        val url = state.previewUrl?.takeIf { it.isNotBlank() } ?: return
        player.play(
            PlayableTrack(
                id = state.shareId ?: "share-preview",
                title = state.title ?: "Shared gift",
                recipientName = null,
                artworkUrl = null,
                streamUrl = url,
                isOwnedContent = false,
            ),
        )
    }

    fun claim() {
        val state = uiState.value
        viewModelScope.launch {
            _uiState.update { it.copy(phase = ClaimPhase.Claiming) }
            runCatching {
                when (state.kind) {
                    ClaimKind.TrackShare -> claimWithRetry {
                        shareRepository.claimShare(requireNotNull(state.shareId), state.pin)
                    }
                    ClaimKind.PoemShare -> claimWithRetry {
                        shareRepository.claimPoemShare(requireNotNull(state.shareId), state.pin)
                    }
                    ClaimKind.ReceiverHandoff -> claimWithRetry {
                        shareRepository.claimReceiverToken(requireNotNull(state.receiverClaimToken), state.pin)
                    }
                    null -> error("No claim is active.")
                }
            }
                .onSuccess {
                    _uiState.update { it.copy(phase = ClaimPhase.Claimed, pin = "") }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(phase = ClaimPhase.Failed(error.userMessage())) }
                }
        }
    }

    fun dismiss() {
        _uiState.value = ClaimUiState()
    }

    private fun loadShare(shareId: String) {
        viewModelScope.launch {
            _uiState.value = ClaimUiState(phase = ClaimPhase.Loading, kind = ClaimKind.TrackShare, shareId = shareId)
            runCatching { shareRepository.shareInfo(shareId) }
                .onSuccess { info ->
                    val state = ClaimLogic.stateFor(info)
                    _uiState.value = when (state) {
                        is ClaimLogic.State.Claimable -> ClaimUiState(
                            phase = ClaimPhase.Preview,
                            kind = ClaimKind.TrackShare,
                            shareId = shareId,
                            title = info.track?.title ?: info.trackPreview?.title ?: "Shared song",
                            subtitle = info.track?.recipientName ?: info.trackPreview?.recipientName,
                            previewUrl = ClaimLogic.previewUrl(info),
                            needsPin = state.needsPin,
                        )
                        ClaimLogic.State.Claimed -> ClaimUiState(
                            phase = ClaimPhase.Claimed,
                            kind = ClaimKind.TrackShare,
                            shareId = shareId,
                            title = info.track?.title ?: info.trackPreview?.title,
                        )
                        ClaimLogic.State.Unavailable -> ClaimUiState(
                            phase = ClaimPhase.Unavailable,
                            kind = ClaimKind.TrackShare,
                            shareId = shareId,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.value = ClaimUiState(
                        phase = ClaimPhase.Failed(error.userMessage()),
                        kind = ClaimKind.TrackShare,
                        shareId = shareId,
                    )
                }
        }
    }

    private fun loadPoemShare(shareId: String) {
        viewModelScope.launch {
            _uiState.value = ClaimUiState(phase = ClaimPhase.Loading, kind = ClaimKind.PoemShare, shareId = shareId)
            runCatching { shareRepository.poemShareInfo(shareId) }
                .onSuccess { info ->
                    val state = PoemClaimLogic.stateFor(info)
                    _uiState.value = when (state) {
                        is ClaimLogic.State.Claimable -> ClaimUiState(
                            phase = ClaimPhase.Preview,
                            kind = ClaimKind.PoemShare,
                            shareId = shareId,
                            title = info.poem?.title ?: "Shared poem",
                            subtitle = info.poem?.recipientName,
                            poemVerses = PoemClaimLogic.verses(info),
                            needsPin = state.needsPin,
                        )
                        ClaimLogic.State.Claimed -> ClaimUiState(
                            phase = ClaimPhase.Claimed,
                            kind = ClaimKind.PoemShare,
                            shareId = shareId,
                            title = info.poem?.title,
                        )
                        ClaimLogic.State.Unavailable -> ClaimUiState(
                            phase = ClaimPhase.Unavailable,
                            kind = ClaimKind.PoemShare,
                            shareId = shareId,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.value = ClaimUiState(
                        phase = ClaimPhase.Failed(error.userMessage()),
                        kind = ClaimKind.PoemShare,
                        shareId = shareId,
                    )
                }
        }
    }

    private fun loadReceiverHandoff(handoffId: String) {
        viewModelScope.launch {
            _uiState.value = ClaimUiState(phase = ClaimPhase.Loading, kind = ClaimKind.ReceiverHandoff)
            runCatching { shareRepository.resolveReceiverHandoff(handoffId) }
                .onSuccess { handoff ->
                    _uiState.value = ClaimUiState(
                        phase = ClaimPhase.Preview,
                        kind = ClaimKind.ReceiverHandoff,
                        receiverClaimToken = handoff.receiverClaimToken,
                        title = "Claim ${handoff.contentKind}",
                        subtitle = "Save this gift to your app on this device.",
                    )
                }
                .onFailure { error ->
                    _uiState.value = ClaimUiState(
                        phase = ClaimPhase.Failed(error.userMessage()),
                        kind = ClaimKind.ReceiverHandoff,
                    )
                }
        }
    }

    private suspend fun <T> claimWithRetry(block: suspend () -> T): T =
        try {
            block()
        } catch (error: Throwable) {
            if (!ClaimLogic.shouldReregisterAndRetry(error)) throw error
            authRepository.registerDevice()
            block()
        }

    private fun Throwable.userMessage(): String =
        when (this) {
            is PorizoFailure -> message ?: "Something went wrong."
            else -> message ?: "Something went wrong."
        }

    private companion object {
        const val MAX_PIN_LENGTH = 12
    }
}
