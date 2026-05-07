//
//  ReviewManager.swift
//  PorizoApp
//
//  Smart app review prompting - triggers at emotional high points.
//  Apple allows max 3 prompts per 365-day period per device.
//

import StoreKit
import UIKit

/// Manages when to prompt users for App Store reviews
@MainActor
final class ReviewManager {
    static let shared = ReviewManager()

    private let defaults = UserDefaults.standard

    // UserDefaults keys
    private enum Keys {
        static let successfulPlaysCount = "review_successful_plays"
        static let successfulSharesCount = "review_successful_shares"
        static let fullRendersCount = "review_full_renders"
        static let lastPromptDate = "review_last_prompt_date"
        static let promptCount = "review_prompt_count"
        static let promptCountResetDate = "review_prompt_reset_date"
    }

    // Configuration
    private let playsBeforeFirstPrompt = 2      // Prompt after 2nd successful play
    private let playsBetweenPrompts = 5         // Then every 5 plays
    private let sharesBeforeFirstPrompt = 1     // Sharing is the clearest positive-intent signal
    private let sharesBetweenPrompts = 3
    private let minDaysBetweenPrompts = 30      // At least 30 days between prompts
    private let maxPromptsPerYear = 3           // Apple's limit

    private init() {}

    // MARK: - Event Tracking

    /// Call when a song finishes playing successfully (reached the end)
    func recordSuccessfulPlay() {
        let count = defaults.integer(forKey: Keys.successfulPlaysCount) + 1
        defaults.set(count, forKey: Keys.successfulPlaysCount)

        checkAndPromptIfAppropriate(trigger: "play_complete", playCount: count)
    }

    /// Call when a full render completes successfully
    func recordFullRenderComplete() {
        let currentCount = defaults.integer(forKey: Keys.fullRendersCount)
        defaults.set(currentCount + 1, forKey: Keys.fullRendersCount)
    }

    /// Call when the system share sheet reports a completed share.
    func recordSuccessfulShare() {
        let count = defaults.integer(forKey: Keys.successfulSharesCount) + 1
        defaults.set(count, forKey: Keys.successfulSharesCount)

        if count == sharesBeforeFirstPrompt {
            requestReviewIfAllowed(trigger: "first_successful_share")
            return
        }

        if count > sharesBeforeFirstPrompt {
            let sharesSinceThreshold = count - sharesBeforeFirstPrompt
            if sharesSinceThreshold % sharesBetweenPrompts == 0 {
                requestReviewIfAllowed(trigger: "successful_share")
            }
        }
    }

    // MARK: - Prompt Logic

    private func checkAndPromptIfAppropriate(trigger: String, playCount: Int) {
        // First prompt after N plays
        if playCount == playsBeforeFirstPrompt {
            requestReviewIfAllowed(trigger: trigger)
            return
        }

        // Subsequent prompts every M plays after the first threshold
        if playCount > playsBeforeFirstPrompt {
            let playsSinceThreshold = playCount - playsBeforeFirstPrompt
            if playsSinceThreshold % playsBetweenPrompts == 0 {
                requestReviewIfAllowed(trigger: trigger)
            }
        }
    }

    private func requestReviewIfAllowed(trigger: String) {
        // Check if we've hit Apple's yearly limit
        resetYearlyCountIfNeeded()
        let promptCount = defaults.integer(forKey: Keys.promptCount)
        guard promptCount < maxPromptsPerYear else {
            print("[ReviewManager] Skipping - hit yearly limit (\(maxPromptsPerYear))")
            return
        }

        // Check minimum days between prompts
        if let lastPrompt = defaults.object(forKey: Keys.lastPromptDate) as? Date {
            let daysSinceLastPrompt = Calendar.current.dateComponents([.day], from: lastPrompt, to: Date.now).day ?? 0
            guard daysSinceLastPrompt >= minDaysBetweenPrompts else {
                print("[ReviewManager] Skipping - only \(daysSinceLastPrompt) days since last prompt")
                return
            }
        }

        // Request the review
        requestReview(trigger: trigger)
    }

    private func requestReview(trigger: String) {
        print("[ReviewManager] Requesting review (trigger: \(trigger))")

        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                print("[ReviewManager] No active window scene")
                return
            }

            SKStoreReviewController.requestReview(in: scene)

            // Record that we prompted
            self.defaults.set(Date.now, forKey: Keys.lastPromptDate)
            let newCount = self.defaults.integer(forKey: Keys.promptCount) + 1
            self.defaults.set(newCount, forKey: Keys.promptCount)
        }
    }

    private func resetYearlyCountIfNeeded() {
        if let resetDate = defaults.object(forKey: Keys.promptCountResetDate) as? Date {
            let daysSinceReset = Calendar.current.dateComponents([.day], from: resetDate, to: Date.now).day ?? 0
            if daysSinceReset >= 365 {
                defaults.set(0, forKey: Keys.promptCount)
                defaults.set(Date.now, forKey: Keys.promptCountResetDate)
            }
        } else {
            // First time - set the reset date
            defaults.set(Date.now, forKey: Keys.promptCountResetDate)
        }
    }

    // MARK: - Debug/Testing

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
