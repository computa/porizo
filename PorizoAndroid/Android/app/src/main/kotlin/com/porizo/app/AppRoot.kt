package com.porizo.app

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.porizo.app.navigation.AppNavigationShell
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.media.PorizoPlayer
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoTheme
import com.porizo.feature.auth.AuthScreen
import com.porizo.feature.auth.AuthViewModel
import com.porizo.feature.claim.ClaimViewModel
import com.porizo.feature.create.CreateViewModel
import com.porizo.feature.library.PoemsViewModel
import com.porizo.feature.library.SongsViewModel
import com.porizo.feature.onboarding.OnboardingScreen
import com.porizo.feature.onboarding.OnboardingViewModel
import com.porizo.feature.settings.SettingsViewModel

@Composable
fun AppRoot(
    authViewModel: AuthViewModel,
    claimViewModel: ClaimViewModel,
    createViewModel: CreateViewModel,
    songsViewModel: SongsViewModel,
    poemsViewModel: PoemsViewModel,
    settingsViewModel: SettingsViewModel,
    player: PorizoPlayer,
    pendingDeepLink: DeepLinkRoute? = null,
    onDeepLinkConsumed: () -> Unit = {},
    resumeSignal: Int = 0,
) {
    val context = LocalContext.current
    val onboardingPreferences = remember {
        context.applicationContext.getSharedPreferences(ONBOARDING_PREFS, android.content.Context.MODE_PRIVATE)
    }
    var onboardingCompleted by rememberSaveable {
        mutableStateOf(onboardingPreferences.getBoolean(KEY_ONBOARDING_COMPLETED, false))
    }
    var authRequested by rememberSaveable { mutableStateOf(false) }
    val authState by authViewModel.uiState.collectAsState()

    PorizoTheme {
        Surface(color = PorizoColors.Background) {
            when {
                !onboardingCompleted -> {
                    val onboardingViewModel: OnboardingViewModel = viewModel()
                    OnboardingScreen(
                        modifier = Modifier.fillMaxSize(),
                        viewModel = onboardingViewModel,
                        onComplete = { recipientName ->
                            onboardingPreferences.edit()
                                .putBoolean(KEY_ONBOARDING_COMPLETED, true)
                                .putString(KEY_ONBOARDING_RECIPIENT, recipientName.orEmpty())
                                .apply()
                            onboardingCompleted = true
                        },
                    )
                }
                authRequested && !authState.isAuthenticated -> {
                    AuthScreen(
                        modifier = Modifier.fillMaxSize(),
                        viewModel = authViewModel,
                        onCancel = { authRequested = false },
                    )
                }
                else -> {
                    AppNavigationShell(
                        modifier = Modifier,
                        pendingDeepLink = pendingDeepLink,
                        onDeepLinkConsumed = onDeepLinkConsumed,
                        authState = authState,
                        onSignInRequested = { authRequested = true },
                        onLogoutRequested = authViewModel::logout,
                        claimViewModel = claimViewModel,
                        createViewModel = createViewModel,
                        songsViewModel = songsViewModel,
                        poemsViewModel = poemsViewModel,
                        settingsViewModel = settingsViewModel,
                        player = player,
                        resumeSignal = resumeSignal,
                    )
                }
            }
        }
    }
}

private const val ONBOARDING_PREFS = "porizo_onboarding"
private const val KEY_ONBOARDING_COMPLETED = "completed"
private const val KEY_ONBOARDING_RECIPIENT = "recipient"
