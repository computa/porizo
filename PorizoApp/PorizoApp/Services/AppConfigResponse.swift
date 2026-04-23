import Foundation

struct OnboardingConfig: Codable, Sendable {
    let sampleAudioUrl: String?
    let sampleLabel: String?
    let splashDemoRecipient: String?
    let splashLyricsPreview: String?
    let launchFlashAudioUrl: String?
    let launchFlashTitle: String?
    let launchFlashRecipient: String?
    let launchFlashLyricsPreview: String?
    let questionGraphVersion: Int?
    let questionGraphUrl: String?

    enum CodingKeys: String, CodingKey {
        case sampleAudioUrl = "sample_audio_url"
        case sampleLabel = "sample_label"
        case splashDemoRecipient = "splash_demo_recipient"
        case splashLyricsPreview = "splash_lyrics_preview"
        case launchFlashAudioUrl = "launch_flash_audio_url"
        case launchFlashTitle = "launch_flash_title"
        case launchFlashRecipient = "launch_flash_recipient"
        case launchFlashLyricsPreview = "launch_flash_lyrics_preview"
        case questionGraphVersion = "question_graph_version"
        case questionGraphUrl = "question_graph_url"
    }
}

struct AnalyticsConfig: Codable, Sendable {
    let amplitudeApiKey: String?

    enum CodingKeys: String, CodingKey {
        case amplitudeApiKey = "amplitude_api_key"
    }
}

struct AppConfigResponse: Codable, Sendable {
    let stt: STTConfig
    let flags: ClientFlags?
    let giftBundles: [GiftBundleConfig]?
    let appUpdate: AppUpdateConfig?
    let onboarding: OnboardingConfig?
    let analytics: AnalyticsConfig?

    enum CodingKeys: String, CodingKey {
        case stt
        case flags
        case giftBundles = "gift_bundles"
        case appUpdate = "app_update"
        case onboarding
        case analytics
    }
}

extension OnboardingConfig {
    func resolvingRelativeURLs(against configURL: URL) -> OnboardingConfig {
        OnboardingConfig(
            sampleAudioUrl: Self.resolve(urlString: sampleAudioUrl, against: configURL),
            sampleLabel: sampleLabel,
            splashDemoRecipient: splashDemoRecipient,
            splashLyricsPreview: splashLyricsPreview,
            launchFlashAudioUrl: Self.resolve(urlString: launchFlashAudioUrl, against: configURL),
            launchFlashTitle: launchFlashTitle,
            launchFlashRecipient: launchFlashRecipient,
            launchFlashLyricsPreview: launchFlashLyricsPreview,
            questionGraphVersion: questionGraphVersion,
            questionGraphUrl: Self.resolve(urlString: questionGraphUrl, against: configURL)
        )
    }

    private static func resolve(urlString: String?, against configURL: URL) -> String? {
        guard let urlString, !urlString.isEmpty else { return nil }
        guard URL(string: urlString)?.scheme == nil else { return urlString }

        let rootURL = URL(string: "/", relativeTo: configURL) ?? configURL.deletingLastPathComponent()
        return URL(string: urlString, relativeTo: rootURL)?.absoluteURL.absoluteString
    }
}

extension AppConfigResponse {
    func resolvingRelativeURLs(against configURL: URL) -> AppConfigResponse {
        AppConfigResponse(
            stt: stt,
            flags: flags,
            giftBundles: giftBundles,
            appUpdate: appUpdate,
            onboarding: onboarding?.resolvingRelativeURLs(against: configURL),
            analytics: analytics
        )
    }
}
