package com.porizo.feature.claim

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoSecondaryButton
import com.porizo.core.ui.PorizoTextField

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimSheet(
    viewModel: ClaimViewModel,
    onDismiss: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    if (!state.isVisible) return

    ModalBottomSheet(onDismissRequest = onDismiss) {
        ClaimContent(
            state = state,
            onPinChange = viewModel::updatePin,
            onPlayPreview = viewModel::playPreview,
            onClaim = viewModel::claim,
            onDismiss = onDismiss,
        )
    }
}

@Composable
private fun ClaimContent(
    state: ClaimUiState,
    onPinChange: (String) -> Unit,
    onPlayPreview: () -> Unit,
    onClaim: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            FrauncesTitle(
                text = state.title ?: "Claim gift",
                sizeSp = 28,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onDismiss) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Close",
                    tint = PorizoColors.TextPrimary,
                )
            }
        }
        state.subtitle?.let {
            Text(it, color = PorizoColors.TextSecondary, style = MaterialTheme.typography.bodyLarge)
        }

        when (val phase = state.phase) {
            ClaimPhase.Loading -> LoadingClaim()
            ClaimPhase.Preview -> PreviewClaim(
                state = state,
                onPinChange = onPinChange,
                onPlayPreview = onPlayPreview,
                onClaim = onClaim,
            )
            ClaimPhase.Claiming -> LoadingClaim(label = "Claiming gift...")
            ClaimPhase.Claimed -> ResultCard(
                title = "Gift saved",
                detail = "This gift is now bound to this app on this device.",
                icon = Icons.Filled.CheckCircle,
                tint = PorizoColors.Success,
            )
            ClaimPhase.Unavailable -> ResultCard(
                title = "This gift is unavailable",
                detail = "It may have expired, already been claimed, or been revoked.",
                icon = Icons.Filled.Lock,
                tint = PorizoColors.Warning,
            )
            is ClaimPhase.Failed -> ResultCard(
                title = "Could not claim gift",
                detail = phase.message,
                icon = Icons.Filled.Lock,
                tint = PorizoColors.Error,
            )
            ClaimPhase.Idle -> Unit
        }
    }
}

@Composable
private fun PreviewClaim(
    state: ClaimUiState,
    onPinChange: (String) -> Unit,
    onPlayPreview: () -> Unit,
    onClaim: () -> Unit,
) {
    if (state.poemVerses.isNotEmpty()) {
        PorizoCard {
            state.poemVerses.take(4).forEach { verse ->
                Text(
                    text = verse,
                    color = PorizoColors.TextPrimary,
                    fontStyle = FontStyle.Italic,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
    if (state.previewUrl != null) {
        PorizoSecondaryButton(
            text = "Play preview",
            onClick = onPlayPreview,
            icon = Icons.Filled.PlayArrow,
        )
    }
    if (state.needsPin) {
        PorizoTextField(
            value = state.pin,
            onValueChange = onPinChange,
            label = "Claim PIN",
        )
    }
    PorizoPrimaryButton(
        text = "Claim gift",
        onClick = onClaim,
        enabled = !state.needsPin || state.pin.isNotBlank(),
        icon = Icons.Filled.CheckCircle,
    )
}

@Composable
private fun LoadingClaim(label: String = "Loading gift...") {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(color = PorizoColors.Accent)
        Text(label, color = PorizoColors.TextSecondary)
    }
}

@Composable
private fun ResultCard(
    title: String,
    detail: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: androidx.compose.ui.graphics.Color,
) {
    PorizoCard {
        Icon(icon, contentDescription = null, tint = tint)
        Text(title, color = PorizoColors.TextPrimary, fontWeight = FontWeight.SemiBold)
        Text(detail, color = PorizoColors.TextSecondary)
    }
}
