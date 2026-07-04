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
    private val shareHosts: Set<String> = setOf("porizo.co", "porizo.app"),
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

        if (uri.scheme != "https") {
            return DeepLinkRoute.Unknown(rawUrl)
        }

        parseOneLinkRoute(uri)?.let { return it }

        val host = uri.host.orEmpty().lowercase()
        if (shareHosts.none { allowedHost -> host == allowedHost || host.endsWith(".$allowedHost") }) {
            return DeepLinkRoute.Unknown(rawUrl)
        }

        val parts = uri.path.orEmpty()
            .split("/")
            .filter { it.isNotEmpty() }
        if (parts.size < 2) return DeepLinkRoute.Unknown(rawUrl)

        return when (parts[0]) {
            "s", "play" -> DeepLinkRoute.Share(parts[1])
            "p", "poem" -> DeepLinkRoute.Poem(parts[1])
            "poem-share" -> DeepLinkRoute.PoemShare(parts[1])
            "receiver-handoff" -> DeepLinkRoute.ReceiverHandoff(parts[1])
            else -> DeepLinkRoute.Unknown(rawUrl)
        }
    }

    private fun parseOneLinkRoute(uri: URI): DeepLinkRoute? {
        val host = uri.host.orEmpty().lowercase()
        if (host != "porizo.onelink.me") return null
        val query = parseQuery(uri.rawQuery)
        val candidates = listOfNotNull(
            query["deep_link"],
            query["deep_link_value"],
            query["deep_link_sub1"],
            query["deep_link_sub2"],
        )
        return candidates
            .asSequence()
            .mapNotNull { candidate ->
                val decoded = java.net.URLDecoder.decode(candidate, Charsets.UTF_8.name())
                if (decoded.startsWith("porizo://") || decoded.startsWith("https://")) {
                    parse(decoded).takeUnless { it is DeepLinkRoute.Unknown }
                } else {
                    null
                }
            }
            .firstOrNull()
    }

    private fun parseQuery(rawQuery: String?): Map<String, String> =
        rawQuery.orEmpty()
            .split("&")
            .filter { it.isNotBlank() }
            .mapNotNull { pair ->
                val parts = pair.split("=", limit = 2)
                val key = parts.firstOrNull()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                key to parts.getOrElse(1) { "" }
            }
            .toMap()

    private fun firstPathPart(path: String?): String =
        path.orEmpty().split("/").firstOrNull { it.isNotEmpty() }.orEmpty()
}
