package com.porizo.app

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.porizo.app.navigation.AppNavigationShell
import com.porizo.core.domain.deeplink.DeepLinkRoute
import com.porizo.core.ui.PorizoColors
import com.porizo.core.ui.PorizoTheme

@Composable
fun AppRoot(
    pendingDeepLink: DeepLinkRoute? = null,
    onDeepLinkConsumed: () -> Unit = {},
) {
    PorizoTheme {
        Surface(color = PorizoColors.Background) {
            AppNavigationShell(
                modifier = Modifier,
                pendingDeepLink = pendingDeepLink,
                onDeepLinkConsumed = onDeepLinkConsumed,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun AppRootPreview() {
    AppRoot()
}
