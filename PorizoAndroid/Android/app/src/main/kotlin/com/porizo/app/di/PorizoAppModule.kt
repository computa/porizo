package com.porizo.app.di

import android.content.Context
import com.porizo.app.BuildConfig
import com.porizo.core.data.PorizoDataGraph
import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.DeviceTrustGateway
import com.porizo.core.domain.platform.PlayBillingGateway
import com.porizo.core.domain.platform.PushGateway
import com.porizo.core.domain.platform.PushRouteStore
import com.porizo.core.domain.platform.VoiceRecorder
import com.porizo.core.domain.player.PlayerController
import com.porizo.core.domain.repository.AuthRepository
import com.porizo.core.domain.repository.BillingRepository
import com.porizo.core.domain.repository.CreateRepository
import com.porizo.core.domain.repository.LibraryRepository
import com.porizo.core.domain.repository.PushRepository
import com.porizo.core.domain.repository.RenderRepository
import com.porizo.core.domain.repository.ShareRepository
import com.porizo.core.domain.repository.VoiceEnrollmentRepository
import com.porizo.core.domain.share.ShareDispatcher
import com.porizo.core.media.Media3AudioPlaybackEngine
import com.porizo.core.media.PorizoPlayer
import com.porizo.core.platform.GoogleSignInProvider
import com.porizo.core.platform.DeviceTrustProvider
import com.porizo.core.platform.PlayBillingProvider
import com.porizo.core.platform.PushProvider
import com.porizo.core.platform.PushTapStore
import com.porizo.core.platform.RecorderProvider
import com.porizo.core.share.AndroidShareDispatcher
import com.porizo.feature.auth.GoogleAuthConfig
import com.porizo.feature.settings.SettingsPlatformConfig
import dagger.Binds
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
    fun provideSettingsPlatformConfig(): SettingsPlatformConfig =
        SettingsPlatformConfig(
            oneSignalAppId = BuildConfig.PORIZO_ONESIGNAL_APP_ID,
            subscriptionProductIds = BuildConfig.PORIZO_SUBSCRIPTION_PRODUCT_IDS.csvValues(),
            oneTimeProductIds = BuildConfig.PORIZO_ONE_TIME_PRODUCT_IDS.csvValues(),
            voiceEnrollmentEnabled = BuildConfig.PORIZO_ENABLE_VOICE_ENROLLMENT,
        )

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
    fun providePlayerController(
        @ApplicationContext context: Context,
        dataGraph: PorizoDataGraph,
    ): PlayerController =
        PorizoPlayer(
            engine = Media3AudioPlaybackEngine(context),
            baseUrl = BuildConfig.PORIZO_API_BASE_URL,
            accessTokenProvider = { dataGraph.currentAccessToken() },
        )

    @Provides
    @Singleton
    fun provideShareDispatcher(@ApplicationContext context: Context): ShareDispatcher =
        AndroidShareDispatcher(context)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class PorizoPlatformBindingsModule {
    @Binds
    @Singleton
    abstract fun bindGoogleSignInGateway(provider: GoogleSignInProvider): GoogleSignInGateway

    @Binds
    @Singleton
    abstract fun bindPlayBillingGateway(provider: PlayBillingProvider): PlayBillingGateway

    @Binds
    @Singleton
    abstract fun bindPushGateway(provider: PushProvider): PushGateway

    @Binds
    @Singleton
    abstract fun bindPushRouteStore(store: PushTapStore): PushRouteStore

    @Binds
    @Singleton
    abstract fun bindDeviceTrustGateway(provider: DeviceTrustProvider): DeviceTrustGateway

    @Binds
    @Singleton
    abstract fun bindVoiceRecorder(provider: RecorderProvider): VoiceRecorder
}

private fun String.csvValues(): List<String> =
    split(",")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
