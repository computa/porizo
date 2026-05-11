//
//  AnalyticsService.swift
//  PorizoApp
//
//  Unified analytics wrapper for Firebase Analytics + Amplitude + Porizo backend.
//  Logs funnel events to all active sinks through a single call site.
//

import Foundation
import FirebaseAnalytics
import AmplitudeSwift
#if canImport(AppsFlyerLib)
import AppsFlyerLib
#endif

// MARK: - Funnel Events

enum AnalyticsEvent: String {
    case onboardingViewed = "onboarding_viewed"
    case authCompleted = "auth_completed"
    case sessionResumed = "session_resumed"
    case createStarted = "create_started"
    case createCompleted = "create_completed"
    case firstSongCompleted = "first_song_completed"
    case shareInitiated = "share_initiated"
    case shareCompleted = "share_completed"

    // MARK: - Onboarding V2
    case onboardingV2Started = "onboarding_v2_started"
    case onboardingV2SplashAudioPlayed = "onboarding_v2_splash_audio_played"
    case onboardingV2MirrorViewed = "onboarding_v2_mirror_viewed"
    case onboardingV2PainPointsSelected = "onboarding_v2_pain_points_selected"
    case onboardingV2GoalSelected = "onboarding_v2_goal_selected"
    case onboardingV2PersonSelected = "onboarding_v2_person_selected"
    case onboardingV2NameEntered = "onboarding_v2_name_entered"
    case onboardingV2SeedSelected = "onboarding_v2_seed_selected"
    case onboardingV2SuggestionShown = "onboarding_v2_suggestion_shown"
    case onboardingV2SuggestionUpgraded = "onboarding_v2_suggestion_upgraded"
    case onboardingV2CreateTapped = "onboarding_v2_create_tapped"

    // MARK: - Launch Flash (TikTok-style auto-play on every cold launch)
    case launchFlashShown = "launch_flash_shown"
    case launchFlashAudioStarted = "launch_flash_audio_started"
    case launchFlashDismissed = "launch_flash_dismissed"
    case launchFlashDisabled = "launch_flash_disabled"
    case launchFlashFailed = "launch_flash_failed"
    case onboardingV2Skipped = "onboarding_v2_skipped"
    case onboardingV2Completed = "onboarding_v2_completed"
}

// MARK: - AnalyticsService

typealias AnalyticsTokenProvider = @Sendable () async -> String?

final class AnalyticsService: @unchecked Sendable {

    static let shared = AnalyticsService()

    // Amplitude is configured lazily once the Amplitude API key arrives from
    // the backend /app/config response. It's a client key (embedded in
    // requests), served via remote config so it can be rotated or disabled
    // without shipping a new App Store build. Nil = disabled.
    // All writes go through `configLock`.
    private let configLock = NSLock()
    private var amplitude: Amplitude?
    private var apiBaseURL: String?
    private var tokenProvider: AnalyticsTokenProvider?
    private var urlSession: URLSession = .shared

    private init() {}

    // MARK: - Configuration

    /// Configure the backend forward sink. Called once from `PorizoAppApp` during
    /// app setup, after `AuthManager` and `APIClient` exist. When not configured,
    /// `log(...)` still fires Firebase + Amplitude — only the backend POST is skipped.
    func configure(
        apiBaseURL: String,
        tokenProvider: @escaping AnalyticsTokenProvider,
        urlSession: URLSession = .shared
    ) {
        configLock.lock()
        defer { configLock.unlock() }
        self.apiBaseURL = apiBaseURL
        self.tokenProvider = tokenProvider
        self.urlSession = urlSession
    }

    /// Called after `/app/config` returns, passing the Amplitude key (or nil).
    /// Initializes Amplitude on first valid key; subsequent calls with the same
    /// key are no-ops. A nil or empty key disables Amplitude.
    func configureAmplitude(apiKey: String?) {
        configLock.lock()
        defer { configLock.unlock() }
        guard let key = apiKey?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else {
            if amplitude != nil {
                #if DEBUG
                print("[Analytics] Amplitude key cleared — future events will not be sent to Amplitude")
                #endif
            }
            amplitude = nil
            return
        }
        if amplitude != nil { return }  // idempotent — already configured
        amplitude = Amplitude(configuration: .init(apiKey: key))
        #if DEBUG
        print("[Analytics] Amplitude configured from remote config")
        #endif
    }

    private func currentAmplitude() -> Amplitude? {
        configLock.lock()
        defer { configLock.unlock() }
        return amplitude
    }

