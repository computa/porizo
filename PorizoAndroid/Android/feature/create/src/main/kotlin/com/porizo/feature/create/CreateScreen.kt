package com.porizo.feature.create

import android.content.Intent
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.porizo.core.model.CreateContentType
import com.porizo.core.model.Occasion
import com.porizo.core.model.StoryMessage
import com.porizo.core.model.VoiceSource
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton
import com.porizo.core.ui.PorizoSectionLabel
import com.porizo.core.ui.PorizoTextField

@Composable
fun CreateScreen(
    viewModel: CreateViewModel,
    isAuthenticated: Boolean,
    onSignInRequested: () -> Unit,
    routeNotice: String?,
    innerPadding: PaddingValues,
    onFlowDone: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsState()

    PorizoScreen(
        modifier = modifier.padding(innerPadding),
        title = "Create",
        subtitle = "Build a private song or poem from a few details, then send it as an app-bound gift.",
    ) {
        InlineNotice(routeNotice)
        InlineNotice(state.notice)

        when (state.phase) {
            CreatePhase.Name -> NameStep(
                state = state,
                onNameChange = viewModel::updateRecipientName,
                onContactPicked = viewModel::adoptContact,
                onContinue = viewModel::confirmName,
            )
            CreatePhase.Details -> DetailsStep(
                state = state,
                isAuthenticated = isAuthenticated,
                onOccasionChange = viewModel::updateOccasion,
                onContentTypeChange = viewModel::updateContentType,
                onToneChange = viewModel::updateTone,
                onMessageChange = viewModel::updateMessage,
                onPhoneChange = viewModel::updateRecipientPhone,
                onBack = viewModel::backToName,
                onSignInRequested = onSignInRequested,
                onStart = viewModel::startConversation,
            )
            CreatePhase.Conversation -> ConversationStep(
                state = state,
                onAnswerChange = viewModel::updateDraftAnswer,
                onSend = viewModel::sendAnswer,
                onFinish = viewModel::finishConversation,
            )
            CreatePhase.Lyrics -> LyricsStep(
                state = state,
                onLyricsChange = viewModel::updateLyricsText,
                onVoiceSourceChange = viewModel::updateVoiceSource,
                onApprove = viewModel::approveLyricsAndRender,
            )
            CreatePhase.Rendering -> RenderStep(
                state = state,
                onRetry = viewModel::retryRender,
                onEditLyrics = viewModel::editLyricsAfterFailure,
            )
            CreatePhase.Reveal -> RevealStep(
                state = state,
                onPlay = viewModel::playReveal,
                onSend = viewModel::sendToRecipient,
                onShare = viewModel::goToShare,
                onStartOver = viewModel::startOver,
            )
            CreatePhase.Share -> ShareStep(
                state = state,
                onEnsureLink = viewModel::ensureShareLink,
                onCopy = viewModel::copyShareLink,
                onShare = viewModel::shareViaSheet,
                onDone = {
                    viewModel.startOver()
                    onFlowDone()
                },
            )
        }
    }
}

@Composable
private fun NameStep(
    state: CreateUiState,
    onNameChange: (String) -> Unit,
    onContactPicked: (String, String?) -> Unit,
    onContinue: () -> Unit,
) {
    // iOS leads Contacts-first ("we'll text them the song the moment it's ready")
    // with a type-a-name fallback. Reveal the text field only after the user opts
    // to type, or once a contact is picked.
    var typing by rememberSaveable { mutableStateOf(false) }
    val contactPicker = rememberContactPicker { name, phone ->
        onContactPicked(name, phone)
        typing = true
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            Icons.Filled.AutoAwesome,
            contentDescription = null,
            tint = PorizoColors.Accent,
            modifier = Modifier.size(34.dp),
        )
        FrauncesTitle(text = "Who's this song for?", sizeSp = 28)

        if (!typing && state.recipientName.isBlank()) {
            PorizoPrimaryButton(
                text = "Choose from Contacts",
                onClick = { contactPicker() },
                icon = Icons.Filled.Contacts,
            )
            Text(
                text = "We'll text them the song in one tap the moment it's ready.",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Just type a name instead",
                color = PorizoColors.AccentDark,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .heightIn(min = 44.dp)
                    .clickable { typing = true },
            )
        } else {
            PorizoTextField(
                value = state.recipientName,
                onValueChange = onNameChange,
                label = "Their name",
            )
            PorizoPrimaryButton(
                text = "Continue",
                onClick = onContinue,
                enabled = state.canContinueName,
                icon = Icons.AutoMirrored.Filled.ArrowForward,
            )
        }
    }
}

