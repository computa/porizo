package com.porizo.feature.settings

data class SettingsPlatformConfig(
    val oneSignalAppId: String,
    val subscriptionProductIds: List<String>,
    val oneTimeProductIds: List<String>,
    val voiceEnrollmentEnabled: Boolean,
)
