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

final class RootAppConfigStateTests: XCTestCase {

    func testBuildsFirstLaunchOnboardingStateFromResolvedConfig() {
        let response = AppConfigResponse(
            stt: STTConfig(
                primaryProvider: "apple",
                fallbackProvider: "openai",
                whisperkitModel: "small",
                providerStatus: [:]
            ),
            flags: nil,
            giftBundles: nil,
            appUpdate: nil,
            onboarding: OnboardingConfig(
                sampleAudioUrl: "https://api.porizo.co/audio/cafeteria-light-trimmed.mp3",
                sampleLabel: "Cafeteria Light",
                splashDemoRecipient: "Cafeteria Light (Drive Home Ad)",
                splashLyricsPreview: "You kept one hand on the wheel and one eye on me...",
                launchFlashAudioUrl: "https://api.porizo.co/audio/launch-flash.mp3",
                launchFlashTitle: "The Drive Home",
                launchFlashRecipient: "For Dad",
                launchFlashLyricsPreview: "You kept one hand on the wheel...",
                questionGraphVersion: 2,
                questionGraphUrl: "https://api.porizo.co/api/onboarding/graph.json"
            ),
            analytics: nil
        )

        let state = RootAppConfigState(response: response)

        XCTAssertEqual(state.onboardingSampleURL, "https://api.porizo.co/audio/cafeteria-light-trimmed.mp3")
        XCTAssertEqual(state.onboardingSplashRecipient, "Cafeteria Light (Drive Home Ad)")
        XCTAssertEqual(state.onboardingGraphVersion, 2)
        XCTAssertEqual(state.onboardingGraphUrl, "https://api.porizo.co/api/onboarding/graph.json")
    }

    func testProducesResolverReadyOnboardingConfigWithoutRewritingURLs() {
        let state = RootAppConfigState(response: AppConfigResponse(
            stt: STTConfig(
                primaryProvider: "apple",
                fallbackProvider: "openai",
                whisperkitModel: "small",
                providerStatus: [:]
            ),
            flags: nil,
            giftBundles: nil,
            appUpdate: nil,
            onboarding: OnboardingConfig(
                sampleAudioUrl: "https://api.porizo.co/audio/sample.mp3",
                sampleLabel: "Sample",
                splashDemoRecipient: "For Sarah",
                splashLyricsPreview: "Preview lyric",
                launchFlashAudioUrl: "https://api.porizo.co/audio/launch.mp3",
                launchFlashTitle: "The Drive Home",
                launchFlashRecipient: "For Dad",
                launchFlashLyricsPreview: "Launch lyric",
                questionGraphVersion: 2,
                questionGraphUrl: "https://api.porizo.co/api/onboarding/graph.json"
            ),
            analytics: nil
        ))

        let onboardingConfig = state.onboardingConfig

        XCTAssertEqual(onboardingConfig.sampleAudioUrl, "https://api.porizo.co/audio/sample.mp3")
        XCTAssertEqual(onboardingConfig.launchFlashAudioUrl, "https://api.porizo.co/audio/launch.mp3")
        XCTAssertEqual(onboardingConfig.questionGraphUrl, "https://api.porizo.co/api/onboarding/graph.json")
    }
}
