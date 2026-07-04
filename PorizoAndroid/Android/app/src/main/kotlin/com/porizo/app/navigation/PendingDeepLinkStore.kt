package com.porizo.app.navigation

import android.content.Context
import com.porizo.core.domain.deeplink.DeepLinkRoute

class PendingDeepLinkStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun save(route: DeepLinkRoute) {
        val encoded = route.encode() ?: return
        preferences.edit().putString(KEY_ROUTE, encoded).apply()
    }

    fun load(): DeepLinkRoute? =
        preferences.getString(KEY_ROUTE, null)?.decodeRoute()

    fun clear() {
        preferences.edit().remove(KEY_ROUTE).apply()
    }

    private fun DeepLinkRoute.encode(): String? =
        when (this) {
            is DeepLinkRoute.Share -> "share:$id"
            is DeepLinkRoute.PoemShare -> "poem_share:$id"
            is DeepLinkRoute.ReceiverHandoff -> "receiver_handoff:$id"
            is DeepLinkRoute.Poem -> "poem:$id"
            is DeepLinkRoute.Unknown -> null
        }

    private fun String.decodeRoute(): DeepLinkRoute? {
        val parts = split(":", limit = 2)
        val type = parts.getOrNull(0)
        val id = parts.getOrNull(1)?.takeIf { it.isNotBlank() } ?: return null
        return when (type) {
            "share" -> DeepLinkRoute.Share(id)
            "poem_share" -> DeepLinkRoute.PoemShare(id)
            "receiver_handoff" -> DeepLinkRoute.ReceiverHandoff(id)
            "poem" -> DeepLinkRoute.Poem(id)
            else -> null
        }
    }

    private companion object {
        const val PREFS_NAME = "porizo_pending_deeplink"
        const val KEY_ROUTE = "route"
    }
}
