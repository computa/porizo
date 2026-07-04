package com.porizo.core.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object PorizoColors {
    val Background = Color(0xFFFBF7F2)
    val Surface = Color(0xFFFFFFFF)
    val SurfaceMuted = Color(0xFFF5F0EB)
    val SurfaceElevated = Color(0xFFFFFFFF)
    val TextPrimary = Color(0xFF2C2420)
    val TextSecondary = Color(0xFF6B6560)
    val TextTertiary = Color(0xFF716B65)
    val TextMuted = Color(0xFF9E9890)
    val Accent = Color(0xFFE07850)
    val AccentDark = Color(0xFFC06030)
    val AccentEnd = Color(0xFFE8966E)
    val Border = Color(0xFFE8E2DC)
    val ControlBorder = Color(0xFF948E88)
    val Sage = Color(0xFF7B8F6B)
    val SageBubble = Color(0xFFE8F0E5)
    val CoralBubble = Color(0xFFFDE8E0)
    val Success = Color(0xFF059669)
    val Warning = Color(0xFFFF8400)
    val Error = Color(0xFFEF4444)
}

object PorizoSpacing {
    val XSmall = 4
    val Small = 8
    val Medium = 12
    val Large = 16
    val XLarge = 24
    val XXLarge = 32
}

object PorizoRadius {
    val Small = 4
    val Medium = 12
    val Cta = 14
    val Large = 16
    val Overlay = 20
}

val Fraunces = FontFamily(
    Font(R.font.fraunces_regular, FontWeight.Normal),
    Font(R.font.fraunces_medium, FontWeight.Medium),
    Font(R.font.fraunces_semibold, FontWeight.SemiBold),
    Font(R.font.fraunces_bold, FontWeight.Bold),
)

private val PorizoTypography = Typography(
    displayMedium = TextStyle(
        fontFamily = Fraunces,
        fontWeight = FontWeight.Bold,
        fontSize = 38.sp,
        lineHeight = 42.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = Fraunces,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
        lineHeight = 24.sp,
    ),
    bodyLarge = TextStyle(
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp,
        lineHeight = 21.sp,
    ),
    labelLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
)

private val PorizoLightColorScheme = lightColorScheme(
    primary = PorizoColors.Accent,
    onPrimary = Color.White,
    primaryContainer = PorizoColors.CoralBubble,
    onPrimaryContainer = PorizoColors.TextPrimary,
    secondary = PorizoColors.Sage,
    onSecondary = Color.White,
    secondaryContainer = PorizoColors.SageBubble,
    onSecondaryContainer = PorizoColors.TextPrimary,
    background = PorizoColors.Background,
    onBackground = PorizoColors.TextPrimary,
    surface = PorizoColors.Surface,
    onSurface = PorizoColors.TextPrimary,
    surfaceVariant = PorizoColors.SurfaceMuted,
    onSurfaceVariant = PorizoColors.TextSecondary,
    outline = PorizoColors.Border,
    error = PorizoColors.Error,
)

@Composable
fun PorizoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PorizoLightColorScheme,
        typography = PorizoTypography,
        content = content,
    )
}
