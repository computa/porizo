//
//  AnalyticsService.swift
//  PorizoApp
//
//  Unified analytics wrapper for Firebase Analytics + Amplitude.
//  Logs funnel events to both providers through a single call site.
//

import Foundation
import FirebaseAnalytics
import AmplitudeSwift

// MARK: - Funnel Events

enum AnalyticsEvent: String {
    case onboardingViewed = "onboarding_viewed"
    case authCompleted = "auth_completed"
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

final class AnalyticsService: @unchecked Sendable {

    static let shared = AnalyticsService()

    private let amplitude: Amplitude?

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

        // Amplitude
        if let amplitude {
            amplitude.track(eventType: event.rawValue, eventProperties: properties)
        }

        #if DEBUG
        let propsDesc = properties.map { " \($0)" } ?? ""
        print("[Analytics] \(event.rawValue)\(propsDesc)")
        #endif
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
    }
}
