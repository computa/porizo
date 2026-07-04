package com.porizo.core.data

import android.content.Context
import com.porizo.core.datastore.AndroidSessionStore
import com.porizo.core.datastore.RenderPollStore
import com.porizo.core.network.AccessTokenProvider
import com.porizo.core.network.PorizoApiService
import com.porizo.core.network.PorizoNetworkClient

class PorizoDataGraph private constructor(
    val sessionStore: AndroidSessionStore,
    val apiService: PorizoApiService,
    val authRepository: DefaultAuthRepository,
    val createRepository: DefaultCreateRepository,
    val renderRepository: DefaultRenderRepository,
    val libraryRepository: DefaultLibraryRepository,
    val shareRepository: DefaultShareRepository,
    val billingRepository: DefaultBillingRepository,
    val pushRepository: DefaultPushRepository,
    val voiceEnrollmentRepository: DefaultVoiceEnrollmentRepository,
) {
    fun currentAccessToken(): String? = sessionStore.currentAccessToken()

    companion object {
        fun create(
            context: Context,
            baseUrl: String,
            appVersion: String,
            platform: String = "android",
        ): PorizoDataGraph {
            val sessionStore = AndroidSessionStore(context)
            val tokenProvider = AccessTokenProvider { sessionStore.currentAccessToken() }
            val apiService = PorizoNetworkClient.apiService(
                baseUrl = baseUrl,
                okHttpClient = PorizoNetworkClient.okHttpClient(appVersion, tokenProvider),
            )
            val authRepository = DefaultAuthRepository(
                service = apiService,
                sessionStore = sessionStore,
                platform = platform,
                appVersion = appVersion,
            )
            val renderRepository = DefaultRenderRepository(
                service = apiService,
                renderPollStore = RenderPollStore(context),
            )
            val shareRepository = DefaultShareRepository(
                service = apiService,
                sessionStore = sessionStore,
                authRepository = authRepository,
                platform = platform,
                appVersion = appVersion,
            )

            return PorizoDataGraph(
                sessionStore = sessionStore,
                apiService = apiService,
                authRepository = authRepository,
                createRepository = DefaultCreateRepository(apiService),
                renderRepository = renderRepository,
                libraryRepository = DefaultLibraryRepository(apiService),
                shareRepository = shareRepository,
                billingRepository = DefaultBillingRepository(apiService),
                pushRepository = DefaultPushRepository(apiService, sessionStore, platform, appVersion),
                voiceEnrollmentRepository = DefaultVoiceEnrollmentRepository(apiService),
            )
        }
    }
}
