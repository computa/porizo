import Foundation

struct AppUpdateConfig: Codable, Sendable {
    let minimumSupportedVersion: String?
    let recommendedVersion: String?
    let message: String?
    let appStoreURL: String?

    enum CodingKeys: String, CodingKey {
        case minimumSupportedVersion = "minimum_supported_version"
        case recommendedVersion = "recommended_version"
        case message
        case appStoreURL = "app_store_url"
    }
}
