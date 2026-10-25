struct RootAppConfigState: Equatable, Sendable {
    var onboardingSampleURL: String?
    var onboardingSplashRecipient: String?
    var onboardingSplashLyricsPreview: String?
    var launchFlashSampleURL: String?
    var launchFlashTitle: String?
    var launchFlashRecipient: String?
    var launchFlashLyricsPreview: String?
    var onboardingGraphVersion: Int?
    var onboardingGraphUrl: String?

    init(response: AppConfigResponse? = nil) {
        onboardingSampleURL = response?.onboarding?.sampleAudioUrl
        onboardingSplashRecipient = response?.onboarding?.splashDemoRecipient
        onboardingSplashLyricsPreview = response?.onboarding?.splashLyricsPreview
        launchFlashSampleURL = response?.onboarding?.launchFlashAudioUrl
        launchFlashTitle = response?.onboarding?.launchFlashTitle
        launchFlashRecipient = response?.onboarding?.launchFlashRecipient
        launchFlashLyricsPreview = response?.onboarding?.launchFlashLyricsPreview
        onboardingGraphVersion = response?.onboarding?.questionGraphVersion
        onboardingGraphUrl = response?.onboarding?.questionGraphUrl
    }

    var onboardingConfig: OnboardingConfig {
        OnboardingConfig(
            sampleAudioUrl: onboardingSampleURL,
            sampleLabel: nil,
            splashDemoRecipient: onboardingSplashRecipient,
            splashLyricsPreview: onboardingSplashLyricsPreview,
            launchFlashAudioUrl: launchFlashSampleURL,
            launchFlashTitle: launchFlashTitle,
            launchFlashRecipient: launchFlashRecipient,
            launchFlashLyricsPreview: launchFlashLyricsPreview,
            questionGraphVersion: onboardingGraphVersion,
            questionGraphUrl: onboardingGraphUrl
        )
    }
}
