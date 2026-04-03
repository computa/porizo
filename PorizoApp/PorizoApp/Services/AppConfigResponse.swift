import Foundation

struct OnboardingConfig: Codable, Sendable {
    let sampleAudioUrl: String?
    let sampleLabel: String?

    enum CodingKeys: String, CodingKey {
        case sampleAudioUrl = "sample_audio_url"
        case sampleLabel = "sample_label"
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
