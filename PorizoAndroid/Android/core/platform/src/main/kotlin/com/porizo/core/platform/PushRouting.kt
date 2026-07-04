package com.porizo.core.platform

import com.porizo.core.domain.platform.PushRoute
import org.json.JSONObject

object PushRouting {
    fun route(payloadJson: String): PushRoute? {
        val payload = runCatching { JSONObject(payloadJson) }.getOrNull() ?: return null
        val type = payload.optString("type").takeIf { it.isNotBlank() }
        return when (payload.optString("type")) {
            "render_complete" -> payload.optString("trackId")
                .takeIf { it.isNotBlank() }
                ?.let(PushRoute::TrackReveal)
            "recipient_played" -> PushRoute.Informational
            else -> PushRoute.Unsupported(type)
        }
    }
}
