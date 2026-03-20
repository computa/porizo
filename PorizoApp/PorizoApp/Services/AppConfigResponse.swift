import Foundation

struct AppConfigResponse: Codable, Sendable {
    let stt: STTConfig
    let flags: ClientFlags?
    let giftBundles: [GiftBundleConfig]?
    let appUpdate: AppUpdateConfig?

    enum CodingKeys: String, CodingKey {
        case stt
        case flags
        case giftBundles = "gift_bundles"
        case appUpdate = "app_update"
    }
}
