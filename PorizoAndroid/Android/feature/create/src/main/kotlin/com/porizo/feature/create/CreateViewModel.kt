package com.porizo.feature.create

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.porizo.core.domain.create.StoryEngine
import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.render.RenderController
import com.porizo.core.domain.repository.ConfirmStoryResult
import com.porizo.core.domain.repository.CreateRepository
import com.porizo.core.domain.repository.RenderRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.share.ShareDispatchResult
import com.porizo.core.domain.share.ShareDispatcher
import com.porizo.core.model.ContinueStorySignal
import com.porizo.core.model.CreateContentType
import com.porizo.core.model.CreateDraft
import com.porizo.core.model.LyricsDocument
import com.porizo.core.model.LyricsSection
import com.porizo.core.model.Occasion
import com.porizo.core.model.PendingRender
import com.porizo.core.model.PlayableTrack
import com.porizo.core.model.PoemBody
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.RenderResult
import com.porizo.core.model.TrackDetail
import com.porizo.core.model.VoiceSource
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class CreateViewModel @Inject constructor(
    private val createRepository: CreateRepository,
    private val renderRepository: RenderRepository,
    private val shareRepository: ShareRepository,
    private val player: PlayerController,
    private val shareDispatcher: ShareDispatcher,
) : ViewModel() {
    private val _uiState = MutableStateFlow(CreateUiState())
    val uiState: StateFlow<CreateUiState> = _uiState.asStateFlow()

    private var renderJob: Job? = null
    private var pollingFailureCount = 0

    init {
        viewModelScope.launch {
            createRepository.loadDraft()?.let { draft ->
                _uiState.update { state ->
                    state.copy(
                        recipientName = draft.recipientName,
                        recipientPhone = draft.recipientPhone.orEmpty(),
                        occasion = occasionFromApiValue(draft.occasionRawValue),
                        contentType = contentTypeFromApiValue(draft.contentTypeRawValue),
                        voiceSource = voiceSourceFromApiValue(draft.voiceSourceRawValue),
                        tone = draft.tone,
                        message = draft.message,
                        targetDurationSec = draft.targetDuration.toInt().coerceIn(30, 180),
                    )
                }
            }
        }
    }

    fun updateRecipientName(value: String) = updateDraftedState { it.copy(recipientName = value) }

    fun updateRecipientPhone(value: String) = updateDraftedState { it.copy(recipientPhone = value) }

    /// Adopt a contact picked from the system picker: name + phone (enables the
    /// one-tap "Send to {name}" SMS later). Mirrors iOS contact-first entry.
    fun adoptContact(name: String, phone: String?) = updateDraftedState {
        it.copy(recipientName = name, recipientPhone = phone.orEmpty())
    }

    fun updateOccasion(value: Occasion) = updateDraftedState { it.copy(occasion = value) }

    fun updateContentType(value: CreateContentType) = updateDraftedState { it.copy(contentType = value) }

    fun updateVoiceSource(value: VoiceSource) = updateDraftedState { it.copy(voiceSource = value) }

    fun updateTone(value: String) = updateDraftedState { it.copy(tone = value) }

    fun updateMessage(value: String) = updateDraftedState { it.copy(message = value) }

    fun updateDraftAnswer(value: String) {
        _uiState.update { it.copy(draftAnswer = value) }
    }

    fun updateLyricsText(value: String) {
        _uiState.update {
            it.copy(
                lyricsText = value,
                hasUnsavedLyricsChanges = true,
                lyricsSaveMessage = null,
                policyTerms = emptyList(),
                notice = null,
            )
        }
    }

    fun confirmName() {
        if (!_uiState.value.canContinueName) return
        _uiState.update { it.copy(phase = CreatePhase.Details, notice = null) }
    }

    fun backToName() {
        _uiState.update { it.copy(phase = CreatePhase.Name, notice = null) }
    }

    fun startOver() {
        beginNew()
    }

    fun beginNew(
        occasion: Occasion? = null,
        contentType: CreateContentType? = null,
    ) {
        renderJob?.cancel()
        pollingFailureCount = 0
        _uiState.value = CreateUiState(
            occasion = occasion ?: Occasion.Birthday,
            contentType = contentType ?: CreateContentType.Song,
        )
        viewModelScope.launch {
            createRepository.clearDraft()
            renderRepository.clearPendingRender()
        }
    }

    fun beginFromOnboarding(
        recipientName: String,
        occasion: Occasion? = null,
        tone: String? = null,
        message: String? = null,
    ) {
        renderJob?.cancel()
        pollingFailureCount = 0
        val nextState = CreateUiState(
            recipientName = recipientName.trim(),
            occasion = occasion ?: Occasion.Birthday,
            contentType = CreateContentType.Song,
            tone = tone?.trim().orEmpty(),
            message = message?.trim().orEmpty(),
        )
        _uiState.value = nextState
        viewModelScope.launch {
            createRepository.clearDraft()
            renderRepository.clearPendingRender()
            saveDraftSnapshot(nextState)
        }
    }

    fun startConversation() {
        val state = _uiState.value
        if (!state.canContinueName || state.isBusy) return

        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    phase = CreatePhase.Conversation,
                    isBusy = true,
                    notice = null,
                    messages = emptyList(),
                    storyId = null,
                    sessionVersion = null,
                    canFinish = false,
                    userTurns = 0,
                )
            }

            runCatching {
                createRepository.startStory(
                    initialPrompt = state.initialPrompt(),
                    occasion = state.occasion.apiValue,
                    recipientName = state.recipientName.trim(),
                )
            }.onSuccess { response ->
                _uiState.update {
                    it.copy(
                        isBusy = false,
                        storyId = response.storyId,
                        sessionVersion = response.sessionVersion,
                        messages = StoryEngine.appendingAssistant(response.question, it.messages),
                    )
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(isBusy = false, notice = error.userMessage())
                }
            }
        }
    }

    fun sendAnswer() {
        val state = _uiState.value
        val storyId = state.storyId ?: return
        val answer = state.draftAnswer.trim()
        if (!StoryEngine.isSendable(answer) || state.isBusy) return

        viewModelScope.launch {
            val messagesWithUser = StoryEngine.appendingUser(answer, state.messages)
            _uiState.update {
                it.copy(
                    isBusy = true,
                    notice = null,
                    draftAnswer = "",
                    messages = messagesWithUser,
                    userTurns = it.userTurns + 1,
                )
            }

            runCatching {
                createRepository.continueStory(
                    storyId = storyId,
                    answer = answer,
                    expectedSessionVersion = state.sessionVersion,
                )
            }.onSuccess { response ->
                _uiState.update {
                    val signal = ContinueStorySignal(
                        question = response.question,
                        sessionVersion = response.sessionVersion,
                        canFinish = response.canFinish,
                        isComplete = response.isComplete,
                    )
                    it.copy(
                        isBusy = false,
                        sessionVersion = response.sessionVersion ?: it.sessionVersion,
                        messages = StoryEngine.appendingAssistant(response.question, it.messages),
                        canFinish = StoryEngine.canOfferFinish(signal, it.userTurns),
                    )
                }
            }.onFailure { error ->
                _uiState.update { it.copy(isBusy = false, notice = error.userMessage()) }
            }
        }
    }

    fun finishConversation() {
        val storyId = _uiState.value.storyId ?: return
        if (_uiState.value.isBusy) return

        viewModelScope.launch {
            _uiState.update { it.copy(isBusy = true, notice = null) }
            try {
                when (val result = createRepository.confirmStory(storyId)) {
                    ConfirmStoryResult.Confirmed -> finalizeStory(storyId)
                    is ConfirmStoryResult.NeedsInput -> {
                        val prompt = result.guidance.question
                            ?: result.guidance.message
                            ?: "Tell me one more detail so the gift feels specific."
                        _uiState.update {
                            it.copy(
                                isBusy = false,
                                canFinish = false,
                                messages = StoryEngine.appendingAssistant(prompt, it.messages),
                            )
                        }
                    }
                }
            } catch (error: Throwable) {
                _uiState.update { it.copy(isBusy = false, notice = error.userMessage()) }
            }
        }
    }

    fun approveLyricsAndRender() {
        val state = _uiState.value
        val trackId = state.createdTrackId ?: return
        renderJob?.cancel()
        pollingFailureCount = 0
        _uiState.update {
            it.copy(
                phase = CreatePhase.Rendering,
                notice = null,
                render = RenderUiState(
                    phase = RenderPhase.Rendering,
                    statusMessage = "Starting your full-quality render...",
                ),
            )
        }

        renderJob = viewModelScope.launch {
            try {
                if (resumeIfPossible(trackId, state.createdVersionNum)) return@launch
                saveLyricsIfNeeded()
                renderRepository.approveLyrics(trackId, state.createdVersionNum)
                val response = renderRepository.renderFull(trackId, state.createdVersionNum)
                val jobId = response.jobId
                if (jobId != null) {
                    persistPending(trackId, state.createdVersionNum, jobId)
                    poll(jobId, trackId, state.createdVersionNum, isFull = true)
                } else {
                    checkTrack(trackId, state.createdVersionNum, failOnMissing = true)
                }
            } catch (error: Throwable) {
                if (!resumeIfPossible(trackId, state.createdVersionNum)) {
                    applyApproveFailure(error)
                }
            }
        }
    }

    fun retryRender() {
        val state = _uiState.value
        val trackId = state.createdTrackId ?: return
        renderJob?.cancel()
        pollingFailureCount = 0
        _uiState.update {
            it.copy(
                phase = CreatePhase.Rendering,
                render = it.render.copy(
                    phase = RenderPhase.Rendering,
                    errorMessage = null,
                    showEditLyricsCta = false,
                    showPaywallCta = false,
                    statusMessage = "Retrying the render...",
                ),
            )
        }

        renderJob = viewModelScope.launch {
            runCatching {
                val response = renderRepository.renderFull(trackId, state.createdVersionNum)
                val jobId = response.jobId
                if (jobId != null) {
                    persistPending(trackId, state.createdVersionNum, jobId)
                    poll(jobId, trackId, state.createdVersionNum, isFull = true)
                } else {
                    checkTrack(trackId, state.createdVersionNum, failOnMissing = true)
                }
            }.onFailure {
                approveLyricsAndRender()
            }
        }
    }

    fun editLyricsAfterFailure() {
        renderJob?.cancel()
        _uiState.update {
            it.copy(
                phase = CreatePhase.Lyrics,
                render = RenderUiState(),
                notice = null,
            )
        }
    }

    fun playReveal() {
        val result = _uiState.value.render.result ?: return
        player.play(
            PlayableTrack(
                id = result.trackId,
                title = result.title,
                recipientName = result.recipientName,
                artworkUrl = result.artworkUrl,
                streamUrl = result.audioUrl,
                isOwnedContent = true,
            ),
        )
    }

    fun sendToRecipient() {
        viewModelScope.launch {
            val state = _uiState.value
            _uiState.update { it.copy(isCreatingShare = true, notice = null) }
            runCatching {
                val share = if (state.contentType == CreateContentType.Poem) {
                    shareRepository.createPoemShare(requireNotNull(state.createdPoemId))
                } else {
                    shareRepository.createTrackShare(requireNotNull(state.createdTrackId), state.createdVersionNum, requirePin = false)
                }
                shareDispatcher.sendGift(
                    recipientName = state.recipientName,
                    phone = state.recipientPhone.ifBlank { null },
                    link = share.shareUrl,
                    contentType = state.contentType,
                )
            }.onSuccess { result ->
                _uiState.update {
                    it.copy(
                        isCreatingShare = false,
                        notice = when (result) {
                            ShareDispatchResult.SentSms -> "Message composer opened."
                            ShareDispatchResult.OpenedShareSheet -> "Share sheet opened."
                            ShareDispatchResult.Failed -> "Could not open a share target. Try Share link instead."
                        },
                    )
                }
            }.onFailure { error ->
                _uiState.update { it.copy(isCreatingShare = false, notice = error.userMessage()) }
            }
        }
    }

    fun goToShare() {
        _uiState.update { it.copy(phase = CreatePhase.Share, notice = null) }
        ensureShareLink()
    }

    fun ensureShareLink() {
        val state = _uiState.value
        if (state.shareLink != null || state.isCreatingShare) return
        viewModelScope.launch {
            _uiState.update { it.copy(isCreatingShare = true, notice = null) }
            runCatching {
                if (state.contentType == CreateContentType.Poem) {
                    shareRepository.createPoemShare(requireNotNull(state.createdPoemId))
                } else {
                    shareRepository.createTrackShare(requireNotNull(state.createdTrackId), state.createdVersionNum, requirePin = true)
                }
            }.onSuccess { share ->
                _uiState.update {
                    it.copy(
                        isCreatingShare = false,
                        shareLink = share.shareUrl,
                        sharePin = share.claimPin,
                    )
                }
            }.onFailure { error ->
                _uiState.update { it.copy(isCreatingShare = false, notice = error.userMessage()) }
            }
        }
    }

    fun copyShareLink() {
        val link = _uiState.value.shareLink ?: return
        val copied = shareDispatcher.copyToClipboard(link)
        _uiState.update { it.copy(notice = if (copied) "Link copied." else "Could not copy link.") }
    }

    fun shareViaSheet() {
        val state = _uiState.value
        val link = state.shareLink ?: return
        val opened = shareDispatcher.sendGift(
            recipientName = state.recipientName,
            phone = null,
            link = link,
            contentType = state.contentType,
        ) != ShareDispatchResult.Failed
        _uiState.update { it.copy(notice = if (opened) "Share sheet opened." else "Could not open a share target.") }
    }

    private suspend fun finalizeStory(storyId: String) {
        val state = _uiState.value
        if (state.contentType == CreateContentType.Poem) {
            val response = createRepository.storyToPoem(storyId)
            val poem = response.poem
            _uiState.update {
                it.copy(
                    phase = CreatePhase.Reveal,
                    isBusy = false,
                    createdPoemId = poem.id,
                    poemTitle = poem.title,
                    poemVerses = poem.displayVerses(),
                )
            }
            createRepository.clearDraft()
            return
        }

        val lyrics = createRepository.generateStoryLyrics(storyId)
        val track = createRepository.storyToTrack(storyId, state.voiceSource.supportedBackendValue())
        val lyricsText = lyrics.lyrics.orEmpty()
        _uiState.update {
            it.copy(
                phase = CreatePhase.Lyrics,
                isBusy = false,
                lyricsText = lyricsText,
                hasUnsavedLyricsChanges = true,
                lyricsSaveMessage = null,
                createdTrackId = track.trackId,
                createdVersionNum = track.versionNum ?: 1,
            )
        }
    }

    private suspend fun saveLyricsIfNeeded() {
        val state = _uiState.value
        val trackId = state.createdTrackId ?: return
        val lyricsText = state.lyricsText?.trim().orEmpty()
        if (lyricsText.isBlank() || !state.hasUnsavedLyricsChanges) return
        _uiState.update { it.copy(isSavingLyrics = true, lyricsSaveMessage = "Saving lyrics edits...") }
        renderRepository.updateLyrics(
            trackId = trackId,
            versionNum = state.createdVersionNum,
            lyrics = state.toLyricsDocument(),
        )
        _uiState.update {
            it.copy(
                isSavingLyrics = false,
                hasUnsavedLyricsChanges = false,
                lyricsSaveMessage = "Lyrics saved.",
            )
        }
    }

    private suspend fun resumeIfPossible(trackId: String, versionNum: Int): Boolean {
        val detail = runCatching { renderRepository.getTrack(trackId) }.getOrNull() ?: return false
        val version = detail.versions.firstOrNull { it.versionNum == versionNum } ?: return false
        return when (val decision = RenderController.resumeDecision(version, isFull = true)) {
            is RenderController.ResumeDecision.Complete -> {
                completeRender(trackId, decision.url, detail)
                true
            }
            is RenderController.ResumeDecision.ResumePoll -> {
                persistPending(trackId, versionNum, decision.jobId)
                poll(decision.jobId, trackId, versionNum, isFull = true)
                true
            }
            is RenderController.ResumeDecision.Failed -> {
                applyRenderFailure(code = version.lastErrorCode, message = decision.message, terms = emptyList())
                true
            }
            RenderController.ResumeDecision.StartFresh -> false
        }
    }

    private suspend fun poll(jobId: String, trackId: String, versionNum: Int, isFull: Boolean) {
        var elapsed = 0L
        val maxDurationNs = if (isFull) RenderController.fullMaxDurationNs else RenderController.previewMaxDurationNs
        while (elapsed < maxDurationNs) {
            val interval = RenderController.backoffIntervalsNs[RenderController.backoffIndex(elapsed)]
            delay(interval / 1_000_000L)
            elapsed += interval

            runCatching { renderRepository.getJobStatus(jobId) }
                .onSuccess { status ->
                    pollingFailureCount = 0
                    _uiState.update {
                        it.copy(
                            render = it.render.copy(
                                phase = RenderPhase.Rendering,
                                progress = status.progress,
                                statusMessage = RenderController.stepMessage(status.status, status.step),
                            ),
                        )
                    }

                    if (RenderController.isCompleted(status.status)) {
                        checkTrack(trackId, versionNum, failOnMissing = true)
                        return
                    }
                    if (RenderController.isTerminalFailure(status.status)) {
                        applyRenderFailure(status.errorCode, status.errorMessage, status.errorTerms.orEmpty())
                        return
                    }
                }
                .onFailure {
                    pollingFailureCount += 1
                    if (pollingFailureCount >= RenderController.maxPollingFailures) {
                        if (!checkTrack(trackId, versionNum, failOnMissing = false)) {
                            applyRenderFailure(null, "Connection error. Check your network and try again.", emptyList())
                        }
                        return
                    }
                    delay(2_000)
                }
        }

        if (!checkTrack(trackId, versionNum, failOnMissing = false)) {
            applyRenderFailure(null, "Render timed out. Please try again.", emptyList())
        }
    }

    private suspend fun checkTrack(trackId: String, versionNum: Int, failOnMissing: Boolean): Boolean {
        val detail = runCatching { renderRepository.getTrack(trackId) }.getOrNull()
        if (detail == null) {
            if (failOnMissing) applyRenderFailure(null, "Render not ready yet.", emptyList())
            return false
        }
        val version = detail.versions.firstOrNull { it.versionNum == versionNum }
        if (version == null) {
            if (failOnMissing) applyRenderFailure(null, "Render not ready yet.", emptyList())
            return false
        }
        if (version.status == "failed") {
            applyRenderFailure(version.lastErrorCode, version.lastErrorMessage, emptyList())
            return true
        }
        val url = version.fullUrl ?: version.previewUrl
        if (url != null) {
            completeRender(trackId, url, detail)
            return true
        }
        if (failOnMissing) applyRenderFailure(null, "Render not ready yet.", emptyList())
        return false
    }

    private suspend fun completeRender(trackId: String, audioUrl: String, detail: TrackDetail? = null) {
        val resolved = detail ?: runCatching { renderRepository.getTrack(trackId) }.getOrNull()
        val track = resolved?.track
        _uiState.update {
            it.copy(
                phase = CreatePhase.Reveal,
                render = RenderUiState(
                    phase = RenderPhase.Completed,
                    progress = 100,
                    result = RenderResult(
                        trackId = trackId,
                        audioUrl = audioUrl,
                        title = track?.title ?: "Your song",
                        recipientName = track?.recipientName ?: it.recipientName,
                        artworkUrl = track?.artworkUrl,
                    ),
                ),
            )
        }
        renderRepository.clearPendingRender()
        createRepository.clearDraft()
    }

    private fun applyRenderFailure(code: String?, message: String?, terms: List<String>) {
        val friendly = RenderController.userFacingMessage(code, message, terms)
        _uiState.update {
            it.copy(
                render = it.render.copy(
                    phase = RenderPhase.Failed,
                    errorMessage = friendly,
                    showEditLyricsCta = RenderController.shouldShowEditLyricsCta(code, message, terms),
                    showPaywallCta = RenderController.isPaywallError(code),
                    policyTerms = terms,
                ),
                policyTerms = terms,
            )
        }
        viewModelScope.launch { renderRepository.clearPendingRender() }
    }

    private fun applyApproveFailure(error: Throwable) {
        val terms = error.policyTerms()
        _uiState.update {
            it.copy(
                phase = CreatePhase.Lyrics,
                isBusy = false,
                isSavingLyrics = false,
                notice = "Lyrics were not approved: ${error.userMessage()}",
                policyTerms = terms,
                render = RenderUiState(),
            )
        }
        viewModelScope.launch { renderRepository.clearPendingRender() }
    }

    private suspend fun persistPending(trackId: String, versionNum: Int, jobId: String) {
        renderRepository.savePendingRender(
            PendingRender(
                trackId = trackId,
                versionNum = versionNum,
                jobId = jobId,
                renderType = "full",
                updatedAt = Instant.now().toString(),
            ),
        )
    }

    private fun updateDraftedState(reducer: (CreateUiState) -> CreateUiState) {
        _uiState.update(reducer)
        saveDraft()
    }

    private fun saveDraft() {
        val state = _uiState.value
        if (state.recipientName.isBlank()) return
        viewModelScope.launch {
            saveDraftSnapshot(state)
        }
    }

    private suspend fun saveDraftSnapshot(state: CreateUiState) {
        if (state.recipientName.isBlank()) return
        createRepository.saveDraft(
            CreateDraft(
                recipientName = state.recipientName.trim(),
                recipientPhone = state.recipientPhone.trim().ifBlank { null },
                occasionRawValue = state.occasion.apiValue,
                contentTypeRawValue = state.contentType.apiValue,
                voiceSourceRawValue = state.voiceSource.apiValue,
                tone = state.tone,
                message = state.message,
                targetDuration = state.targetDurationSec.toDouble(),
                includeNameHook = true,
                appOnlySave = true,
                updatedAt = Instant.now().toString(),
            ),
        )
    }

    private fun CreateUiState.initialPrompt(): String =
        buildString {
            append("A ${contentType.label.lowercase()} for ${recipientName.trim()} for ${occasion.displayName}.")
            if (tone.isNotBlank()) append(" Tone: ${tone.trim()}.")
            if (message.isNotBlank()) append(" Message: ${message.trim()}.")
        }

    private fun CreateUiState.toLyricsDocument(): LyricsDocument {
        val lines = lyricsText.orEmpty()
            .lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }
        val sections = if (lines.isEmpty()) {
            emptyList()
        } else {
            listOf(
                LyricsSection(
                    name = "lyrics",
                    lines = lines,
                ),
            )
        }
        return LyricsDocument(
            title = "For ${recipientName.trim()}",
            style = tone.trim().ifBlank { null },
            sections = sections,
            anchorLine = lines.firstOrNull(),
        )
    }

    private fun PoemBody.displayVerses(): List<String> =
        verses?.filter { it.isNotBlank() }
            ?: previewLines?.filter { it.isNotBlank() }
            ?: emptyList()

    private fun Throwable.userMessage(): String =
        when (this) {
            is PorizoFailure -> message ?: "Something went wrong."
            else -> message ?: "Something went wrong."
        }

    private fun VoiceSource.supportedBackendValue(): String =
        when (this) {
            VoiceSource.CreatorVoice -> VoiceSource.CreatorVoice.apiValue
            VoiceSource.AiGuide,
            VoiceSource.InstrumentalOnly -> VoiceSource.AiGuide.apiValue
        }

    private fun Throwable.policyTerms(): List<String> {
        val message = userMessage()
        val lowercased = message.lowercase()
        val knownTerms = buildList {
            if (lowercased.contains("producer tag")) add("producer tag")
            if (lowercased.contains("specific artist")) add("specific artist name")
            if (lowercased.contains("artist likeness")) add("artist likeness")
            if (lowercased.contains("blocked word")) add("blocked word")
            if (lowercased.contains("sensitive_word_error")) add("sensitive word")
            if (lowercased.contains("copyright")) add("copyrighted reference")
            if (lowercased.contains("trademark")) add("trademarked reference")
        }
        val quotedTerms = Regex("['\"]([^'\"]{2,48})['\"]")
            .findAll(message)
            .map { it.groupValues[1].trim() }
            .filter { it.isNotBlank() }
            .toList()
        return (knownTerms + quotedTerms)
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .take(8)
    }

    private fun occasionFromApiValue(value: String): Occasion =
        Occasion.entries.firstOrNull { it.apiValue == value } ?: Occasion.Birthday

    private fun contentTypeFromApiValue(value: String): CreateContentType =
        CreateContentType.entries.firstOrNull { it.apiValue == value } ?: CreateContentType.Song

    private fun voiceSourceFromApiValue(value: String): VoiceSource =
        VoiceSource.entries.firstOrNull { it.apiValue == value } ?: VoiceSource.AiGuide
}
