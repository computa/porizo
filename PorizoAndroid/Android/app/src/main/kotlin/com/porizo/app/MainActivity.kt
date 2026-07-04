package com.porizo.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.mutableStateOf
import com.porizo.core.domain.deeplink.DeepLinkParser
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.platform.ActivityHolder
import com.porizo.feature.auth.AuthViewModel
import com.porizo.feature.claim.ClaimViewModel
import com.porizo.feature.create.CreateViewModel
import com.porizo.feature.library.PoemsViewModel
import com.porizo.feature.library.SongsViewModel
import com.porizo.feature.settings.SettingsViewModel
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var activityHolder: ActivityHolder

    private val deepLinkParser = DeepLinkParser()
    private val pendingDeepLink = mutableStateOf<DeepLinkRoute?>(null)
    private val resumeSignal = mutableStateOf(0)
    private val authViewModel: AuthViewModel by viewModels()
    private val claimViewModel: ClaimViewModel by viewModels()
    private val createViewModel: CreateViewModel by viewModels()
    private val songsViewModel: SongsViewModel by viewModels()
    private val poemsViewModel: PoemsViewModel by viewModels()
    private val settingsViewModel: SettingsViewModel by viewModels()
    private val playerViewModel: PlayerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activityHolder.set(this)
        enableEdgeToEdge()
        maybeBypassAuth(intent)
        handleIntent(intent)
        setContent {
            AppRoot(
                pendingDeepLink = pendingDeepLink.value,
                onDeepLinkConsumed = { pendingDeepLink.value = null },
                authViewModel = authViewModel,
                claimViewModel = claimViewModel,
                createViewModel = createViewModel,
                songsViewModel = songsViewModel,
                poemsViewModel = poemsViewModel,
                settingsViewModel = settingsViewModel,
                player = playerViewModel.player,
                resumeSignal = resumeSignal.value,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        activityHolder.set(this)
        resumeSignal.value += 1
    }

    override fun onPause() {
        activityHolder.set(null)
        super.onPause()
    }

    private fun handleIntent(intent: Intent?) {
        val rawUrl = intent?.data?.toString() ?: return
        val route = deepLinkParser.parse(rawUrl)
        Log.i(TAG, "received app link: $rawUrl -> $route")
        pendingDeepLink.value = route
    }

    /// DEBUG-only: `am start … --ez bypass_auth true` flips to an authed session
    /// so authed-state layouts are drivable without a login (iOS `--bypass-auth`
    /// analog). No effect in release builds; list DATA still needs a real token.
    private fun maybeBypassAuth(intent: Intent?) {
        if (!BuildConfig.DEBUG) return
        if (intent?.getBooleanExtra(EXTRA_BYPASS_AUTH, false) == true) {
            Log.i(TAG, "debug bypass-auth enabled")
            authViewModel.debugBypassAuth()
        }
    }

    private companion object {
        const val TAG = "PorizoAndroid"
        const val EXTRA_BYPASS_AUTH = "bypass_auth"
    }
}
