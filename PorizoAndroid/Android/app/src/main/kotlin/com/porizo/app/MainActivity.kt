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
import com.porizo.feature.auth.AuthViewModel
import com.porizo.feature.claim.ClaimViewModel
import com.porizo.feature.library.PoemsViewModel
import com.porizo.feature.library.SongsViewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val deepLinkParser = DeepLinkParser()
    private val pendingDeepLink = mutableStateOf<DeepLinkRoute?>(null)
    private val authViewModel: AuthViewModel by viewModels()
    private val claimViewModel: ClaimViewModel by viewModels()
    private val songsViewModel: SongsViewModel by viewModels()
    private val poemsViewModel: PoemsViewModel by viewModels()
    private val playerViewModel: PlayerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent {
            AppRoot(
                pendingDeepLink = pendingDeepLink.value,
                onDeepLinkConsumed = { pendingDeepLink.value = null },
                authViewModel = authViewModel,
                claimViewModel = claimViewModel,
                songsViewModel = songsViewModel,
                poemsViewModel = poemsViewModel,
                player = playerViewModel.player,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val rawUrl = intent?.data?.toString() ?: return
        val route = deepLinkParser.parse(rawUrl)
        Log.i(TAG, "received app link: $rawUrl -> $route")
        pendingDeepLink.value = route
    }

    private companion object {
        const val TAG = "PorizoAndroid"
    }
}
