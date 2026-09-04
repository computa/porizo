package com.porizo.app

import android.app.Application
import com.porizo.core.domain.platform.PushGateway
import com.porizo.feature.settings.SettingsPlatformConfig
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class PorizoApplication : Application() {
    @Inject lateinit var pushGateway: PushGateway
    @Inject lateinit var settingsPlatformConfig: SettingsPlatformConfig

    override fun onCreate() {
        super.onCreate()
        pushGateway.initialize(settingsPlatformConfig.oneSignalAppId, verbose = false)
    }
}
