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

    private let amplitude: Amplitude?

    // Injected at app startup via configure(...). Nil means backend forward
    // is disabled (e.g. during tests that don't wire it up, or pre-config).
    private let configLock = NSLock()
    private var apiBaseURL: String?
    private var tokenProvider: AnalyticsTokenProvider?
    private var urlSession: URLSession = .shared

    // MARK: - Placeholder API key (replace before production release)
    private static let amplitudeAPIKey = "AMPLITUDE_API_KEY_PLACEHOLDER"

    private init() {
        if Self.amplitudeAPIKey != "AMPLITUDE_API_KEY_PLACEHOLDER" {
            self.amplitude = Amplitude(configuration: .init(apiKey: Self.amplitudeAPIKey))
        } else {
            // Don't initialize Amplitude with a placeholder key — it would send
            // garbage requests. Firebase Analytics works without an explicit key
            // (configured via GoogleService-Info.plist).
            self.amplitude = nil
            #if DEBUG
            print("[Analytics] Amplitude disabled — using placeholder API key")
            #endif
        }
    }

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

    private func currentConfig() -> (baseURL: String, tokenProvider: AnalyticsTokenProvider, session: URLSession)? {
        configLock.lock()
        defer { configLock.unlock() }
        guard let baseURL = apiBaseURL, let provider = tokenProvider else { return nil }
        return (baseURL, provider, urlSession)
    }

    // MARK: - User Identity

    func identify(userId: String) {
        Analytics.setUserID(userId)
        amplitude?.setUserId(userId: userId)
    }

    func setUserProperty(_ key: String, value: String) {
        Analytics.setUserProperty(value, forName: key)
        let identify = Identify().set(property: key, value: value)
        amplitude?.identify(identify: identify)
    }

    // MARK: - Event Logging

    func log(_ event: AnalyticsEvent, properties: [String: String]? = nil) {
        // Firebase
        Analytics.logEvent(event.rawValue, parameters: properties)

        // Amplitude (no-op until the placeholder API key is replaced)
        if let amplitude {
            amplitude.track(eventType: event.rawValue, eventProperties: properties)
        }

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

        if let amplitude {
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
