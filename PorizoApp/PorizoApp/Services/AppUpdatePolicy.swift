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
    static var currentBundleVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    static var currentBundleBuild: Int? {
        normalizedBuild(Bundle.main.infoDictionary?["CFBundleVersion"] as? String)
    }

    /// True when the local app version has caught up to (or passed) a previously
    /// dismissed recommended-update version — callers should clear the stored
    /// dismissal so a genuinely newer prompt isn't suppressed later.
    static func shouldClearDismissal(_ dismissedVersion: String) -> Bool {
        guard !dismissedVersion.isEmpty else { return false }
        if dismissedVersion.hasPrefix("build:") {
            guard let dismissedBuild = normalizedBuild(String(dismissedVersion.dropFirst("build:".count))),
                  let currentBuild = currentBundleBuild
            else {
                return false
            }
            return currentBuild >= dismissedBuild
        }
        return compare(currentBundleVersion, dismissedVersion) != .orderedAscending
    }

    static func evaluate(config: AppUpdateConfig?) -> AppUpdatePrompt? {
        evaluate(
            config: config,
            currentVersion: currentBundleVersion,
            currentBuild: currentBundleBuild
        )
    }

    static func evaluate(
        config: AppUpdateConfig?,
        currentVersion: String,
        currentBuild: Int?
    ) -> AppUpdatePrompt? {
        guard let config else { return nil }

        guard let appStoreURL = URL(string: config.appStoreURL ?? AppConfig.appStoreURL) else {
            return nil
        }

        // Safety guard: if we couldn't read the local version (returned "0") AND the server
        // hasn't declared either threshold, bail out rather than prompting on a phantom delta.
        if currentVersion == "0"
            && normalizedVersion(config.minimumSupportedVersion) == nil
            && normalizedVersion(config.recommendedVersion) == nil
            && config.minimumSupportedBuild == nil
            && config.recommendedBuild == nil {
            return nil
        }

        let outcome: AppUpdatePrompt? = {
            let minimumVersion = normalizedVersion(config.minimumSupportedVersion)
            let minimumBuild = config.minimumSupportedBuild
            if isBelowThreshold(
                currentVersion: currentVersion,
                currentBuild: currentBuild,
                thresholdVersion: minimumVersion,
                thresholdBuild: minimumBuild
            ) {
                return AppUpdatePrompt(
                    kind: .required,
                    targetVersion: targetIdentifier(version: minimumVersion, build: minimumBuild),
                    appStoreURL: appStoreURL,
                    message: config.message ?? "This version of Porizo is no longer supported. Update to continue."
                )
            }

            let recommendedVersion = normalizedVersion(config.recommendedVersion)
            let recommendedBuild = config.recommendedBuild
            if isBelowThreshold(
                currentVersion: currentVersion,
                currentBuild: currentBuild,
                thresholdVersion: recommendedVersion,
                thresholdBuild: recommendedBuild
            ) {
                return AppUpdatePrompt(
                    kind: .recommended,
                    targetVersion: targetIdentifier(version: recommendedVersion, build: recommendedBuild),
                    appStoreURL: appStoreURL,
                    message: config.message ?? "A newer version of Porizo is available. Update for the best experience."
                )
            }
            return nil
        }()

        #if DEBUG
        let outcomeDescription = outcome.map { String(describing: $0.kind) } ?? "nil"
        print("[AppUpdatePolicy] current=\(currentVersion)(\(currentBuild.map(String.init) ?? "nil")) min=\(config.minimumSupportedVersion ?? "nil")/\(config.minimumSupportedBuild.map(String.init) ?? "nil") recommended=\(config.recommendedVersion ?? "nil")/\(config.recommendedBuild.map(String.init) ?? "nil") → \(outcomeDescription)")
        #endif
        return outcome
    }

    private static func normalizedVersion(_ version: String?) -> String? {
        guard let version else { return nil }
        let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func normalizedBuild(_ build: String?) -> Int? {
        guard let build else { return nil }
        let trimmed = build.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return Int(trimmed)
    }

    private static func isBelowThreshold(
        currentVersion: String,
        currentBuild: Int?,
        thresholdVersion: String?,
        thresholdBuild: Int?
    ) -> Bool {
        if let thresholdVersion,
           compare(currentVersion, thresholdVersion) == .orderedAscending {
            return true
        }

        if let thresholdBuild,
           let currentBuild,
           currentBuild < thresholdBuild {
            return true
        }

        return false
    }

    private static func targetIdentifier(version: String?, build: Int?) -> String {
        if let version {
            return version
        }
        if let build {
            return "build:\(build)"
        }
        return "unknown"
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
