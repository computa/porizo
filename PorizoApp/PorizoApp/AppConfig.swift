//
//  AppConfig.swift
//  PorizoApp
//
//  Centralized configuration for API endpoints.
//

import Foundation

enum AppConfig {
    private static func configString(_ key: String) -> String? {
        let envValue = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !envValue.isEmpty {
            return envValue
        }

        if let infoValue = Bundle.main.object(forInfoDictionaryKey: key) as? String {
            let trimmed = infoValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.hasPrefix("$(") {
                return trimmed
            }
        }

        return nil
    }

    static let apiBaseURL: String = {
        if let value = configString("PORIZO_API_BASE_URL") {
            return value
        }

#if DEBUG
#if targetEnvironment(simulator)
        return "http://localhost:3000"
#else
        return "https://api.porizo.co"
#endif
#else
        return "https://api.porizo.co"
#endif
    }()

    /// Enable stream diagnostics UI for playback troubleshooting.
    /// Can be toggled via environment or Info.plist without a new build.
    static let enableStreamDiagnostics: Bool = {
        let envValue = ProcessInfo.processInfo.environment["PORIZO_STREAM_CHECK"]?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if envValue == "1" || envValue == "true" {
            return true
        }
        if let infoValue = Bundle.main.object(forInfoDictionaryKey: "PORIZO_ENABLE_STREAM_DIAGNOSTICS") as? Bool {
            return infoValue
        }
        if let infoString = Bundle.main.object(forInfoDictionaryKey: "PORIZO_ENABLE_STREAM_DIAGNOSTICS") as? String {
            return infoString.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "true"
        }
        return false
    }()

    static let googleClientId = configString("PORIZO_GOOGLE_CLIENT_ID")
    static let googleRedirectUri = configString("PORIZO_GOOGLE_REDIRECT_URI")
    static let facebookAppId = configString("PORIZO_FACEBOOK_APP_ID")
    static let facebookRedirectUri = configString("PORIZO_FACEBOOK_REDIRECT_URI")

    /// App Store URL for sharing. Update ID when app is published.
    static let appStoreURL = "https://apps.apple.com/app/porizo/id6742382730"

    static var googleOAuthConfig: OAuthProviderConfig? {
        guard let clientId = googleClientId,
              let redirectUri = googleRedirectUri,
              let redirectURL = URL(string: redirectUri),
              let callbackScheme = redirectURL.scheme else {
            return nil
        }

        return OAuthProviderConfig(
            provider: .google,
            clientId: clientId,
            redirectUri: redirectUri,
            callbackScheme: callbackScheme,
            authorizationEndpoint: URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!,
            scopes: ["openid", "email", "profile"]
        )
    }

    static var facebookOAuthConfig: OAuthProviderConfig? {
        guard let appId = facebookAppId,
              let redirectUri = facebookRedirectUri,
              let redirectURL = URL(string: redirectUri),
              let callbackScheme = redirectURL.scheme else {
            return nil
        }

        return OAuthProviderConfig(
            provider: .facebook,
            clientId: appId,
            redirectUri: redirectUri,
            callbackScheme: callbackScheme,
            authorizationEndpoint: URL(string: "https://www.facebook.com/v19.0/dialog/oauth")!,
            scopes: ["email", "public_profile"]
        )
    }
}

struct OAuthProviderConfig {
    enum Provider {
        case google
        case facebook
    }

    let provider: Provider
    let clientId: String
    let redirectUri: String
    let callbackScheme: String
    let authorizationEndpoint: URL
    let scopes: [String]
}
