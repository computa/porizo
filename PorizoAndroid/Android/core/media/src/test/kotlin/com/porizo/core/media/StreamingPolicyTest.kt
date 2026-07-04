package com.porizo.core.media

import com.porizo.core.model.PlayableTrack
import kotlin.test.Test
import kotlin.test.assertEquals

class StreamingPolicyTest {
    @Test
    fun sameOriginClaimedShareStreamsCarryDeviceTokenOnly() {
        val baseUrl = "https://api.porizo.test/"
        val absoluteUrl = StreamingPolicy.absoluteUrl("/share/share_1/playlist", baseUrl)
        val headers = StreamingPolicy.headersFor(
            track = PlayableTrack(
                id = "share_1",
                title = "For Sarah",
                recipientName = "Sarah",
                artworkUrl = null,
                streamUrl = "/share/share_1/playlist",
                isOwnedContent = false,
                requiresAuthorization = false,
                requiresDeviceToken = true,
            ),
            absoluteUrl = absoluteUrl,
            baseUrl = baseUrl,
            accessToken = "access-token",
            deviceToken = "device-token",
        )

        assertEquals(mapOf("x-device-token" to "device-token"), headers)
    }

    @Test
    fun sameOriginOwnedLibraryStreamsCarryAuthorizationOnly() {
        val baseUrl = "https://api.porizo.test/"
        val absoluteUrl = StreamingPolicy.absoluteUrl("/tracks/track_1/full.mp3", baseUrl)
        val headers = StreamingPolicy.headersFor(
            track = PlayableTrack(
                id = "track_1",
                title = "For Sarah",
                recipientName = "Sarah",
                artworkUrl = null,
                streamUrl = "/tracks/track_1/full.mp3",
                isOwnedContent = true,
            ),
            absoluteUrl = absoluteUrl,
            baseUrl = baseUrl,
            accessToken = "access-token",
            deviceToken = "device-token",
        )

        assertEquals(mapOf("Authorization" to "Bearer access-token"), headers)
    }

    @Test
    fun externalPresignedUrlsNeverReceivePorizoCredentials() {
        val headers = StreamingPolicy.headersFor(
            track = PlayableTrack(
                id = "track_1",
                title = "For Sarah",
                recipientName = "Sarah",
                artworkUrl = null,
                streamUrl = "https://media.example-cdn.test/full.m4a?X-Amz-Signature=signed",
                isOwnedContent = true,
                requiresAuthorization = true,
                requiresDeviceToken = true,
            ),
            absoluteUrl = "https://media.example-cdn.test/full.m4a?X-Amz-Signature=signed",
            baseUrl = "https://api.porizo.test/",
            accessToken = "access-token",
            deviceToken = "device-token",
        )

        assertEquals(emptyMap(), headers)
    }

    @Test
    fun sameOriginChecksIncludePort() {
        val headers = StreamingPolicy.headersFor(
            track = PlayableTrack(
                id = "track_1",
                title = "For Sarah",
                recipientName = "Sarah",
                artworkUrl = null,
                streamUrl = "https://api.porizo.test:9443/tracks/track_1/full.mp3",
                isOwnedContent = true,
            ),
            absoluteUrl = "https://api.porizo.test:9443/tracks/track_1/full.mp3",
            baseUrl = "https://api.porizo.test/",
            accessToken = "access-token",
            deviceToken = null,
        )

        assertEquals(emptyMap(), headers)
    }
}
