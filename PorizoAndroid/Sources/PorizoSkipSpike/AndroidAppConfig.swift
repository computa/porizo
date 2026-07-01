import Foundation

enum AndroidAppConfig {
    static let applicationId = "com.porizo.app"
    static let androidPackageName = "porizo.skip.spike"
    static let displayName = "Porizo"
    static let platform = "android"
    static let marketingVersion = "0.1.0"
    static let productionAPIBaseURL = "https://api.porizo.co"
    static let shareHost = "porizo.app"
    static let platformDeviceLabel = "android-device"

    static var apiBaseURL: String {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["PORIZO_API_BASE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return override
        }
        #endif
        return productionAPIBaseURL
    }

    static let appLinkPathPrefixes = [
        "/s/",
        "/play/",
        "/poem/",
        "/receiver-handoff/",
    ]
}
