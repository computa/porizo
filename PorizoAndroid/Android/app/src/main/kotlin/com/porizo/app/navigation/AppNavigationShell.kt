package com.porizo.app.navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.domain.platform.PushRoute
import com.porizo.core.domain.player.PlayerController
import com.porizo.core.model.Occasion
import com.porizo.feature.auth.AuthPhase
import com.porizo.core.ui.PorizoBottomNavigationBar
import com.porizo.core.ui.PorizoBottomNavigationItem
import com.porizo.core.ui.PorizoColors
import com.porizo.feature.auth.AuthUiState
import com.porizo.feature.claim.ClaimCompletion
import com.porizo.feature.claim.ClaimKind
import com.porizo.feature.claim.ClaimSheet
import com.porizo.feature.claim.ClaimViewModel
import com.porizo.feature.create.CreateScreen
import com.porizo.feature.create.CreateViewModel
import com.porizo.feature.create.ExploreScreen
import com.porizo.feature.library.MiniPlayerBar
import com.porizo.feature.library.NowPlayingSheet
import com.porizo.feature.library.PoemsScreen
import com.porizo.feature.library.PoemsViewModel
import com.porizo.feature.library.SongsScreen
import com.porizo.feature.library.SongsViewModel
import com.porizo.feature.settings.SettingsScreen
import com.porizo.feature.settings.SettingsViewModel

@Composable
fun AppNavigationShell(
    pendingDeepLink: DeepLinkRoute?,
    onDeepLinkConsumed: () -> Unit,
    authState: AuthUiState,
    onSignInRequested: () -> Unit,
    onAuthRequiredForDeepLink: (DeepLinkRoute) -> Unit,
    onLogoutRequested: () -> Unit,
    claimViewModel: ClaimViewModel,
    createViewModel: CreateViewModel,
    songsViewModel: SongsViewModel,
    poemsViewModel: PoemsViewModel,
    settingsViewModel: SettingsViewModel,
    player: PlayerController,
    resumeSignal: Int,
    modifier: Modifier = Modifier,
) {
    var selectedTab by rememberSaveable { mutableStateOf(AppTab.Home) }
    var isCreateFlowVisible by rememberSaveable { mutableStateOf(false) }
    var routeNotice by rememberSaveable { mutableStateOf<String?>(null) }
    var showNowPlaying by rememberSaveable { mutableStateOf(false) }

    fun launchCreate(occasion: Occasion? = null) {
        createViewModel.beginNew(occasion = occasion)
        isCreateFlowVisible = true
        selectedTab = AppTab.Home
    }

    fun openClaimRoute(route: DeepLinkRoute) {
        selectedTab = AppTab.Home
        routeNotice = null
        if (!authState.isAuthenticated) {
            onAuthRequiredForDeepLink(route)
            return
        }
        claimViewModel.open(route)
    }

    LaunchedEffect(pendingDeepLink) {
        val route = pendingDeepLink ?: return@LaunchedEffect
        when (route) {
            is DeepLinkRoute.Poem -> {
                selectedTab = AppTab.Poems
                routeNotice = "Opening poem ${route.id}."
            }
            is DeepLinkRoute.PoemShare -> {
                openClaimRoute(route)
            }
            is DeepLinkRoute.ReceiverHandoff -> {
                openClaimRoute(route)
            }
            is DeepLinkRoute.Share -> {
                openClaimRoute(route)
            }
            is DeepLinkRoute.Unknown -> {
                selectedTab = AppTab.Home
                routeNotice = "This link is not supported yet."
            }
        }
        onDeepLinkConsumed()
    }

    LaunchedEffect(claimViewModel) {
        claimViewModel.completionEvents.collect { completion ->
            when (completion.kind) {
                ClaimKind.TrackShare,
                ClaimKind.ReceiverHandoff -> {
                    selectedTab = AppTab.Songs
                    routeNotice = if (completion.playableTrack != null) {
                        "Saved to Songs. Playing now."
                    } else {
                        "Saved to Songs."
                    }
                    songsViewModel.refresh()
                }
                ClaimKind.PoemShare -> {
                    selectedTab = AppTab.Poems
                    routeNotice = "Saved to Poems."
                    poemsViewModel.refresh()
                }
            }
        }
    }

    LaunchedEffect(resumeSignal) {
        when (val pushRoute = settingsViewModel.consumePendingPushRoute()) {
            is PushRoute.TrackReveal -> {
                selectedTab = AppTab.Songs
                routeNotice = "Your render is ready: ${pushRoute.trackId}."
                songsViewModel.openTrackReveal(pushRoute.trackId)
            }
            PushRoute.Informational -> {
                selectedTab = AppTab.Songs
                routeNotice = "Gift activity updated."
            }
            is PushRoute.Unsupported -> {
                selectedTab = AppTab.Songs
                routeNotice = "Notification type is not supported yet."
            }
            null -> Unit
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = PorizoColors.Background,
        bottomBar = {
            Column(modifier = Modifier.fillMaxWidth()) {
                MiniPlayerBar(
                    player = player,
                    onOpenNowPlaying = { showNowPlaying = true },
                )
                PorizoBottomNavigationBar {
                    AppTab.entries.forEach { tab ->
                        PorizoBottomNavigationItem(
                            item = tab.toTabItem(),
                            selected = selectedTab == tab,
                            onClick = { selectedTab = tab },
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        when (selectedTab) {
            AppTab.Home -> {
                if (isCreateFlowVisible) {
                    CreateScreen(
                        viewModel = createViewModel,
                        isAuthenticated = authState.isAuthenticated,
                        onSignInRequested = onSignInRequested,
                        routeNotice = routeNotice,
                        innerPadding = innerPadding,
                        onFlowDone = { isCreateFlowVisible = false },
                    )
                } else {
                    ExploreScreen(
                        routeNotice = routeNotice,
                        onCreate = { launchCreate() },
                        onOccasionSelected = { occasion -> launchCreate(occasion) },
                        onSeeAllSongs = { selectedTab = AppTab.Songs },
                        innerPadding = innerPadding,
                    )
                }
            }
            AppTab.Songs -> SongsScreen(
                viewModel = songsViewModel,
                isAuthenticated = authState.isAuthenticated,
                onSignInRequested = onSignInRequested,
                routeNotice = routeNotice,
                innerPadding = innerPadding,
            )
            AppTab.Poems -> PoemsScreen(
                viewModel = poemsViewModel,
                isAuthenticated = authState.isAuthenticated,
                onSignInRequested = onSignInRequested,
                routeNotice = routeNotice,
                innerPadding = innerPadding,
            )
            AppTab.Settings -> SettingsScreen(
                viewModel = settingsViewModel,
                isAuthenticated = authState.isAuthenticated,
                authenticatedUserId = (authState.phase as? AuthPhase.Authenticated)?.userId,
                onSignInRequested = onSignInRequested,
                onLogoutRequested = onLogoutRequested,
                innerPadding = innerPadding,
            )
        }
    }

    if (showNowPlaying) {
        NowPlayingSheet(
            player = player,
            onDismiss = { showNowPlaying = false },
        )
    }
    ClaimSheet(
        viewModel = claimViewModel,
        onDismiss = claimViewModel::dismiss,
    )
}
