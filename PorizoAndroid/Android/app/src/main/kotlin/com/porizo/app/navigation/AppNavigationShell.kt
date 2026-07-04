package com.porizo.app.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.ui.FrauncesTitle
import com.porizo.core.ui.PorizoBottomNavigationBar
import com.porizo.core.ui.PorizoBottomNavigationItem
import com.porizo.core.ui.PorizoCard
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoPrimaryButton
import com.porizo.core.ui.PorizoScreen
import com.porizo.core.ui.PorizoSecondaryButton
import com.porizo.core.ui.PorizoSectionLabel
import com.porizo.feature.auth.AuthPhase
import com.porizo.feature.auth.AuthUiState

@Composable
fun AppNavigationShell(
    pendingDeepLink: DeepLinkRoute?,
    onDeepLinkConsumed: () -> Unit,
    authState: AuthUiState,
    onSignInRequested: () -> Unit,
    onLogoutRequested: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var selectedTab by rememberSaveable { mutableStateOf(AppTab.Home) }
    var routeNotice by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(pendingDeepLink) {
        val route = pendingDeepLink ?: return@LaunchedEffect
        when (route) {
            is DeepLinkRoute.Poem -> {
                selectedTab = AppTab.Poems
                routeNotice = "Opening poem ${route.id}."
            }
            is DeepLinkRoute.PoemShare -> {
                selectedTab = AppTab.Poems
                routeNotice = "Poem share ${route.id} is ready for the claim flow."
            }
            is DeepLinkRoute.ReceiverHandoff -> {
                selectedTab = AppTab.Home
                routeNotice = "Receiver handoff ${route.id} is ready for the claim flow."
            }
            is DeepLinkRoute.Share -> {
                selectedTab = AppTab.Home
                routeNotice = "Share ${route.id} is ready for the claim flow."
            }
            is DeepLinkRoute.Unknown -> {
                selectedTab = AppTab.Home
                routeNotice = "This link is not supported yet."
            }
        }
        onDeepLinkConsumed()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = PorizoColors.Background,
        bottomBar = {
            PorizoBottomNavigationBar {
                AppTab.entries.forEach { tab ->
                    PorizoBottomNavigationItem(
                        item = tab.toTabItem(),
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                    )
                }
            }
        },
    ) { innerPadding ->
        when (selectedTab) {
            AppTab.Home -> HomeScreen(routeNotice, innerPadding)
            AppTab.Songs -> SongsScreen(routeNotice, innerPadding)
            AppTab.Poems -> PoemsScreen(routeNotice, innerPadding)
            AppTab.Settings -> SettingsScreen(
                authState = authState,
                onSignInRequested = onSignInRequested,
                onLogoutRequested = onLogoutRequested,
                innerPadding = innerPadding,
            )
        }
    }
}

@Composable
private fun HomeScreen(routeNotice: String?, innerPadding: PaddingValues) {
    PorizoScreen(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding),
        title = "Home",
        subtitle = "Create something personal, then send it as a private gift.",
    ) {
        RouteNotice(routeNotice)
        PorizoSectionLabel("Start")
        PorizoCard {
            Icon(
                imageVector = Icons.Filled.CardGiftcard,
                contentDescription = null,
                tint = PorizoColors.Accent,
            )
            FrauncesTitle(text = "Make a gift", sizeSp = 24)
            Text(
                text = "Turn a memory, inside joke, or message into a song or poem.",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyLarge,
            )
            PorizoPrimaryButton(
                text = "Create",
                onClick = {},
                icon = Icons.Filled.MusicNote,
            )
            PorizoSecondaryButton(
                text = "Claim a gift",
                onClick = {},
                icon = Icons.Filled.Sms,
            )
        }
    }
}

@Composable
private fun SongsScreen(routeNotice: String?, innerPadding: PaddingValues) {
    PorizoScreen(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding),
        title = "Songs",
        subtitle = "Songs you make or receive stay here.",
    ) {
        RouteNotice(routeNotice)
        PorizoCard {
            Icon(
                imageVector = Icons.Filled.PlayArrow,
                contentDescription = null,
                tint = PorizoColors.Accent,
            )
            Text(
                text = "No songs yet",
                color = PorizoColors.TextPrimary,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = "Finished songs and claimed gifts will appear in this library.",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun PoemsScreen(routeNotice: String?, innerPadding: PaddingValues) {
    PorizoScreen(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding),
        title = "Poems",
        subtitle = "Keep written gifts and spoken versions together.",
    ) {
        RouteNotice(routeNotice)
        PorizoCard {
            Text(
                text = "No poems yet",
                color = PorizoColors.TextPrimary,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = "Poems you create or receive will appear here.",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun SettingsScreen(
    authState: AuthUiState,
    onSignInRequested: () -> Unit,
    onLogoutRequested: () -> Unit,
    innerPadding: PaddingValues,
) {
    PorizoScreen(
        modifier = Modifier
            .fillMaxSize()
            .padding(innerPadding),
        title = "Settings",
        subtitle = "Manage account, subscription, voice, and notifications.",
    ) {
        val authenticated = authState.phase as? AuthPhase.Authenticated
        PorizoCard {
            Text(
                text = "Account",
                color = PorizoColors.TextPrimary,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = authenticated?.let { "Signed in as ${it.userId}" } ?: "Sign in and restore your library",
                color = PorizoColors.TextSecondary,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (authenticated == null) {
                PorizoPrimaryButton(
                    text = "Sign in",
                    onClick = onSignInRequested,
                )
            } else {
                PorizoSecondaryButton(
                    text = "Sign out",
                    onClick = onLogoutRequested,
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PorizoSettingRow("Subscription", "Manage song and poem credits")
            PorizoSettingRow("Voice", "Prepare your voice for personalized songs")
            PorizoSettingRow("Notifications", "Control gift and render updates")
        }
    }
}

@Composable
private fun PorizoSettingRow(title: String, subtitle: String) {
    PorizoCard {
        Text(
            text = title,
            color = PorizoColors.TextPrimary,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = subtitle,
            color = PorizoColors.TextSecondary,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun RouteNotice(routeNotice: String?) {
    if (routeNotice == null) return
    PorizoCard {
        Text(
            text = routeNotice,
            color = PorizoColors.TextPrimary,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
