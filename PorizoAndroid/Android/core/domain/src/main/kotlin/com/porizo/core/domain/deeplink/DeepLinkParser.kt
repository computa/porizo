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
            val query = parseQuery(uri.rawQuery)
            val pathParts = pathParts(uri.path)
            // Host-based (porizo://receiver-handoff/<id>): host = route, id = first path part.
            // Triple-slash (porizo:///receiver-handoff/<id>): route = first path part, id = second.
            val segment = if (uri.host.isNullOrBlank()) pathParts.getOrNull(0) else uri.host
            val id = if (uri.host.isNullOrBlank()) {
                pathParts.getOrElse(1) { "" }
            } else {
                pathParts.getOrElse(0) { "" }
            }
            when (segment) {
                "receiver-handoff" -> if (id.isNotEmpty()) return DeepLinkRoute.ReceiverHandoff(id)
                "poem-share" -> if (id.isNotEmpty()) return DeepLinkRoute.PoemShare(id)
                "s", "play", "share" -> if (id.isNotEmpty()) return DeepLinkRoute.Share(id)
                "poem" -> if (id.isNotEmpty()) return DeepLinkRoute.Poem(id)
            }
            // Query-param form: porizo://open?deep_link_value=<id>&deep_link_sub2=<kind>
            val bareId = query["deep_link_value"]?.let { decodeQueryValue(it) }
            val contentKind = query["deep_link_sub2"]?.let { decodeQueryValue(it) }
                ?: query["content_kind"]?.let { decodeQueryValue(it) }
            routeForBareId(bareId, contentKind)?.let { return it }
            return DeepLinkRoute.Unknown(rawUrl)
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
        val contentKind = query["deep_link_sub2"]?.let { decodeQueryValue(it) }
            ?: query["content_kind"]?.let { decodeQueryValue(it) }
        return candidates
            .asSequence()
            .mapNotNull { candidate ->
                val decoded = decodeQueryValue(candidate)
                if (decoded.startsWith("porizo://") || decoded.startsWith("https://")) {
                    parse(decoded).takeUnless { it is DeepLinkRoute.Unknown }
                } else {
                    routeForBareId(decoded, contentKind)
                }
            }
            .firstOrNull()
    }

    private fun routeForBareId(id: String?, contentKind: String?): DeepLinkRoute? {
        val trimmed = id?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        return when {
            trimmed.startsWith("rh_") -> DeepLinkRoute.ReceiverHandoff(trimmed)
            trimmed.startsWith("ps_") -> DeepLinkRoute.PoemShare(trimmed)
            contentKind?.equals("poem", ignoreCase = true) == true -> DeepLinkRoute.PoemShare(trimmed)
            else -> null
        }
    }

    private fun decodeQueryValue(value: String): String =
        runCatching { java.net.URLDecoder.decode(value, Charsets.UTF_8.name()) }.getOrDefault(value)

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

    private fun pathParts(path: String?): List<String> =
        path.orEmpty().split("/").filter { it.isNotEmpty() }
}
