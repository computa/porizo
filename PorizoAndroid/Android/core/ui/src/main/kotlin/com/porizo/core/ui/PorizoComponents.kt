package com.porizo.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class PorizoTabItem<T>(
    val value: T,
    val label: String,
    val icon: ImageVector,
    val contentDescription: String = label,
)

@Composable
fun PorizoScreen(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FrauncesTitle(
                text = title,
                sizeSp = 36,
                modifier = Modifier.semantics { heading() },
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    color = PorizoColors.TextSecondary,
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
        content()
    }
}

@Composable
fun FrauncesTitle(
    text: String,
    sizeSp: Int,
    modifier: Modifier = Modifier,
    color: androidx.compose.ui.graphics.Color = PorizoColors.TextPrimary,
    weight: FontWeight = FontWeight.Bold,
) {
    Text(
        text = text,
        modifier = modifier,
        color = color,
        fontFamily = Fraunces,
        fontWeight = weight,
        fontSize = sizeSp.sp,
        lineHeight = (sizeSp + 5).sp,
    )
}

@Composable
fun PorizoSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        color = PorizoColors.TextTertiary,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
fun PorizoCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = PorizoColors.Surface),
        shape = RoundedCornerShape(PorizoRadius.Large.dp),
        border = BorderStroke(1.dp, PorizoColors.Border),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
fun PorizoPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    Button(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp),
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = PorizoColors.Accent,
            contentColor = androidx.compose.ui.graphics.Color.White,
        ),
        shape = RoundedCornerShape(PorizoRadius.Cta.dp),
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null)
        }
        Text(
            text = text,
            fontWeight = FontWeight.SemiBold,
            modifier = if (icon == null) Modifier else Modifier.padding(start = 8.dp),
        )
    }
}

@Composable
fun PorizoSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    OutlinedButton(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp),
        onClick = onClick,
        enabled = enabled,
        border = BorderStroke(1.dp, PorizoColors.ControlBorder),
        shape = RoundedCornerShape(PorizoRadius.Cta.dp),
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null)
        }
        Text(
            text = text,
            color = PorizoColors.TextPrimary,
            fontWeight = FontWeight.SemiBold,
            modifier = if (icon == null) Modifier else Modifier.padding(start = 8.dp),
        )
    }
}

@Composable
fun PorizoTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 4,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = PorizoColors.Surface,
            unfocusedContainerColor = PorizoColors.Surface,
            focusedIndicatorColor = PorizoColors.Accent,
            unfocusedIndicatorColor = PorizoColors.ControlBorder,
            focusedLabelColor = PorizoColors.AccentDark,
            cursorColor = PorizoColors.Accent,
        ),
        shape = RoundedCornerShape(PorizoRadius.Medium.dp),
    )
}

@Composable
fun PorizoBottomNavigationBar(content: @Composable RowScope.() -> Unit) {
    NavigationBar(
        containerColor = PorizoColors.Surface,
        contentColor = PorizoColors.TextPrimary,
        tonalElevation = 0.dp,
        content = content,
    )
}

@Composable
fun <T> RowScope.PorizoBottomNavigationItem(
    item: PorizoTabItem<T>,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .weight(1f)
            .heightIn(min = 64.dp)
            .padding(horizontal = 4.dp, vertical = 6.dp)
            .background(
                color = if (selected) PorizoColors.CoralBubble else Color.Transparent,
                shape = CircleShape,
            )
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = item.contentDescription
                this.selected = selected
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = item.icon,
            contentDescription = null,
            tint = if (selected) PorizoColors.TextPrimary else PorizoColors.TextTertiary,
        )
        Text(
            text = item.label,
            color = if (selected) PorizoColors.TextPrimary else PorizoColors.TextTertiary,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
        )
    }
}
