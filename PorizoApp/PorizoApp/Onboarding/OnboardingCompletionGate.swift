//
//  OnboardingCompletionGate.swift
//  PorizoApp
//
//  Decides whether onboarding should be treated as completed.
//  Uses a versioned completion marker and only honors the legacy boolean when
//  there is concrete evidence this is a returning user/session.
//

import Foundation

enum OnboardingCompletionGate {
    static let currentVersion = 1

    static func isCompleted(
        completionVersion: Int,
        legacyCompleted: Bool,
        isAuthenticated: Bool,
        hasPendingSuggestion: Bool,
        hasPendingRecipient: Bool,
        hasPendingAutostart: Bool
    ) -> Bool {
        completionVersion >= currentVersion || shouldMigrateLegacyCompletion(
            legacyCompleted: legacyCompleted,
            isAuthenticated: isAuthenticated,
            hasPendingSuggestion: hasPendingSuggestion,
            hasPendingRecipient: hasPendingRecipient,
            hasPendingAutostart: hasPendingAutostart
        )
    }

    static func shouldMigrateLegacyCompletion(
        legacyCompleted: Bool,
        isAuthenticated: Bool,
        hasPendingSuggestion: Bool,
        hasPendingRecipient: Bool,
        hasPendingAutostart: Bool
    ) -> Bool {
        guard legacyCompleted else { return false }
        return isAuthenticated || hasPendingSuggestion || hasPendingRecipient || hasPendingAutostart
    }
}
