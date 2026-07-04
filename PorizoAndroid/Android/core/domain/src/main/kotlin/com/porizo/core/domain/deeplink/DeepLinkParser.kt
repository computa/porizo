package com.porizo.core.domain.deeplink

import java.net.URI

sealed interface DeepLinkRoute {
    data class Share(val id: String) : DeepLinkRoute
    data class ReceiverHandoff(val id: String) : DeepLinkRoute
    data class Poem(val id: String) : DeepLinkRoute
    data class PoemShare(val id: String) : DeepLinkRoute
    data class Unknown(val rawUrl: String) : DeepLinkRoute
}

class DeepLinkParser(
    private val shareHost: String = "porizo.app",
) {
    fun parse(rawUrl: String): DeepLinkRoute {
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return DeepLinkRoute.Unknown(rawUrl)

        if (uri.scheme == "porizo") {
            val id = firstPathPart(uri.path)
            if (id.isEmpty()) return DeepLinkRoute.Unknown(rawUrl)
            return when (uri.host) {
                "receiver-handoff" -> DeepLinkRoute.ReceiverHandoff(id)
                "poem-share" -> DeepLinkRoute.PoemShare(id)
                "s", "play", "share" -> DeepLinkRoute.Share(id)
                "poem" -> DeepLinkRoute.Poem(id)
                else -> DeepLinkRoute.Unknown(rawUrl)
            }
        }

        if (uri.scheme != "https" || uri.host != shareHost) {
            return DeepLinkRoute.Unknown(rawUrl)
        }

        val parts = uri.path.orEmpty()
            .split("/")
            .filter { it.isNotEmpty() }
        if (parts.size < 2) return DeepLinkRoute.Unknown(rawUrl)

        return when (parts[0]) {
            "s", "play" -> DeepLinkRoute.Share(parts[1])
            "poem" -> DeepLinkRoute.Poem(parts[1])
            "poem-share" -> DeepLinkRoute.PoemShare(parts[1])
            "receiver-handoff" -> DeepLinkRoute.ReceiverHandoff(parts[1])
            else -> DeepLinkRoute.Unknown(rawUrl)
        }
    }

    private fun firstPathPart(path: String?): String =
        path.orEmpty().split("/").firstOrNull { it.isNotEmpty() }.orEmpty()
}
