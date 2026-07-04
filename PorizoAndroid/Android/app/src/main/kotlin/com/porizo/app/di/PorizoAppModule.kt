package com.porizo.app.di

import android.content.Context
import com.porizo.app.BuildConfig
import com.porizo.core.data.PorizoDataGraph
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.BillingRepository
import com.porizo.core.domain.repository.CreateRepository
import com.porizo.core.domain.repository.LibraryRepository
import com.porizo.core.domain.repository.PushRepository
import com.porizo.core.domain.repository.RenderRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.repository.VoiceEnrollmentRepository
import com.porizo.core.media.Media3AudioPlaybackEngine
import com.porizo.core.media.PorizoPlayer
import com.porizo.core.share.AndroidShareDispatcher
import com.porizo.feature.auth.GoogleAuthConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PorizoAppModule {
    @Provides
    @Singleton
    fun provideDataGraph(@ApplicationContext context: Context): PorizoDataGraph =
        PorizoDataGraph.create(
            context = context,
            baseUrl = BuildConfig.PORIZO_API_BASE_URL,
            appVersion = BuildConfig.VERSION_NAME,
        )

    @Provides
    fun provideGoogleAuthConfig(): GoogleAuthConfig =
        GoogleAuthConfig(webClientId = BuildConfig.PORIZO_GOOGLE_WEB_CLIENT_ID)

    @Provides
    fun provideAuthRepository(dataGraph: PorizoDataGraph): AuthRepository =
        dataGraph.authRepository

    @Provides
    fun provideCreateRepository(dataGraph: PorizoDataGraph): CreateRepository =
        dataGraph.createRepository

    @Provides
    fun provideRenderRepository(dataGraph: PorizoDataGraph): RenderRepository =
        dataGraph.renderRepository

    @Provides
    fun provideLibraryRepository(dataGraph: PorizoDataGraph): LibraryRepository =
        dataGraph.libraryRepository

    @Provides
    fun provideShareRepository(dataGraph: PorizoDataGraph): ShareRepository =
        dataGraph.shareRepository

    @Provides
    fun provideBillingRepository(dataGraph: PorizoDataGraph): BillingRepository =
        dataGraph.billingRepository

    @Provides
    fun providePushRepository(dataGraph: PorizoDataGraph): PushRepository =
        dataGraph.pushRepository

    @Provides
    fun provideVoiceEnrollmentRepository(dataGraph: PorizoDataGraph): VoiceEnrollmentRepository =
        dataGraph.voiceEnrollmentRepository

    @Provides
    @Singleton
    fun providePorizoPlayer(
        @ApplicationContext context: Context,
        dataGraph: PorizoDataGraph,
    ): PorizoPlayer =
        PorizoPlayer(
            engine = Media3AudioPlaybackEngine(context),
            baseUrl = BuildConfig.PORIZO_API_BASE_URL,
            accessTokenProvider = { dataGraph.currentAccessToken() },
        )

    @Provides
    @Singleton
    fun provideAndroidShareDispatcher(@ApplicationContext context: Context): AndroidShareDispatcher =
        AndroidShareDispatcher(context)
}
