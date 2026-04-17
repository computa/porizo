import Foundation

struct AppUpdatePrompt: Identifiable, Equatable {
    enum Kind: Equatable {
        case required
        case recommended
    }

    let kind: Kind
    let targetVersion: String
    let appStoreURL: URL
    let message: String

    var id: String {
        "\(kind)-\(targetVersion)"
    }

    var title: String {
        switch kind {
        case .required:
            return "Update Required"
        case .recommended:
            return "Update Available"
        }
    }
}

enum AppUpdatePolicy {
    static func evaluate(config: AppUpdateConfig?) -> AppUpdatePrompt? {
        guard let config else { return nil }

        let currentVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        guard let appStoreURL = URL(string: config.appStoreURL ?? AppConfig.appStoreURL) else {
            return nil
        }

        // Safety guard: if we couldn't read the local version (returned "0") AND the server
        // hasn't declared either threshold, bail out rather than prompting on a phantom delta.
        if currentVersion == "0"
            && normalizedVersion(config.minimumSupportedVersion) == nil
            && normalizedVersion(config.recommendedVersion) == nil {
            return nil
        }

        #if DEBUG
        print("[AppUpdatePolicy] evaluate — current=\(currentVersion) min=\(config.minimumSupportedVersion ?? "nil") recommended=\(config.recommendedVersion ?? "nil")")
        #endif

        if let minimum = normalizedVersion(config.minimumSupportedVersion),
           compare(currentVersion, minimum) == .orderedAscending {
            #if DEBUG
            print("[AppUpdatePolicy] → required (current < minimum)")
            #endif
            return AppUpdatePrompt(
                kind: .required,
                targetVersion: minimum,
                appStoreURL: appStoreURL,
                message: config.message ?? "This version of Porizo is no longer supported. Update to continue."
            )
        }

        if let recommended = normalizedVersion(config.recommendedVersion),
           compare(currentVersion, recommended) == .orderedAscending {
            #if DEBUG
            print("[AppUpdatePolicy] → recommended (current < recommended)")
            #endif
            return AppUpdatePrompt(
                kind: .recommended,
                targetVersion: recommended,
                appStoreURL: appStoreURL,
                message: config.message ?? "A newer version of Porizo is available. Update for the best experience."
            )
        }

        #if DEBUG
        print("[AppUpdatePolicy] → nil (no prompt needed)")
        #endif
        return nil
    }

    private static func normalizedVersion(_ version: String?) -> String? {
        guard let version else { return nil }
        let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let lhsParts = lhs.split(separator: ".").map { Int($0) ?? 0 }
        let rhsParts = rhs.split(separator: ".").map { Int($0) ?? 0 }
        let maxCount = max(lhsParts.count, rhsParts.count)

        for index in 0..<maxCount {
            let lhsValue = index < lhsParts.count ? lhsParts[index] : 0
            let rhsValue = index < rhsParts.count ? rhsParts[index] : 0
            if lhsValue < rhsValue { return .orderedAscending }
            if lhsValue > rhsValue { return .orderedDescending }
        }

        return .orderedSame
    }
}
