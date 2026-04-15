import XCTest
@testable import PorizoApp

final class OnboardingCompletionGateTests: XCTestCase {
    func testFreshInstallWithoutVersionOrLegacyCompletionIsIncomplete() {
        XCTAssertFalse(
            OnboardingCompletionGate.isCompleted(
                completionVersion: 0,
                legacyCompleted: false,
                isAuthenticated: false,
                hasPendingSuggestion: false,
                hasPendingRecipient: false,
                hasPendingAutostart: false
            )
        )
    }

    func testLegacyCompletionDoesNotCountOnFreshLoggedOutInstallWithoutContext() {
        XCTAssertFalse(
            OnboardingCompletionGate.isCompleted(
                completionVersion: 0,
                legacyCompleted: true,
                isAuthenticated: false,
                hasPendingSuggestion: false,
                hasPendingRecipient: false,
                hasPendingAutostart: false
            )
        )
    }

    func testLegacyCompletionMigratesForAuthenticatedReturningUser() {
        XCTAssertTrue(
            OnboardingCompletionGate.shouldMigrateLegacyCompletion(
                legacyCompleted: true,
                isAuthenticated: true,
                hasPendingSuggestion: false,
                hasPendingRecipient: false,
                hasPendingAutostart: false
            )
        )
    }

    func testLegacyCompletionMigratesWhenPendingCreateContextExists() {
        XCTAssertTrue(
            OnboardingCompletionGate.shouldMigrateLegacyCompletion(
                legacyCompleted: true,
                isAuthenticated: false,
                hasPendingSuggestion: true,
                hasPendingRecipient: false,
                hasPendingAutostart: false
            )
        )
    }

    func testVersionedCompletionAlwaysWins() {
        XCTAssertTrue(
            OnboardingCompletionGate.isCompleted(
                completionVersion: OnboardingCompletionGate.currentVersion,
                legacyCompleted: false,
                isAuthenticated: false,
                hasPendingSuggestion: false,
                hasPendingRecipient: false,
                hasPendingAutostart: false
            )
        )
    }
}
