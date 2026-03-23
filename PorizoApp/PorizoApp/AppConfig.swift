//
//  AppConfig.swift
//  PorizoApp
//
//  Centralized configuration for API endpoints.
//

import Foundation

enum AppConfig {
    private static func parseBooleanString(_ value: String) -> Bool? {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes", "on":
            return true
        case "0", "false", "no", "off":
            return false
        default:
            return nil
        }
    }

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

    private static func configBool(envKey: String, infoKey: String? = nil, defaultValue: Bool) -> Bool {
        if let envRaw = ProcessInfo.processInfo.environment[envKey],
           let envValue = parseBooleanString(envRaw) {
            return envValue
        }

        let resolvedInfoKey = infoKey ?? envKey
        if let infoValue = Bundle.main.object(forInfoDictionaryKey: resolvedInfoKey) as? Bool {
            return infoValue
        }
        if let infoString = Bundle.main.object(forInfoDictionaryKey: resolvedInfoKey) as? String,
           let parsedInfo = parseBooleanString(infoString) {
            return parsedInfo
        }

        return defaultValue
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
    static let enableStreamDiagnostics = configBool(
        envKey: "PORIZO_STREAM_CHECK",
        infoKey: "PORIZO_ENABLE_STREAM_DIAGNOSTICS",
        defaultValue: false
    )

    /// Release safety switch: hide subscription/paywall entry points if App Store IAPs are not yet review-ready.
    static let enableSubscriptionsUI = configBool(
        envKey: "PORIZO_ENABLE_SUBSCRIPTIONS_UI",
        defaultValue: true
    )

    /// Release safety switch: hide gift token purchase surfaces until consumable IAP is submitted and approved.
    static let enableGiftPurchaseUI = configBool(
        envKey: "PORIZO_ENABLE_GIFT_PURCHASE_UI",
        defaultValue: true
    )

    /// Feature flag: use the unified single-thread creation flow instead of the multi-screen flow.
    static let useUnifiedCreateFlow = configBool(
        envKey: "PORIZO_UNIFIED_CREATE_FLOW",
        defaultValue: true
    )

    /// Server-defined gift bundle tiers, populated from /app/config response.
    @MainActor static var giftBundles: [GiftBundleConfig] = []

    static let googleClientId = configString("PORIZO_GOOGLE_CLIENT_ID")
    static let googleRedirectUri = configString("PORIZO_GOOGLE_REDIRECT_URI")
    static let facebookAppId = configString("PORIZO_FACEBOOK_APP_ID")
    static let facebookRedirectUri = configString("PORIZO_FACEBOOK_REDIRECT_URI")
    static let tikTokClientKey = configString("PORIZO_TIKTOK_CLIENT_KEY")
    static let tikTokRedirectUri = configString("PORIZO_TIKTOK_REDIRECT_URI")
        ?? "https://porizo.co/tiktok/share-callback"

    static var tikTokCallbackScheme: String? {
        guard let key = tikTokClientKey else { return nil }
        return "tt\(key)"
    }

    /// OneSignal App ID for marketing/engagement push notifications.
    /// Public identifier (not a secret) — standard to embed in client per OneSignal docs.
    static let oneSignalAppId: String? = "67365cfb-f88a-44cc-ba25-29a9a01d01f0"

    /// App Store URL for sharing.
    static let appStoreURL = "https://apps.apple.com/app/porizo/id6758205028"

    /// Public legal pages for App Store compliance links.
    static let termsURL = URL(string: "https://porizo.co/legal/terms")!
    static let privacyURL = URL(string: "https://porizo.co/legal/privacy")!

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
