//
//  ReviewManager.swift
//  PorizoApp
//
//  Policy-aligned App Store review prompting at verified success moments.
//

import StoreKit
import UIKit

extension Notification.Name {
    /// Posted when an APNs push tells us a share recipient finished playing
    /// the song. UserInfo: `trackId`, `trackTitle`, optionally `recipientName`.
    static let recipientPlayedShare = Notification.Name("recipientPlayedShare")
}

struct ReviewPromptPolicy {
    struct State {
        let requestCount: Int
        let lastRequestDate: Date?
    }

    let minimumDaysBetweenRequests: Int
    let maximumRequestsPerYear: Int

    static let production = ReviewPromptPolicy(
        minimumDaysBetweenRequests: 120,
        maximumRequestsPerYear: 3
    )

    func shouldRequestReview(state: State, now: Date) -> Bool {
        guard state.requestCount < maximumRequestsPerYear else { return false }
        guard let lastRequestDate = state.lastRequestDate else { return true }

        let elapsedDays = Calendar.current.dateComponents(
            [.day],
            from: lastRequestDate,
            to: now
        ).day ?? 0
        return elapsedDays >= minimumDaysBetweenRequests
    }
}

@MainActor
final class ReviewManager {
    static let shared = ReviewManager()

    private let defaults = UserDefaults.standard
    private let policy = ReviewPromptPolicy.production

    private enum Keys {
        static let successfulPlaysCount = "review_successful_plays"
        static let successfulSharesCount = "review_successful_shares"
        static let fullRendersCount = "review_full_renders"
        static let lastPromptDate = "review_last_prompt_date"
        static let promptCount = "review_prompt_count"
        static let promptCountResetDate = "review_prompt_reset_date"
    }

    private enum Trigger: String {
        case completedPlayback = "play_complete"
        case completedShare = "share_complete"
        case recipientPlayed = "recipient_played"
    }

    private init() {}

    func recordSuccessfulPlay() {
        increment(Keys.successfulPlaysCount)
        requestReviewIfAllowed(trigger: .completedPlayback)
    }

    func recordFullRenderComplete() {
        increment(Keys.fullRendersCount)
    }

    func recordRecipientPlayed() {
        requestReviewIfAllowed(trigger: .recipientPlayed)
    }

    func recordSuccessfulShare() {
        increment(Keys.successfulSharesCount)
        requestReviewIfAllowed(trigger: .completedShare)
    }

    private func increment(_ key: String) {
        defaults.set(defaults.integer(forKey: key) + 1, forKey: key)
    }

    private func requestReviewIfAllowed(trigger: Trigger) {
        resetYearlyCountIfNeeded()
        let state = ReviewPromptPolicy.State(
            requestCount: defaults.integer(forKey: Keys.promptCount),
            lastRequestDate: defaults.object(forKey: Keys.lastPromptDate) as? Date
        )
        let now = Date.now

        guard policy.shouldRequestReview(state: state, now: now) else {
            print("[ReviewManager] Review request suppressed by cooldown (trigger: \(trigger.rawValue))")
            return
        }

        guard let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
            print("[ReviewManager] No active window scene")
            return
        }

        print("[ReviewManager] Requesting native review (trigger: \(trigger.rawValue))")
        SKStoreReviewController.requestReview(in: scene)
        defaults.set(now, forKey: Keys.lastPromptDate)
        defaults.set(state.requestCount + 1, forKey: Keys.promptCount)
    }

    private func resetYearlyCountIfNeeded() {
        if let resetDate = defaults.object(forKey: Keys.promptCountResetDate) as? Date {
            let elapsedDays = Calendar.current.dateComponents(
                [.day],
                from: resetDate,
                to: Date.now
            ).day ?? 0
            if elapsedDays >= 365 {
                defaults.set(0, forKey: Keys.promptCount)
                defaults.set(Date.now, forKey: Keys.promptCountResetDate)
            }
        } else {
            defaults.set(Date.now, forKey: Keys.promptCountResetDate)
        }
    }

    #if DEBUG
    func resetAllTracking() {
        defaults.removeObject(forKey: Keys.successfulPlaysCount)
        defaults.removeObject(forKey: Keys.successfulSharesCount)
        defaults.removeObject(forKey: Keys.fullRendersCount)
        defaults.removeObject(forKey: Keys.lastPromptDate)
        defaults.removeObject(forKey: Keys.promptCount)
        defaults.removeObject(forKey: Keys.promptCountResetDate)
        print("[ReviewManager] Reset all tracking data")
    }

    var debugStats: String {
        let plays = defaults.integer(forKey: Keys.successfulPlaysCount)
        let shares = defaults.integer(forKey: Keys.successfulSharesCount)
        let renders = defaults.integer(forKey: Keys.fullRendersCount)
        let prompts = defaults.integer(forKey: Keys.promptCount)
        return "Plays: \(plays), Shares: \(shares), Full renders: \(renders), Prompts this year: \(prompts)"
    }
    #endif
}
