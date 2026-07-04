package com.porizo.app.di

import android.content.Context
import com.porizo.app.BuildConfig
import com.porizo.core.data.PorizoDataGraph
import com.porizo.core.domain.repository.AuthRepository
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
    fun provideAuthRepository(dataGraph: PorizoDataGraph): AuthRepository =
        dataGraph.authRepository
}
