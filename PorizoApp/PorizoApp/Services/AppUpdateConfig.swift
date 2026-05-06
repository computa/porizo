import Foundation

struct AppUpdateConfig: Codable, Sendable {
    let minimumSupportedVersion: String?
    let minimumSupportedBuild: Int?
    let recommendedVersion: String?
    let recommendedBuild: Int?
    let message: String?
    let appStoreURL: String?

    enum CodingKeys: String, CodingKey {
        case minimumSupportedVersion = "minimum_supported_version"
        case minimumSupportedBuild = "minimum_supported_build"
        case recommendedVersion = "recommended_version"
        case recommendedBuild = "recommended_build"
        case message
        case appStoreURL = "app_store_url"
    }
}