    private func currentConfig() -> (baseURL: String, tokenProvider: AnalyticsTokenProvider, session: URLSession)? {
        configLock.lock()
        defer { configLock.unlock() }
        guard let baseURL = apiBaseURL, let provider = tokenProvider else { return nil }
        return (baseURL, provider, urlSession)
    }

    // MARK: - User Identity

    func identify(userId: String) {
        Analytics.setUserID(userId)
        currentAmplitude()?.setUserId(userId: userId)
        #if canImport(AppsFlyerLib)
        // Joins AppsFlyer events across reinstalls and devices for the same user.
        AppsFlyerLib.shared().customerUserID = userId
        #endif
    }

    func setUserProperty(_ key: String, value: String) {
        Analytics.setUserProperty(value, forName: key)
        let identify = Identify().set(property: key, value: value)
        currentAmplitude()?.identify(identify: identify)
    }

    // MARK: - Event Logging

    func log(_ event: AnalyticsEvent, properties: [String: String]? = nil) {
        // Firebase
        Analytics.logEvent(event.rawValue, parameters: properties)

        // Amplitude (no-op until the placeholder API key is replaced)
        if let amplitude = currentAmplitude() {
            amplitude.track(eventType: event.rawValue, eventProperties: properties)
        }

        // AppsFlyer (no-op until SDK + dev key are configured)
        forwardToAppsFlyer(event: event, properties: properties)

        #if DEBUG
        let propsDesc = properties.map { " \($0)" } ?? ""
        print("[Analytics] \(event.rawValue)\(propsDesc)")
        #endif

        // Backend — fire-and-forget with single retry + idempotent event_id.
        let mapping = Self.resourceMapping(for: event, properties: properties)
        forwardToBackend(
            eventName: event.rawValue,
            properties: properties,
            resourceType: mapping.type,
            resourceId: mapping.id
        )
    }

    func log(_ eventName: String, properties: [String: String]? = nil) {
        Analytics.logEvent(eventName, parameters: properties)

        if let amplitude = currentAmplitude() {
            amplitude.track(eventType: eventName, eventProperties: properties)
        }

        #if DEBUG
        let propsDesc = properties.map { " \($0)" } ?? ""
        print("[Analytics] \(eventName)\(propsDesc)")
        #endif

        forwardToBackend(
            eventName: eventName,
            properties: properties,
            resourceType: nil,
            resourceId: nil
        )
    }

    /// AppsFlyer purchase event (`AFEventPurchase`) with revenue + currency.
    /// Fires alongside the regular `log(...)` pipeline so backend + Firebase +
    /// Amplitude also receive the event under a stable name.
    func logPurchase(amount: Decimal, currency: String, productId: String) {
        let amountString = "\(amount)"
        let props: [String: String] = [
            "amount": amountString,
            "currency": currency,
            "productId": productId,
        ]
        // Firebase / backend / Amplitude — uses the canonical "purchase" event name
        // so admin queries and funnels stay consistent with web purchases.
        log("purchase", properties: props)

        #if canImport(AppsFlyerLib)
        let afValues: [String: Any] = [
            AFEventParamRevenue: NSDecimalNumber(decimal: amount),
            AFEventParamCurrency: currency,
            AFEventParamContentId: productId,
        ]
        AppsFlyerLib.shared().logEvent(AFEventPurchase, withValues: afValues)
        #if DEBUG
        print("[AppsFlyer] AFEventPurchase amount=\(amountString) currency=\(currency) productId=\(productId)")
        #endif
        #endif
    }

    /// Map a typed `AnalyticsEvent` to the AppsFlyer event name + values payload.
    /// Returns nil for events that shouldn't ship to AppsFlyer (most onboarding
    /// micro-events — they belong in Firebase/Amplitude for product analytics,
    /// not in AppsFlyer where they'd flood the campaign optimization signal).
    private func forwardToAppsFlyer(event: AnalyticsEvent, properties: [String: String]?) {
        #if canImport(AppsFlyerLib)
        let mapping = Self.appsFlyerMapping(for: event, properties: properties)
        guard let afEventName = mapping.name else { return }
        let afValues: [String: Any] = mapping.values ?? properties ?? [:]
        AppsFlyerLib.shared().logEvent(afEventName, withValues: afValues)
        #if DEBUG
        print("[AppsFlyer] \(afEventName)")
        #endif
        #endif
    }

