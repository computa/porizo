package com.porizo.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

data class PorizoPalette(
    val background: Color,
    val surface: Color,
    val surfaceMuted: Color,
    val surfaceElevated: Color,
    val inputBackground: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val textMuted: Color,
    val accent: Color,
    val accentDark: Color,
    val accentEnd: Color,
    val roseGold: Color,
    val border: Color,
    val controlBorder: Color,
    val sage: Color,
    val sageBubble: Color,
    val coralBubble: Color,
    val success: Color,
    val warning: Color,
    val error: Color,
)

private val PorizoLightPalette = PorizoPalette(
    background = Color(0xFFFBF7F2),
    surface = Color(0xFFFFFFFF),
    surfaceMuted = Color(0xFFF5F0EB),
    surfaceElevated = Color(0xFFFFFFFF),
    inputBackground = Color(0xFFFFFFFF),
    textPrimary = Color(0xFF2C2420),
    textSecondary = Color(0xFF6B6560),
    textTertiary = Color(0xFF716B65),
    textMuted = Color(0xFF9E9890),
    accent = Color(0xFFE07850),
    accentDark = Color(0xFFC06030),
    accentEnd = Color(0xFFE8966E),
    roseGold = Color(0xFFD4894A),
    border = Color(0xFFE8E2DC),
    controlBorder = Color(0xFFE8E2DC),
    sage = Color(0xFF7B8F6B),
    sageBubble = Color(0xFFE8F0E5),
    coralBubble = Color(0xFFFDE8E0),
    success = Color(0xFF7DD3A6),
    warning = Color(0xFFFF8400),
    error = Color(0xFFEF4444),
)

private val PorizoDarkPalette = PorizoPalette(
    background = Color(0xFF1A1614),
    surface = Color(0xFF252220),
    surfaceMuted = Color(0xFF1E1B19),
    surfaceElevated = Color(0xFF2E2A28),
    inputBackground = Color(0xFF2E2A28),
    textPrimary = Color(0xFFF5F0EB),
    textSecondary = Color(0xFF9E9890),
    textTertiary = Color(0xFF7A7470),
    textMuted = Color(0xFF5A5450),
    accent = Color(0xFFE88A65),
    accentDark = Color(0xFFE07850),
    accentEnd = Color(0xFFEC9E7E),
    roseGold = Color(0xFFDCA060),
    border = Color(0xFF3A3530),
    controlBorder = Color(0xFF3A3530),
    sage = Color(0xFF8DA07D),
    sageBubble = Color(0xFF1E2B1A),
    coralBubble = Color(0xFF3A2018),
    success = Color(0xFF7DD3A6),
    warning = Color(0xFFFF9520),
    error = Color(0xFFEF5555),
)

private val LocalPorizoPalette = staticCompositionLocalOf { PorizoLightPalette }

object PorizoColors {
    val Background: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.background
    val Surface: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.surface
    val SurfaceMuted: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.surfaceMuted
    val SurfaceElevated: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.surfaceElevated
    val InputBackground: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.inputBackground
    val TextPrimary: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.textPrimary
    val TextSecondary: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.textSecondary
    val TextTertiary: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.textTertiary
    val TextMuted: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.textMuted
    val Accent: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.accent
    val AccentDark: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.accentDark
    val AccentEnd: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.accentEnd
    val RoseGold: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.roseGold
    val Border: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.border
    val ControlBorder: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.controlBorder
    val Sage: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.sage
    val SageBubble: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.sageBubble
    val CoralBubble: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.coralBubble
    val Success: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.success
    val Warning: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.warning
    val Error: Color
        @Composable
        @ReadOnlyComposable
        get() = LocalPorizoPalette.current.error
}

object PorizoSpacing {
    val XXSmall = 2
    val XSmall = 4
    val Compact = 6
    val Small = 8
    val Medium = 12
    val Large = 16
    val Section = 20
    val XLarge = 24
    val SectionLarge = 28
    val XXLarge = 32
}

object PorizoRadius {
    val Small = 4
    val XSmall = 8
    val Medium = 12
    val Cta = 14
    val Large = 16
    val Overlay = 20
    val Chip = 22
    val Premium = 24
    val Pill = 25
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

private fun porizoLightColorScheme(palette: PorizoPalette) = lightColorScheme(
    primary = palette.accent,
    onPrimary = Color.White,
    primaryContainer = palette.coralBubble,
    onPrimaryContainer = palette.textPrimary,
    secondary = palette.sage,
    onSecondary = Color.White,
    secondaryContainer = palette.sageBubble,
    onSecondaryContainer = palette.textPrimary,
    background = palette.background,
    onBackground = palette.textPrimary,
    surface = palette.surface,
    onSurface = palette.textPrimary,
    surfaceVariant = palette.surfaceMuted,
    onSurfaceVariant = palette.textSecondary,
    outline = palette.border,
    error = palette.error,
)

@Composable
fun PorizoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val palette = if (darkTheme) PorizoDarkPalette else PorizoLightPalette
    val colorScheme = if (darkTheme) {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = Color.White,
            primaryContainer = palette.coralBubble,
            onPrimaryContainer = palette.textPrimary,
            secondary = palette.sage,
            onSecondary = Color.White,
            secondaryContainer = palette.sageBubble,
            onSecondaryContainer = palette.textPrimary,
            background = palette.background,
            onBackground = palette.textPrimary,
            surface = palette.surface,
            onSurface = palette.textPrimary,
            surfaceVariant = palette.surfaceMuted,
            onSurfaceVariant = palette.textSecondary,
            outline = palette.border,
            error = palette.error,
        )
    } else {
        porizoLightColorScheme(palette)
    }
    CompositionLocalProvider(LocalPorizoPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = PorizoTypography,
            content = content,
        )
    }
}
