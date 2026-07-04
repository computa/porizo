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
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var activityHolder: ActivityHolder

    private val deepLinkParser = DeepLinkParser()
    private val pendingDeepLink = mutableStateOf<DeepLinkRoute?>(null)
    private val authViewModel: AuthViewModel by viewModels()
    private val claimViewModel: ClaimViewModel by viewModels()
    private val createViewModel: CreateViewModel by viewModels()
    private val songsViewModel: SongsViewModel by viewModels()
    private val poemsViewModel: PoemsViewModel by viewModels()
    private val playerViewModel: PlayerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activityHolder.set(this)
        enableEdgeToEdge()
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
                player = playerViewModel.player,
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

    private companion object {
        const val TAG = "PorizoAndroid"
    }
}
