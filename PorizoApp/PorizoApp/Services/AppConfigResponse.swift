import Foundation

struct OnboardingConfig: Codable, Sendable {
    let sampleAudioUrl: String?
    let sampleLabel: String?
    let splashDemoRecipient: String?
    let splashLyricsPreview: String?
    let questionGraphVersion: Int?
    let questionGraphUrl: String?

    enum CodingKeys: String, CodingKey {
        case sampleAudioUrl = "sample_audio_url"
        case sampleLabel = "sample_label"
        case splashDemoRecipient = "splash_demo_recipient"
        case splashLyricsPreview = "splash_lyrics_preview"
        case questionGraphVersion = "question_graph_version"
        case questionGraphUrl = "question_graph_url"
    }
}

struct AppConfigResponse: Codable, Sendable {
    let stt: STTConfig
    let flags: ClientFlags?
    let giftBundles: [GiftBundleConfig]?
    let appUpdate: AppUpdateConfig?
    let onboarding: OnboardingConfig?

    enum CodingKeys: String, CodingKey {
        case stt
        case flags
        case giftBundles = "gift_bundles"
        case appUpdate = "app_update"
        case onboarding
    }
}