    /// AppsFlyer event-name mapping. Conversion events (signup / song created /
    /// shared) ship under AppsFlyer's standard event names where one exists, or
    /// a stable custom name otherwise. Everything else is intentionally ignored
    /// to keep the AppsFlyer dashboard focused on campaign-optimization signal.
    static func appsFlyerMapping(
        for event: AnalyticsEvent,
        properties: [String: String]?
    ) -> (name: String?, values: [String: Any]?) {
        #if canImport(AppsFlyerLib)
        switch event {
        case .authCompleted:
            var values: [String: Any] = [AFEventParamRegistrationMethod: properties?["provider"] ?? "unknown"]
            if let userId = properties?["userId"] {
                values[AFEventParamContentId] = userId
            }
            return (AFEventCompleteRegistration, values)
        case .createCompleted:
            if properties?["type"] == "song", let trackId = properties?["trackId"] {
                return ("song_created", [AFEventParamContentId: trackId])
            }
            return (nil, nil)
        case .firstSongCompleted:
            if let trackId = properties?["trackId"] {
                return ("first_song_completed", [AFEventParamContentId: trackId])
            }
            return ("first_song_completed", nil)
        case .shareCompleted:
            var values: [String: Any] = [:]
            if let trackId = properties?["trackId"] { values[AFEventParamContentId] = trackId }
            if let channel = properties?["channel"] { values[AFEventParamDescription] = channel }
            return ("song_shared", values)
        default:
            return (nil, nil)
        }
        #else
        return (nil, nil)
        #endif
    }

    // MARK: - Backend Forward

    /// Fire-and-forget POST to /analytics/event. Retries once on non-2xx/network
    /// error (not on 401 — token is stale, only AuthManager's refresh path fixes
    /// that). Silent failure after retry; never propagates to the caller.
    private func forwardToBackend(
        eventName: String,
        properties: [String: String]?,
        resourceType: String?,
        resourceId: String?
    ) {
        guard let config = currentConfig() else { return }

        let eventId = "evt_" + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(24)
        var bodyDict: [String: Any] = [
            "event_id": String(eventId),
            "event_name": eventName,
        ]
        if let properties { bodyDict["properties"] = properties }
        if let resourceType { bodyDict["resource_type"] = resourceType }
        if let resourceId { bodyDict["resource_id"] = resourceId }

        guard let bodyData = try? JSONSerialization.data(withJSONObject: bodyDict, options: []),
              let url = URL(string: config.baseURL + "/analytics/event") else { return }

        Task.detached(priority: .utility) {
            // Attempt 1
            if await Self.sendOnce(url: url, body: bodyData, config: config) == .retryableFailure {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                _ = await Self.sendOnce(url: url, body: bodyData, config: config)
            }
        }
    }

    private enum ForwardResult {
        case success
        case terminal       // 401, 4xx that should not retry
        case retryableFailure
    }

    private static func sendOnce(
        url: URL,
        body: Data,
        config: (baseURL: String, tokenProvider: AnalyticsTokenProvider, session: URLSession)
    ) async -> ForwardResult {
        guard let token = await config.tokenProvider(), !token.isEmpty else {
            return .terminal  // no token means pre-auth; nothing we can retry
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = body

        do {
            let (_, response) = try await config.session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .retryableFailure
            }
            switch http.statusCode {
            case 200..<300:
                return .success
            case 401:
                #if DEBUG
                print("[Analytics] Backend forward rejected: 401 (stale token, not retrying)")
                #endif
                return .terminal
            default:
                #if DEBUG
                print("[Analytics] Backend forward failed: \(http.statusCode)")
                #endif
                return .retryableFailure
            }
        } catch {
            #if DEBUG
            print("[Analytics] Backend forward error: \(error.localizedDescription)")
            #endif
            return .retryableFailure
        }
    }

    // MARK: - Resource Mapping

    /// Map a typed event to its `events.resource_type` / `events.resource_id`
    /// columns so admin queries joining events↔tracks work for iOS-origin rows.
    /// Events without a natural resource return (nil, nil).
    static func resourceMapping(
        for event: AnalyticsEvent,
        properties: [String: String]?
    ) -> (type: String?, id: String?) {
        guard let properties else { return (nil, nil) }
        switch event {
        case .firstSongCompleted:
            if let trackId = properties["trackId"] {
                return (type: "track", id: trackId)
            }
            return (nil, nil)
        case .createCompleted:
            switch properties["type"] {
            case "song":
                if let trackId = properties["trackId"] { return (type: "track", id: trackId) }
            case "poem":
                if let poemId = properties["poemId"] { return (type: "poem", id: poemId) }
            default:
                break
            }
            return (nil, nil)
        default:
            return (nil, nil)
        }
    }
}
