package com.porizo.core.network

import kotlin.test.assertEquals
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

class PorizoHeaderInterceptorTest {
    @Test
    fun attachesAuthorizationToApiHost() {
        assertTrue(shouldAttachAuthorization("api.porizo.co", "api.porizo.co"))
    }

    @Test
    fun skipsAuthorizationForAbsoluteUploadHost() {
        assertFalse(shouldAttachAuthorization("storage.googleapis.com", "api.porizo.co"))
    }

    @Test
    fun interceptorAddsBearerOnlyToAuthenticatedHost() {
        val apiRequest = interceptedRequest("https://api.porizo.co/tracks")
        val storageRequest = interceptedRequest("https://storage.googleapis.com/porizo-upload")

        assertEquals("PorizoAndroid/1.2.3", apiRequest.header("User-Agent"))
        assertEquals("Bearer session-token", apiRequest.header("Authorization"))
        assertEquals("PorizoAndroid/1.2.3", storageRequest.header("User-Agent"))
        assertNull(storageRequest.header("Authorization"))
    }

    private fun interceptedRequest(url: String): Request {
        var intercepted: Request? = null
        val client = OkHttpClient.Builder()
            .addInterceptor(
                PorizoHeaderInterceptor(
                    appVersion = "1.2.3",
                    accessTokenProvider = AccessTokenProvider { "session-token" },
                    authenticatedHost = "api.porizo.co",
                ),
            )
            .addInterceptor { chain ->
                val request = chain.request()
                intercepted = request
                Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(204)
                    .message("No Content")
                    .body("".toResponseBody())
                    .build()
            }
            .build()

        client.newCall(Request.Builder().url(url).build()).execute().close()

        return requireNotNull(intercepted)
    }
}