/// System contact picker → (displayName, phoneNumber?). Uses ACTION_PICK on the
/// Contacts provider, which returns a single contact without a persistent
/// READ_CONTACTS permission grant. Falls back silently if unavailable.
@Composable
private fun rememberContactPicker(
    onPicked: (String, String?) -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val uri = result.data?.data ?: return@rememberLauncherForActivityResult
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        )
        context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val name = cursor.getString(0) ?: ""
                val phone = cursor.getString(1)
                if (name.isNotBlank()) onPicked(name, phone)
            }
        }
    }
    return {
        val intent = Intent(Intent.ACTION_PICK).apply {
            type = ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE
        }
        runCatching { launcher.launch(intent) }
    }
}

@Composable
private fun DetailsStep(
    state: CreateUiState,
    isAuthenticated: Boolean,
    onOccasionChange: (Occasion) -> Unit,
    onContentTypeChange: (CreateContentType) -> Unit,
    onToneChange: (String) -> Unit,
    onMessageChange: (String) -> Unit,
    onPhoneChange: (String) -> Unit,
    onBack: () -> Unit,
    onSignInRequested: () -> Unit,
    onStart: () -> Unit,
) {
    PorizoSectionLabel("Gift setup")
    PorizoCard {
        FrauncesTitle(text = "For ${state.recipientName.trim()}", sizeSp = 24)
        Text(
            text = "Pick the format and give the AI the details it should protect.",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )

        PorizoSectionLabel("Type")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TypeChoiceButton(
                label = CreateContentType.Song.label,
                icon = Icons.Filled.MusicNote,
                selected = state.contentType == CreateContentType.Song,
                onClick = { onContentTypeChange(CreateContentType.Song) },
                modifier = Modifier.weight(1f),
            )
            TypeChoiceButton(
                label = CreateContentType.Poem.label,
                icon = Icons.Filled.Edit,
                selected = state.contentType == CreateContentType.Poem,
                onClick = { onContentTypeChange(CreateContentType.Poem) },
                modifier = Modifier.weight(1f),
            )
        }

        PorizoSectionLabel("Occasion")
        OccasionGrid(selected = state.occasion, onSelect = onOccasionChange)

        if (isAuthenticated) {
            PorizoTextField(
                value = state.tone,
                onValueChange = onToneChange,
                label = "Tone or style",
            )
            PorizoTextField(
                value = state.message,
                onValueChange = onMessageChange,
                label = "Memory, message, or inside joke",
                singleLine = false,
            )
            PorizoTextField(
                value = state.recipientPhone,
                onValueChange = onPhoneChange,
                label = "Recipient phone for one-tap send (optional)",
            )
            PorizoPrimaryButton(
                text = "Start story",
                onClick = onStart,
                enabled = state.canContinueName,
                icon = Icons.Filled.CardGiftcard,
            )
        } else {
            PorizoPrimaryButton(
                text = "Sign in to create",
                onClick = onSignInRequested,
                enabled = state.canContinueName,
                icon = Icons.Filled.CardGiftcard,
            )
        }
        TextButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Back", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun ConversationStep(
    state: CreateUiState,
    onAnswerChange: (String) -> Unit,
    onSend: () -> Unit,
    onFinish: () -> Unit,
) {
    PorizoSectionLabel("Story")
    PorizoCard {
        Text(
            text = "For ${state.recipientName} · ${state.occasion.displayName}",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (state.messages.isEmpty() && state.isBusy) {
            LoadingLine("Opening the story session...")
        } else {
            state.messages.forEach { message ->
                ChatBubble(message)
            }
        }
        if (state.isBusy && state.messages.isNotEmpty()) {
            LoadingLine("Thinking...")
        }
        PorizoTextField(
            value = state.draftAnswer,
            onValueChange = onAnswerChange,
            label = "Share a detail",
            singleLine = false,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PorizoSecondaryButton(
                text = "Send",
                onClick = onSend,
                enabled = state.canSendAnswer,
                icon = Icons.AutoMirrored.Filled.Send,
                modifier = Modifier.weight(1f),
            )
            PorizoPrimaryButton(
                text = "Create",
                onClick = onFinish,
                enabled = state.canFinish && !state.isBusy,
                icon = Icons.Filled.CheckCircle,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun LyricsStep(
    state: CreateUiState,
    onLyricsChange: (String) -> Unit,
    onVoiceSourceChange: (VoiceSource) -> Unit,
    onApprove: () -> Unit,
) {
    PorizoSectionLabel("Lyrics")
    PorizoCard {
        FrauncesTitle(text = "Review the lyrics", sizeSp = 24)
        Text(
            text = "For ${state.recipientName}",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
        PorizoTextField(
            value = state.lyricsText.orEmpty(),
            onValueChange = onLyricsChange,
            label = "Lyrics",
            modifier = Modifier
                .fillMaxWidth()
                .background(PorizoColors.SurfaceMuted, RoundedCornerShape(12.dp))
                .padding(14.dp),
        )
        state.lyricsSaveMessage?.let { message ->
            Text(
                text = message,
                color = if (state.hasUnsavedLyricsChanges) PorizoColors.Warning else PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        state.notice?.let { message ->
            Text(
                text = message,
                color = PorizoColors.Error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        PolicyTermList(terms = state.policyTerms)
        PorizoSectionLabel("Voice")
        VoiceChoiceButton(
            label = "AI voice",
            selected = state.voiceSource == VoiceSource.AiGuide || state.voiceSource == VoiceSource.InstrumentalOnly,
            enabled = true,
            onClick = { onVoiceSourceChange(VoiceSource.AiGuide) },
        )
        VoiceChoiceButton(
            label = "My voice coming soon",
            selected = false,
            enabled = false,
        )
        PorizoPrimaryButton(
            text = when {
                state.isSavingLyrics -> "Saving lyrics..."
                state.hasUnsavedLyricsChanges -> "Save and create my ${state.createLabel}"
                else -> "Create my ${state.createLabel}"
            },
            onClick = onApprove,
            enabled = state.lyricsText?.isNotBlank() == true && !state.isSavingLyrics,
            icon = Icons.Filled.MusicNote,
        )
    }
}

@Composable
private fun RenderStep(
    state: CreateUiState,
    onRetry: () -> Unit,
    onEditLyrics: () -> Unit,
) {
    PorizoSectionLabel("Render")
    PorizoCard {
        when (state.render.phase) {
            RenderPhase.Failed -> {
                Icon(Icons.Filled.Refresh, contentDescription = null, tint = PorizoColors.Warning)
                FrauncesTitle(text = "Preview needs attention", sizeSp = 22)
                Text(
                    text = state.render.errorMessage ?: "Song processing failed.",
                    color = PorizoColors.TextPrimary,
                    style = MaterialTheme.typography.bodyLarge,
                )
                PolicyTermList(terms = state.render.policyTerms)
                when {
                    state.render.showEditLyricsCta -> PorizoPrimaryButton(
                        text = "Edit lyrics",
                        onClick = onEditLyrics,
                        icon = Icons.Filled.Edit,
                    )
                    state.render.showPaywallCta -> Text(
                        text = "Upgrade or wait for your plan to reset before making another song.",
                        color = PorizoColors.TextSecondary,
                    )
                    else -> PorizoPrimaryButton(
                        text = "Try again",
                        onClick = onRetry,
                        icon = Icons.Filled.Refresh,
                    )
                }
            }
            else -> {
                LoadingLine(state.render.statusMessage ?: "Creating your ${state.createLabel}...")
                LinearProgressIndicator(
                    progress = { ((state.render.progress ?: 12).coerceIn(0, 100) / 100f) },
                    modifier = Modifier.fillMaxWidth(),
                    color = PorizoColors.Accent,
                    trackColor = PorizoColors.Border,
                )
                Text(
                    text = state.render.progress?.let { "$it%" } ?: "This usually takes under a minute.",
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun RevealStep(
    state: CreateUiState,
    onPlay: () -> Unit,
    onSend: () -> Unit,
    onShare: () -> Unit,
    onStartOver: () -> Unit,
) {
    PorizoSectionLabel("Reveal")
    PorizoCard {
        Icon(
            imageVector = if (state.contentType == CreateContentType.Poem) Icons.Filled.Edit else Icons.Filled.MusicNote,
            contentDescription = null,
            tint = PorizoColors.Accent,
        )
        FrauncesTitle(
            text = if (state.contentType == CreateContentType.Poem) {
                state.poemTitle ?: "For ${state.recipientName}"
            } else {
                state.render.result?.title ?: "Your song"
            },
            sizeSp = 26,
        )
        Text(
            text = "For ${state.recipientName}",
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyLarge,
        )

        if (state.contentType == CreateContentType.Poem) {
            state.poemVerses.take(8).forEach { verse ->
                Text(
                    text = verse,
                    modifier = Modifier.fillMaxWidth(),
                    color = PorizoColors.TextPrimary,
                    fontStyle = FontStyle.Italic,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        } else {
            PorizoSecondaryButton(
                text = "Play preview",
                onClick = onPlay,
                enabled = state.render.result != null,
                icon = Icons.Filled.PlayArrow,
            )
        }

        PorizoPrimaryButton(
            text = "Send to ${state.recipientName}",
            onClick = onSend,
            enabled = !state.isCreatingShare,
            icon = Icons.AutoMirrored.Filled.Send,
        )
        PorizoSecondaryButton(
            text = "Share link instead",
            onClick = onShare,
            enabled = !state.isCreatingShare,
            icon = Icons.Filled.Share,
        )
        TextButton(onClick = onStartOver, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Create another", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun ShareStep(
    state: CreateUiState,
    onEnsureLink: () -> Unit,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onDone: () -> Unit,
) {
    androidx.compose.runtime.LaunchedEffect(state.phase) { onEnsureLink() }

    PorizoSectionLabel("Share")
    PorizoCard {
        FrauncesTitle(text = "Share with ${state.recipientName}", sizeSp = 24)
        when {
            state.isCreatingShare -> LoadingLine("Creating a protected gift link...")
            state.shareLink != null -> {
                Text(
                    text = state.shareLink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(PorizoColors.SurfaceMuted, RoundedCornerShape(12.dp))
                        .padding(14.dp),
                    color = PorizoColors.TextPrimary,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
                state.sharePin?.let { pin ->
                    PinCard(pin)
                }
                Text(
                    text = "Claim in the app to keep it forever.",
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PorizoSecondaryButton(
                        text = "Copy",
                        onClick = onCopy,
                        icon = Icons.Filled.ContentCopy,
                        modifier = Modifier.weight(1f),
                    )
                    PorizoPrimaryButton(
                        text = "Share",
                        onClick = onShare,
                        icon = Icons.Filled.Share,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            else -> Text(
                text = "Could not create a share link yet.",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        TextButton(onClick = onDone, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text("Done", color = PorizoColors.TextSecondary)
        }
    }
}

@Composable
private fun PolicyTermList(terms: List<String>) {
    if (terms.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "Provider flagged terms to revise",
            color = PorizoColors.TextSecondary,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.bodyMedium,
        )
        terms.chunked(2).forEach { rowTerms ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowTerms.forEach { term ->
                    Text(
                        text = term,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(PorizoColors.SurfaceMuted)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        color = PorizoColors.TextPrimary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun OccasionGrid(selected: Occasion, onSelect: (Occasion) -> Unit) {
    val visibleOccasions = listOf(
        Occasion.Birthday,
        Occasion.Anniversary,
        Occasion.ThankYou,
        Occasion.ILoveYou,
        Occasion.MothersDay,
        Occasion.Custom,
    ).let { common ->
        if (selected in common) common else common + selected
    }
    val rows = visibleOccasions.chunked(2)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { occasion ->
                    ChoicePill(
                        label = occasion.displayName,
                        selected = selected == occasion,
                        onClick = { onSelect(occasion) },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun TypeChoiceButton(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ChoiceButton(
        label = label,
        selected = selected,
        onClick = onClick,
        icon = icon,
        modifier = modifier,
    )
}

@Composable
private fun VoiceChoiceButton(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    ChoiceButton(
        label = label,
        selected = selected,
        enabled = enabled,
        onClick = onClick,
        icon = Icons.Filled.MusicNote,
        modifier = modifier,
    )
}

@Composable
private fun ChoiceButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = 52.dp),
        enabled = enabled,
        border = BorderStroke(1.dp, if (selected) PorizoColors.Accent else PorizoColors.ControlBorder),
        shape = RoundedCornerShape(14.dp),
    ) {
        Icon(icon, contentDescription = null)
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = label,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = if (enabled) PorizoColors.TextPrimary else PorizoColors.TextMuted,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ChoicePill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = 44.dp),
        border = BorderStroke(1.dp, if (selected) PorizoColors.Accent else PorizoColors.Border),
        shape = RoundedCornerShape(22.dp),
    ) {
        Text(
            text = label,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = PorizoColors.TextPrimary,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}

@Composable
private fun ChatBubble(message: StoryMessage) {
    val isUser = message.role == StoryMessage.Role.User
    Row(modifier = Modifier.fillMaxWidth()) {
        if (isUser) Spacer(modifier = Modifier.weight(1f))
        Text(
            text = message.text,
            modifier = Modifier
                .weight(4f, fill = false)
                .clip(RoundedCornerShape(14.dp))
                .background(if (isUser) PorizoColors.Accent else PorizoColors.SurfaceMuted)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            color = if (isUser) Color.White else PorizoColors.TextPrimary,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (!isUser) Spacer(modifier = Modifier.weight(1f))
    }
}

@Composable
private fun LoadingLine(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(color = PorizoColors.Accent)
        Text(text, color = PorizoColors.TextSecondary, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun PinCard(pin: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PorizoColors.CoralBubble, RoundedCornerShape(12.dp))
            .padding(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        PorizoSectionLabel("Claim PIN")
        Text(
            text = pin,
            color = PorizoColors.AccentDark,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.headlineSmall,
        )
    }
}

@Composable
private fun InlineNotice(text: String?) {
    if (text.isNullOrBlank()) return
    PorizoCard {
        Text(
            text = text,
            color = PorizoColors.TextPrimary,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
