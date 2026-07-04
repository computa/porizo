package com.porizo.core.network

import com.squareup.moshi.Moshi
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

fun interface AccessTokenProvider {
    fun currentAccessToken(): String?
}

class PorizoHeaderInterceptor(
    private val appVersion: String,
    private val accessTokenProvider: AccessTokenProvider,
    private val authenticatedHost: String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder()
            .header("User-Agent", "PorizoAndroid/$appVersion")

        if (shouldAttachAuthorization(original.url.host, authenticatedHost)) {
            accessTokenProvider.currentAccessToken()
                ?.takeIf { it.isNotBlank() }
                ?.let { builder.header("Authorization", "Bearer $it") }
        }

        return chain.proceed(builder.build())
    }
}

internal fun shouldAttachAuthorization(requestHost: String, authenticatedHost: String?): Boolean =
    authenticatedHost == null || requestHost.equals(authenticatedHost, ignoreCase = true)

object PorizoNetworkClient {
    fun moshi(): Moshi = Moshi.Builder().build()

    fun okHttpClient(
        baseUrl: String,
        appVersion: String,
        accessTokenProvider: AccessTokenProvider,
    ): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(
            PorizoHeaderInterceptor(
                appVersion = appVersion,
                accessTokenProvider = accessTokenProvider,
                authenticatedHost = baseUrl.toHttpUrl().host,
            ),
        )
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    fun apiService(
        baseUrl: String,
        okHttpClient: OkHttpClient,
        moshi: Moshi = moshi(),
    ): PorizoApiService {
        val normalizedBaseUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return Retrofit.Builder()
            .baseUrl(normalizedBaseUrl)
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(PorizoApiService::class.java)
    }
}
