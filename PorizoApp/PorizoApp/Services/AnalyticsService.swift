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
    case shareInitiated = "share_initiated"
    case shareCompleted = "share_completed"
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
