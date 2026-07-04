package com.porizo.feature.create

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.porizo.core.model.Occasion
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton

@Composable
fun ExploreScreen(
    routeNotice: String?,
    onCreate: () -> Unit,
    onScheduleSend: () -> Unit,
    onOccasionSelected: (Occasion) -> Unit,
    onSeeAllSongs: () -> Unit,
    innerPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    PorizoScreen(
        modifier = modifier.padding(innerPadding),
        title = "Explore",
    ) {
        InlineNotice(routeNotice)
        FeaturedCreateCard()
        // Primary create CTA with the iOS two-line label.
        CtaButton(
            title = "Create for someone special",
            subtitle = "Ready in about 90 seconds",
            icon = Icons.Filled.AutoAwesome,
            containerColor = PorizoColors.Accent,
            onClick = onCreate,
        )
        // Gift entry — mirrors the iOS "Schedule and send, for them" CTA.
        CtaButton(
            title = "Schedule and send, for them",
            subtitle = null,
            icon = Icons.Filled.CardGiftcard,
            containerColor = PorizoColors.RoseGold,
            onClick = onScheduleSend,
        )
        OccasionRail(onOccasionSelected = onOccasionSelected)
        PorizoCard {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.MusicNote, contentDescription = null, tint = PorizoColors.Accent)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Your first song is free",
                        color = PorizoColors.TextPrimary,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text = "Pick an occasion or start from scratch to create a personal song or poem.",
                        color = PorizoColors.TextSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            PorizoSecondaryButton(
                text = "See all songs",
                onClick = onSeeAllSongs,
            )
        }
    }
}

/// A full-width coral CTA with an icon and an optional second line, matching the
/// iOS Explore create/gift buttons.
@Composable
private fun CtaButton(
    title: String,
    subtitle: String?,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    containerColor: Color,
    onClick: () -> Unit,
) {
    Button(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = if (subtitle == null) 56.dp else 68.dp),
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = containerColor,
            contentColor = Color.White,
        ),
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(imageVector = icon, contentDescription = null)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = title, fontWeight = FontWeight.SemiBold)
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        color = Color.White.copy(alpha = 0.85f),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun FeaturedCreateCard() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(140.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.linearGradient(
                    colors = listOf(PorizoColors.Accent, PorizoColors.AccentEnd),
                ),
            )
            .padding(20.dp),
        contentAlignment = Alignment.BottomStart,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            FrauncesTitle(
                text = "Every moment deserves\na song",
                sizeSp = 20,
                color = Color.White,
                weight = FontWeight.SemiBold,
            )
            Text(
                text = "Create something personal",
                color = Color.White.copy(alpha = 0.85f),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun OccasionRail(onOccasionSelected: (Occasion) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "Create for an Occasion",
            color = PorizoColors.TextPrimary,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.bodyLarge,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Order + emoji mirror the iOS occasion rail.
            listOf(
                Occasion.Birthday,
                Occasion.MothersDay,
                Occasion.Anniversary,
                Occasion.ThankYou,
                Occasion.Wedding,
                Occasion.Graduation,
                Occasion.ILoveYou,
            ).forEach { occasion ->
                OutlinedButton(
                    onClick = { onOccasionSelected(occasion) },
                    modifier = Modifier.heightIn(min = 44.dp),
                    border = BorderStroke(1.dp, PorizoColors.Border),
                    shape = RoundedCornerShape(22.dp),
                ) {
                    Text(
                        text = "${occasionEmoji(occasion)}  ${occasion.displayName}",
                        color = PorizoColors.TextPrimary,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
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

/// Emoji for the occasion chips, matching the iOS occasion rail.
private fun occasionEmoji(occasion: Occasion): String = when (occasion) {
    Occasion.Birthday -> "🎂"
    Occasion.MothersDay -> "💐"
    Occasion.Anniversary -> "💑"
    Occasion.ThankYou -> "🙏"
    Occasion.Wedding -> "💍"
    Occasion.Graduation -> "🎓"
    Occasion.ILoveYou -> "❤️"
    else -> "✨"
}
