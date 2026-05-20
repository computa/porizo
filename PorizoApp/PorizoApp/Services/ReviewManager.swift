//
//  ReviewManager.swift
//  PorizoApp
//
//  Smart app review prompting - triggers at emotional high points.
//  Apple allows max 3 prompts per 365-day period per device.
//
//  Flow:
//    1. Trigger fires (successful play / share)
//    2. ReviewManager posts .reviewShouldShowPrePrompt (filtered by Apple cap,
//       min-days-between-prompts, and pre-prompt-decline suppression window)
//    3. RootView shows ReviewPrePromptSheet ("Are you enjoying Porizo?")
//    4. "Yes" → userSaidEnjoyingApp() → SKStoreReviewController.requestReview
//       "Not really" → userSaidNotEnjoyingApp() → suppression window starts
//

import StoreKit
import UIKit

extension Notification.Name {
    /// Posted by ReviewManager when an in-app pre-prompt sheet should be shown.
    /// Listeners present the survey; ReviewManager itself does not own UI.
    static let reviewShouldShowPrePrompt = Notification.Name("reviewShouldShowPrePrompt")
}

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
        static let prePromptDeclinedDate = "review_pre_prompt_declined_date"
    }

    // Configuration
    private let playsBeforeFirstPrompt = 2      // Prompt after 2nd successful play
    private let playsBetweenPrompts = 5         // Then every 5 plays
    private let sharesBeforeFirstPrompt = 1     // Sharing is the clearest positive-intent signal
    private let sharesBetweenPrompts = 3
    private let minDaysBetweenPrompts = 30      // At least 30 days between prompts
    private let maxPromptsPerYear = 3           // Apple's limit
    private let prePromptSuppressionDays = 90   // If user said "not really", don't re-ask for this long

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
            triggerPrePromptIfAllowed(trigger: "first_successful_share")
            return
        }

        if count > sharesBeforeFirstPrompt {
            let sharesSinceThreshold = count - sharesBeforeFirstPrompt
            if sharesSinceThreshold % sharesBetweenPrompts == 0 {
                triggerPrePromptIfAllowed(trigger: "successful_share")
            }
        }
    }

    // MARK: - Pre-Prompt Survey Responses

    /// Called by ReviewPrePromptSheet when the user taps "Yes, love it!".
    /// Bypasses the pre-prompt path and goes straight to the native review request.
    func userSaidEnjoyingApp() {
        print("[ReviewManager] User said enjoying → request native review")
        requestReview(trigger: "pre_prompt_yes")
    }

    /// Called by ReviewPrePromptSheet when the user taps "Not really".
    /// Records the decline so we don't re-prompt for `prePromptSuppressionDays` days.
    func userSaidNotEnjoyingApp() {
        print("[ReviewManager] User said not enjoying → suppress for \(prePromptSuppressionDays) days")
        defaults.set(Date.now, forKey: Keys.prePromptDeclinedDate)
    }

    // MARK: - Prompt Logic

    private func checkAndPromptIfAppropriate(trigger: String, playCount: Int) {
        // First prompt after N plays
        if playCount == playsBeforeFirstPrompt {
            triggerPrePromptIfAllowed(trigger: trigger)
            return
        }

        // Subsequent prompts every M plays after the first threshold
        if playCount > playsBeforeFirstPrompt {
            let playsSinceThreshold = playCount - playsBeforeFirstPrompt
            if playsSinceThreshold % playsBetweenPrompts == 0 {
                triggerPrePromptIfAllowed(trigger: trigger)
            }
        }
    }

    /// Decides whether to ask "Are you enjoying Porizo?". Filters out users who
    /// recently declined, users we've already prompted up to Apple's cap, and
    /// anyone we prompted in the last `minDaysBetweenPrompts` days. Posts a
    /// notification so the UI layer can present the survey sheet.
    private func triggerPrePromptIfAllowed(trigger: String) {
        // Honor Apple's yearly limit on the *native* prompt — we won't burn it
        // by showing the pre-prompt either, since "yes" leads straight to it.
        resetYearlyCountIfNeeded()
        let promptCount = defaults.integer(forKey: Keys.promptCount)
        guard promptCount < maxPromptsPerYear else {
            print("[ReviewManager] Skipping pre-prompt - hit yearly limit (\(maxPromptsPerYear))")
            return
        }

        // Respect minimum days between native prompts (pre-prompt is a precursor)
        if let lastPrompt = defaults.object(forKey: Keys.lastPromptDate) as? Date {
            let daysSinceLastPrompt = Calendar.current.dateComponents([.day], from: lastPrompt, to: Date.now).day ?? 0
            guard daysSinceLastPrompt >= minDaysBetweenPrompts else {
                print("[ReviewManager] Skipping pre-prompt - only \(daysSinceLastPrompt) days since last native prompt")
                return
            }
        }

        // If user previously said "not really", give them quiet time
        if let declined = defaults.object(forKey: Keys.prePromptDeclinedDate) as? Date {
            let daysSinceDecline = Calendar.current.dateComponents([.day], from: declined, to: Date.now).day ?? 0
            guard daysSinceDecline >= prePromptSuppressionDays else {
                print("[ReviewManager] Skipping pre-prompt - declined \(daysSinceDecline) days ago, suppression window \(prePromptSuppressionDays)d")
                return
            }
        }

        print("[ReviewManager] Posting pre-prompt notification (trigger: \(trigger))")
        NotificationCenter.default.post(
            name: .reviewShouldShowPrePrompt,
            object: nil,
            userInfo: ["trigger": trigger]
        )
    }

    private func requestReview(trigger: String) {
        print("[ReviewManager] Requesting native review (trigger: \(trigger))")

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
        defaults.removeObject(forKey: Keys.prePromptDeclinedDate)
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
