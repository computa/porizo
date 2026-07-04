package com.porizo.core.network

import com.squareup.moshi.Moshi
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

fun interface AccessTokenProvider {
    fun currentAccessToken(): String?
}

class PorizoHeaderInterceptor(
    private val appVersion: String,
    private val accessTokenProvider: AccessTokenProvider,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder()
            .header("User-Agent", "PorizoAndroid/$appVersion")

        accessTokenProvider.currentAccessToken()
            ?.takeIf { it.isNotBlank() }
            ?.let { builder.header("Authorization", "Bearer $it") }

        return chain.proceed(builder.build())
    }
}

object PorizoNetworkClient {
    fun moshi(): Moshi = Moshi.Builder().build()

    fun okHttpClient(
        appVersion: String,
        accessTokenProvider: AccessTokenProvider,
    ): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(PorizoHeaderInterceptor(appVersion, accessTokenProvider))
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
