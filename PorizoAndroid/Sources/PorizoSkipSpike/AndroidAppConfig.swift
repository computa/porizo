import Foundation

enum AndroidAppConfig {
    static let applicationId = "com.porizo.app"
    static let androidPackageName = "porizo.skip.spike"
    static let displayName = "Porizo"
    static let platform = "android"
    static let marketingVersion = "0.1.0"
    static let productionAPIBaseURL = "https://api.porizo.co"
    static let apiBaseURLOverrideKey = "porizo_android_api_base_url_override"
    static let shareHost = "porizo.app"
    static let platformDeviceLabel = "android-device"

    static var apiBaseURL: String {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["PORIZO_API_BASE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return override
        }
        if let override = UserDefaults.standard.string(forKey: apiBaseURLOverrideKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return override
        }
        #endif
        return productionAPIBaseURL
    }

    static func saveDebugAPIBaseURLOverride(_ value: String) {
        #if DEBUG
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            UserDefaults.standard.removeObject(forKey: apiBaseURLOverrideKey)
        } else {
            UserDefaults.standard.set(trimmed, forKey: apiBaseURLOverrideKey)
        }
        #endif
    }

    static let appLinkPathPrefixes = [
        "/s/",
        "/play/",
        "/poem/",
        "/receiver-handoff/",
    ]
}
