package com.porizo.feature.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TextSnippet
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.porizo.core.domain.library.SongDisplayStatus
import com.porizo.core.domain.library.PoemLibrary
import com.porizo.core.domain.library.PoemLibraryFilter
import com.porizo.core.domain.library.SongLibrary
import com.porizo.core.domain.library.SongLibraryFilter
import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.player.PlayerUiState
import com.porizo.core.model.PoemSummary
import com.porizo.core.model.TrackSummary
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton
import com.porizo.core.ui.PorizoSectionLabel

@Composable
fun SongsScreen(
    viewModel: SongsViewModel,
    isAuthenticated: Boolean,
    onSignInRequested: () -> Unit,
    routeNotice: String?,
    innerPadding: PaddingValues,
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) viewModel.refresh()
    }

    PorizoScreen(
        modifier = Modifier.padding(innerPadding),
        title = "Songs",
        subtitle = "Songs you make or receive stay app-bound, with protected playback controlled by the backend.",
    ) {
        RouteNotice(routeNotice)
        if (!isAuthenticated) {
            SignedOutLibraryCard(
                title = "Sign in to see your songs",
                detail = "Your library and protected playback are tied to your account.",
                onSignInRequested = onSignInRequested,
            )
        } else {
            SongFilterRow(selected = state.filter, onSelect = viewModel::setFilter)
            LibraryMessage(state.message)
            if (state.isLoading) {
                LoadingRows("Loading songs")
            } else if (state.visibleTracks.isEmpty()) {
                EmptyLibraryCard(
                    title = if (state.filter == SongLibraryFilter.Mine) "No songs yet" else "Nothing received yet",
                    detail = if (state.filter == SongLibraryFilter.Mine) {
                        "Create a song from Home to start your library."
                    } else {
                        "Songs sent to you will appear here once you claim them."
                    },
                )
            } else {
                PorizoSectionLabel(state.filter.label)
                PorizoCard {
                    state.visibleTracks.forEach { track ->
                        SongRow(
                            track = track,
                            onPlay = { viewModel.play(track) },
                            onShare = { viewModel.share(track) },
                            onDelete = { viewModel.requestDelete(track) },
                        )
                    }
                }
            }
        }
    }

    state.pendingDeleteTrack?.let { track ->
        DeleteConfirmDialog(
            title = "Delete song?",
            message = "Delete \"${track.title}\" from this library? This cannot be undone from Android.",
            confirmText = "Delete song",
            onConfirm = viewModel::confirmDelete,
            onDismiss = viewModel::cancelDelete,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PoemsScreen(
    viewModel: PoemsViewModel,
    isAuthenticated: Boolean,
    onSignInRequested: () -> Unit,
    routeNotice: String?,
    innerPadding: PaddingValues,
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) viewModel.refresh()
    }

    PorizoScreen(
        modifier = Modifier.padding(innerPadding),
        title = "Poems",
        subtitle = "Short personal pieces use the same recipient contract, claim rules, and app-only save model.",
    ) {
        RouteNotice(routeNotice)
        if (!isAuthenticated) {
            SignedOutLibraryCard(
                title = "Sign in to see your poems",
                detail = "Your poem library is tied to your account.",
                onSignInRequested = onSignInRequested,
            )
        } else {
            PoemFilterRow(selected = state.filter, onSelect = viewModel::setFilter)
            LibraryMessage(state.message)
            if (state.isLoading) {
                LoadingRows("Loading poems")
            } else if (state.visiblePoems.isEmpty()) {
                EmptyLibraryCard(
                    title = if (state.filter == PoemLibraryFilter.Mine) "No poems yet" else "Nothing received yet",
                    detail = if (state.filter == PoemLibraryFilter.Mine) {
                        "Create a poem from Home to start your library."
                    } else {
                        "Poems sent to you will appear here once you claim them."
                    },
                )
            } else {
                PorizoSectionLabel(state.filter.label)
                PorizoCard {
                    state.visiblePoems.forEach { poem ->
                        PoemRow(
                            poem = poem,
                            onOpen = { viewModel.selectPoem(poem) },
                            onShare = { viewModel.share(poem) },
                            onDelete = { viewModel.requestDelete(poem) },
                        )
                    }
                }
            }
        }
    }

    state.selectedPoem?.let { poem ->
        ModalBottomSheet(onDismissRequest = viewModel::closePoem) {
            PoemDetail(
                poem = poem,
                isPreparingAudio = state.isPreparingAudio,
                onListen = { viewModel.listen(poem) },
                onShare = { viewModel.share(poem) },
                onDelete = { viewModel.requestDelete(poem) },
                onClose = viewModel::closePoem,
            )
        }
    }

    state.pendingDeletePoem?.let { poem ->
        DeleteConfirmDialog(
            title = "Delete poem?",
            message = "Delete \"${poem.title}\" from this library? This cannot be undone from Android.",
            confirmText = "Delete poem",
            onConfirm = viewModel::confirmDelete,
            onDismiss = viewModel::cancelDelete,
        )
    }
}

