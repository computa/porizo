package com.porizo.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import com.porizo.core.domain.deeplink.DeepLinkParser
import com.porizo.core.domain.deeplink.DeepLinkRoute
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val deepLinkParser = DeepLinkParser()
    private val pendingDeepLink = mutableStateOf<DeepLinkRoute?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleIntent(intent)
        setContent {
            AppRoot(
                pendingDeepLink = pendingDeepLink.value,
                onDeepLinkConsumed = { pendingDeepLink.value = null },
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