@Composable
fun MiniPlayerBar(
    player: PlayerController,
    onOpenNowPlaying: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by player.state.collectAsState()
    val track = state.currentTrack ?: return
    Column(modifier = modifier.fillMaxWidth()) {
        LinearProgressIndicator(
            progress = { state.progressFraction.toFloat() },
            modifier = Modifier.fillMaxWidth(),
            color = PorizoColors.Accent,
            trackColor = PorizoColors.Border,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 64.dp)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Button(
                onClick = player::toggle,
                colors = ButtonDefaults.buttonColors(containerColor = PorizoColors.CoralBubble),
            ) {
                Icon(
                    imageVector = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = if (state.isPlaying) "Pause" else "Play",
                    tint = PorizoColors.AccentDark,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = PorizoColors.TextPrimary,
                    fontWeight = FontWeight.SemiBold,
                )
                track.recipientName?.takeIf { it.isNotBlank() }?.let { recipient ->
                    Text(
                        text = "For $recipient",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = PorizoColors.TextSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            PorizoSecondaryButton(
                text = "Now playing",
                onClick = onOpenNowPlaying,
                modifier = Modifier.width(132.dp),
                icon = Icons.Filled.Headphones,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NowPlayingSheet(
    player: PlayerController,
    onDismiss: () -> Unit,
) {
    val state by player.state.collectAsState()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        NowPlayingContent(state = state, player = player, onDismiss = onDismiss)
    }
}

@Composable
private fun NowPlayingContent(
    state: PlayerUiState,
    player: PlayerController,
    onDismiss: () -> Unit,
) {
    val track = state.currentTrack
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Filled.MusicNote,
                contentDescription = null,
                tint = PorizoColors.Accent,
            )
            Text(
                text = "Now Playing",
                modifier = Modifier.weight(1f),
                color = PorizoColors.TextSecondary,
                fontWeight = FontWeight.SemiBold,
            )
            Button(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = "Close")
            }
        }
        FrauncesTitle(text = track?.title ?: "Nothing playing", sizeSp = 28)
        track?.recipientName?.takeIf { it.isNotBlank() }?.let { recipient ->
            Text("For $recipient", color = PorizoColors.TextSecondary)
        }
        Slider(
            value = state.progressFraction.toFloat(),
            onValueChange = player::seekToFraction,
            enabled = state.durationSeconds > 0.0,
        )
        Row(modifier = Modifier.fillMaxWidth()) {
            Text(timeLabel(state.positionSeconds), color = PorizoColors.TextSecondary)
            Spacer(modifier = Modifier.weight(1f))
            Text(timeLabel(state.durationSeconds), color = PorizoColors.TextSecondary)
        }
        PorizoPrimaryButton(
            text = if (state.isPlaying) "Pause" else "Play",
            onClick = player::toggle,
            icon = if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
            enabled = track != null,
        )
        state.lastError?.let { message ->
            Text(text = message, color = PorizoColors.Error)
        }
    }
}

@Composable
private fun SongFilterRow(selected: SongLibraryFilter, onSelect: (SongLibraryFilter) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SongLibraryFilter.entries.forEach { filter ->
            FilterButton(
                text = filter.label,
                selected = selected == filter,
                onClick = { onSelect(filter) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun PoemFilterRow(selected: PoemLibraryFilter, onSelect: (PoemLibraryFilter) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        PoemLibraryFilter.entries.forEach { filter ->
            FilterButton(
                text = filter.label,
                selected = selected == filter,
                onClick = { onSelect(filter) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun FilterButton(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    if (selected) {
        Button(modifier = modifier.heightIn(min = 48.dp), onClick = onClick) {
            Text(text, maxLines = 1)
        }
    } else {
        OutlinedButton(modifier = modifier.heightIn(min = 48.dp), onClick = onClick) {
            Text(text, maxLines = 1, color = PorizoColors.TextPrimary)
        }
    }
}

@Composable
private fun SongRow(track: TrackSummary, onPlay: () -> Unit, onShare: () -> Unit, onDelete: () -> Unit) {
    val status = SongLibrary.displayStatus(track.status)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Button(onClick = onPlay, enabled = status == SongDisplayStatus.Ready) {
            Icon(Icons.Filled.PlayArrow, contentDescription = "Play ${track.title}")
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(track.title, color = PorizoColors.TextPrimary, fontWeight = FontWeight.SemiBold)
            Text(
                text = listOfNotNull(track.recipientName, track.occasion).joinToString(" • ").ifBlank { "Song" },
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Text(
            text = SongLibrary.badgeLabel(status),
            color = PorizoColors.TextTertiary,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.bodyMedium,
        )
        Button(onClick = onShare, enabled = track.canShare != false && status == SongDisplayStatus.Ready) {
            Icon(Icons.Filled.Share, contentDescription = "Share ${track.title}")
        }
        Button(onClick = onDelete, enabled = track.canDelete != false) {
            Icon(Icons.Filled.Delete, contentDescription = "Delete ${track.title}")
        }
    }
}

@Composable
private fun PoemRow(poem: PoemSummary, onOpen: () -> Unit, onShare: () -> Unit, onDelete: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Button(onClick = onOpen) {
            Icon(Icons.AutoMirrored.Filled.TextSnippet, contentDescription = "Open ${poem.title}")
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(poem.title, color = PorizoColors.TextPrimary, fontWeight = FontWeight.SemiBold)
            Text(
                text = "${poem.recipientName} • ${poem.occasion}",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                text = PoemLibrary.preview(poem),
                color = PorizoColors.TextTertiary,
                fontStyle = FontStyle.Italic,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Button(onClick = onShare) {
            Icon(Icons.Filled.Share, contentDescription = "Share ${poem.title}")
        }
        Button(onClick = onDelete) {
            Icon(Icons.Filled.Delete, contentDescription = "Delete ${poem.title}")
        }
    }
}

@Composable
private fun PoemDetail(
    poem: PoemSummary,
    isPreparingAudio: Boolean,
    onListen: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
    onClose: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            FrauncesTitle(text = poem.title, sizeSp = 26, modifier = Modifier.weight(1f))
            Button(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = "Close")
            }
        }
        Text("For ${poem.recipientName} • ${poem.occasion}", color = PorizoColors.TextSecondary)
        PorizoPrimaryButton(
            text = if (isPreparingAudio) "Preparing..." else "Listen",
            onClick = onListen,
            enabled = !isPreparingAudio,
            icon = Icons.Filled.PlayArrow,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PorizoSecondaryButton(
                text = "Share",
                onClick = onShare,
                icon = Icons.Filled.Share,
                modifier = Modifier.weight(1f),
            )
            PorizoSecondaryButton(
                text = "Delete",
                onClick = onDelete,
                icon = Icons.Filled.Delete,
                modifier = Modifier.weight(1f),
            )
        }
        poem.verses.forEach { verse ->
            Text(
                text = verse,
                color = PorizoColors.TextPrimary,
                fontStyle = FontStyle.Italic,
                style = MaterialTheme.typography.bodyLarge,
            )
        }
    }
}

@Composable
private fun SignedOutLibraryCard(title: String, detail: String, onSignInRequested: () -> Unit) {
    PorizoCard {
        Text(title, color = PorizoColors.TextPrimary, fontWeight = FontWeight.SemiBold)
        Text(detail, color = PorizoColors.TextSecondary)
        PorizoPrimaryButton(text = "Sign in", onClick = onSignInRequested)
    }
}

@Composable
private fun EmptyLibraryCard(title: String, detail: String) {
    PorizoCard {
        Text(title, color = PorizoColors.TextPrimary, fontWeight = FontWeight.SemiBold)
        Text(detail, color = PorizoColors.TextSecondary)
    }
}

@Composable
private fun LoadingRows(label: String) {
    PorizoCard {
        Text(label, color = PorizoColors.TextSecondary)
        repeat(3) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = PorizoColors.Accent,
                trackColor = PorizoColors.Border,
            )
        }
    }
}

@Composable
private fun LibraryMessage(message: String?) {
    message?.let {
        PorizoCard {
            Text(text = it, color = PorizoColors.Error)
        }
    }
}

@Composable
private fun RouteNotice(message: String?) {
    message?.let {
        PorizoCard {
            Text(text = it, color = PorizoColors.AccentDark)
        }
    }
}

@Composable
private fun DeleteConfirmDialog(
    title: String,
    message: String,
    confirmText: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(title, color = PorizoColors.TextPrimary)
        },
        text = {
            Text(message, color = PorizoColors.TextSecondary)
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmText, color = PorizoColors.Error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = PorizoColors.TextSecondary)
            }
        },
        containerColor = PorizoColors.Surface,
    )
}

private fun timeLabel(seconds: Double): String {
    if (!seconds.isFinite() || seconds < 0) return "0:00"
    val total = seconds.toInt()
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
}
