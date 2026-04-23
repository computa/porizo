import XCTest
@testable import PorizoApp

// MARK: - STT Config Tests

final class STTConfigTests: XCTestCase {

    func testSTTConfigDecoding() throws {
        let json = """
        {
            "primary_provider": "whisperkit",
            "fallback_provider": "openai",
            "whisperkit_model": "small",
            "provider_status": {
                "stt_apple": "active",
                "stt_whisperkit": "active",
                "stt_openai": "active"
            }
        }
        """.data(using: .utf8)!

        let config = try JSONDecoder().decode(STTConfig.self, from: json)

        XCTAssertEqual(config.primaryProvider, "whisperkit")
        XCTAssertEqual(config.fallbackProvider, "openai")
        XCTAssertEqual(config.whisperkitModel, "small")
        XCTAssertEqual(config.providerStatus.count, 3)
    }

    func testSTTConfigDecodingWithMinimalFields() throws {
        let json = """
        {
            "primary_provider": "apple",
            "fallback_provider": "openai",
            "whisperkit_model": "tiny",
            "provider_status": {}
        }
        """.data(using: .utf8)!

        let config = try JSONDecoder().decode(STTConfig.self, from: json)

        XCTAssertEqual(config.primaryProvider, "apple")
        XCTAssertEqual(config.fallbackProvider, "openai")
        XCTAssertEqual(config.whisperkitModel, "tiny")
        XCTAssertTrue(config.providerStatus.isEmpty)
    }

    func testIsProviderEnabledWithActiveStatus() {
        let config = STTConfig(
            primaryProvider: "whisperkit",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: ["stt_apple": "active", "stt_whisperkit": "active", "stt_openai": "active"]
        )

        XCTAssertTrue(config.isProviderEnabled("apple"))
        XCTAssertTrue(config.isProviderEnabled("whisperkit"))
        XCTAssertTrue(config.isProviderEnabled("openai"))
    }

    func testIsProviderEnabledWithDisabledStatus() {
        let config = STTConfig(
            primaryProvider: "whisperkit",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: ["stt_apple": "disabled", "stt_whisperkit": "active", "stt_openai": "active"]
        )

        XCTAssertFalse(config.isProviderEnabled("apple"))
        XCTAssertTrue(config.isProviderEnabled("whisperkit"))
    }

    func testIsProviderEnabledDefaultsToActiveWhenMissing() {
        let config = STTConfig(
            primaryProvider: "whisperkit",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: [:]  // Empty - no status defined
        )

        // Should default to active when not in the map
        XCTAssertTrue(config.isProviderEnabled("apple"))
        XCTAssertTrue(config.isProviderEnabled("whisperkit"))
        XCTAssertTrue(config.isProviderEnabled("openai"))
    }

    func testDefaultConfig() {
        let config = STTConfig.default

        XCTAssertEqual(config.primaryProvider, "whisperkit")
        XCTAssertEqual(config.fallbackProvider, "openai")
        XCTAssertEqual(config.whisperkitModel, "small")
    }
}

// MARK: - STT Result Tests

final class STTResultTests: XCTestCase {

    func testSTTResultCreation() {
        let result = STTResult(
            text: "Hello world",
            language: "en",
            confidence: 0.95,
            duration: 2.5,
            provider: "whisperkit"
        )

        XCTAssertEqual(result.text, "Hello world")
        XCTAssertEqual(result.language, "en")
        XCTAssertEqual(result.confidence, 0.95)
        XCTAssertEqual(result.duration, 2.5)
        XCTAssertEqual(result.provider, "whisperkit")
    }

    func testSTTResultWithMinimalFields() {
        let result = STTResult(
            text: "Test transcription",
            provider: "openai"
        )

        XCTAssertEqual(result.text, "Test transcription")
        XCTAssertNil(result.language)
        XCTAssertNil(result.confidence)
        XCTAssertNil(result.duration)
        XCTAssertEqual(result.provider, "openai")
    }

    func testSTTResultEquality() {
        let result1 = STTResult(text: "Hello", provider: "apple")
        let result2 = STTResult(text: "Hello", provider: "apple")
        let result3 = STTResult(text: "World", provider: "apple")

        XCTAssertEqual(result1, result2)
        XCTAssertNotEqual(result1, result3)
    }
}

// MARK: - STT Error Tests

final class STTErrorTests: XCTestCase {

    func testProviderUnavailableError() {
        let error = STTError.providerUnavailable("whisperkit")
        XCTAssertTrue(error.errorDescription?.contains("whisperkit") ?? false)
        XCTAssertTrue(error.errorDescription?.contains("not available") ?? false)
    }

    func testNoSpeechDetectedError() {
        let error = STTError.noSpeechDetected
        XCTAssertTrue(error.errorDescription?.contains("No speech detected") ?? false)
    }

    func testTranscriptionFailedError() {
        let error = STTError.transcriptionFailed("Network timeout")
        XCTAssertTrue(error.errorDescription?.contains("Network timeout") ?? false)
    }

    func testPermissionDeniedError() {
        let error = STTError.permissionDenied
        XCTAssertTrue(error.errorDescription?.contains("permission denied") ?? false)
    }

    func testModelNotDownloadedError() {
        let error = STTError.modelNotDownloaded("large")
        XCTAssertTrue(error.errorDescription?.contains("large") ?? false)
        XCTAssertTrue(error.errorDescription?.contains("downloaded") ?? false)
    }

    func testRateLimitExceededError() {
        let error = STTError.rateLimitExceeded
        XCTAssertTrue(error.errorDescription?.contains("Rate limit") ?? false)
    }
}

// MARK: - App Config Response Tests

final class AppConfigResponseTests: XCTestCase {

    func testAppConfigResponseDecoding() throws {
        let json = """
        {
            "stt": {
                "primary_provider": "apple",
                "fallback_provider": "whisperkit",
                "whisperkit_model": "medium",
                "provider_status": {
                    "stt_apple": "active",
                    "stt_whisperkit": "disabled",
                    "stt_openai": "active"
                }
            }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(AppConfigResponse.self, from: json)

        XCTAssertEqual(response.stt.primaryProvider, "apple")
        XCTAssertEqual(response.stt.fallbackProvider, "whisperkit")
        XCTAssertEqual(response.stt.whisperkitModel, "medium")
        XCTAssertFalse(response.stt.isProviderEnabled("whisperkit"))
    }

    func testRelativeOnboardingURLsResolveAgainstFetchedConfigHost() throws {
        let json = """
        {
            "stt": {
                "primary_provider": "apple",
                "fallback_provider": "whisperkit",
                "whisperkit_model": "medium",
                "provider_status": {
                    "stt_apple": "active",
                    "stt_whisperkit": "disabled",
                    "stt_openai": "active"
                }
            },
            "onboarding": {
                "sample_audio_url": "/audio/cafeteria-light-trimmed.mp3",
                "launch_flash_audio_url": "/audio/launch-flash.mp3",
                "question_graph_url": "/api/onboarding/graph.json"
            }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(AppConfigResponse.self, from: json)
            .resolvingRelativeURLs(against: URL(string: "https://api.porizo.co/app/config")!)

        XCTAssertEqual(response.onboarding?.sampleAudioUrl, "https://api.porizo.co/audio/cafeteria-light-trimmed.mp3")
        XCTAssertEqual(response.onboarding?.launchFlashAudioUrl, "https://api.porizo.co/audio/launch-flash.mp3")
        XCTAssertEqual(response.onboarding?.questionGraphUrl, "https://api.porizo.co/api/onboarding/graph.json")
    }

    func testAbsoluteOnboardingURLsRemainUntouched() throws {
        let json = """
        {
            "stt": {
                "primary_provider": "apple",
                "fallback_provider": "whisperkit",
                "whisperkit_model": "medium",
                "provider_status": {
                    "stt_apple": "active",
                    "stt_whisperkit": "disabled",
                    "stt_openai": "active"
                }
            },
            "onboarding": {
                "sample_audio_url": "https://cdn.example.com/audio/sample.mp3",
                "launch_flash_audio_url": "https://cdn.example.com/audio/launch.mp3",
                "question_graph_url": "https://cdn.example.com/api/onboarding/graph.json"
            }
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(AppConfigResponse.self, from: json)
            .resolvingRelativeURLs(against: URL(string: "https://api.porizo.co/app/config")!)

        XCTAssertEqual(response.onboarding?.sampleAudioUrl, "https://cdn.example.com/audio/sample.mp3")
        XCTAssertEqual(response.onboarding?.launchFlashAudioUrl, "https://cdn.example.com/audio/launch.mp3")
        XCTAssertEqual(response.onboarding?.questionGraphUrl, "https://cdn.example.com/api/onboarding/graph.json")
    }
}

final class AppConfigLoadPolicyTests: XCTestCase {

    func testFallsBackToHostedConfigOnSimulatorDebugWhenLocalConfig404s() {
        let fallbackURL = AppConfigLoadPolicy.fallbackURL(
            after: APIClientError.httpError(statusCode: 404, body: "missing"),
            primaryURL: AppConfigLoadPolicy.localSimulatorConfigURL,
            context: AppConfigLoadContext(isDebugBuild: true, isSimulator: true)
        )

        XCTAssertEqual(fallbackURL, AppConfigLoadPolicy.hostedConfigURL)
    }

    func testFallsBackToHostedConfigOnSimulatorDebugConnectivityFailure() {
        let fallbackURL = AppConfigLoadPolicy.fallbackURL(
            after: URLError(.cannotConnectToHost),
            primaryURL: AppConfigLoadPolicy.localSimulatorConfigURL,
            context: AppConfigLoadContext(isDebugBuild: true, isSimulator: true)
        )

        XCTAssertEqual(fallbackURL, AppConfigLoadPolicy.hostedConfigURL)
    }

    func testDoesNotFallbackOutsideSimulatorDebugContext() {
        let fallbackURL = AppConfigLoadPolicy.fallbackURL(
            after: APIClientError.httpError(statusCode: 404, body: "missing"),
            primaryURL: AppConfigLoadPolicy.localSimulatorConfigURL,
            context: AppConfigLoadContext(isDebugBuild: false, isSimulator: true)
        )

        XCTAssertNil(fallbackURL)
    }

    func testDoesNotFallbackForUnexpectedPrimaryURL() {
        let fallbackURL = AppConfigLoadPolicy.fallbackURL(
            after: APIClientError.httpError(statusCode: 404, body: "missing"),
            primaryURL: URL(string: "https://api.porizo.co/app/config")!,
            context: AppConfigLoadContext(isDebugBuild: true, isSimulator: true)
        )

        XCTAssertNil(fallbackURL)
    }
}

// MARK: - STT Router Tests

final class STTRouterTests: XCTestCase {

    @MainActor
    func testRouterInitialState() async {
        let apiClient = APIClient(baseURL: "http://localhost:3000")
        let router = STTRouter(apiClient: apiClient)

        XCTAssertFalse(router.configLoaded)
        XCTAssertFalse(router.isLoadingModel)
        XCTAssertEqual(router.config.primaryProvider, "whisperkit")  // Default
        XCTAssertEqual(router.config.fallbackProvider, "openai")    // Default
    }

    @MainActor
    func testDefaultConfigUsedWhenNotLoaded() async {
        let apiClient = APIClient(baseURL: "http://localhost:3000")
        let router = STTRouter(apiClient: apiClient)

        // Before config is loaded, should use defaults
        XCTAssertEqual(router.config.primaryProvider, "whisperkit")
        XCTAssertEqual(router.config.fallbackProvider, "openai")
        XCTAssertEqual(router.config.whisperkitModel, "small")
    }
}

// MARK: - Provider Availability Tests

final class STTProviderAvailabilityTests: XCTestCase {

    func testAppleProviderHasCorrectId() {
        XCTAssertEqual(AppleSpeechProvider.providerId, "apple")
    }

    func testWhisperKitProviderHasCorrectId() {
        XCTAssertEqual(WhisperKitProvider.providerId, "whisperkit")
    }

    func testOpenAIProviderHasCorrectId() {
        XCTAssertEqual(OpenAIWhisperProvider.providerId, "openai")
    }

    func testOpenAIProviderAlwaysAvailable() {
        // OpenAI provider uses backend API, so it's always available
        XCTAssertTrue(OpenAIWhisperProvider.isAvailable)
    }
}

// MARK: - Config Admin Switching Tests
// Tests to verify admin can switch providers without app update

final class STTAdminSwitchingTests: XCTestCase {

    func testConfigCanSwitchPrimaryProvider() {
        // Admin sets Apple as primary
        let config1 = STTConfig(
            primaryProvider: "apple",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: [:]
        )
        XCTAssertEqual(config1.primaryProvider, "apple")

        // Admin switches to WhisperKit
        let config2 = STTConfig(
            primaryProvider: "whisperkit",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: [:]
        )
        XCTAssertEqual(config2.primaryProvider, "whisperkit")

        // Admin switches to OpenAI
        let config3 = STTConfig(
            primaryProvider: "openai",
            fallbackProvider: "apple",
            whisperkitModel: "small",
            providerStatus: [:]
        )
        XCTAssertEqual(config3.primaryProvider, "openai")
    }

    func testConfigCanDisableProvider() {
        let config = STTConfig(
            primaryProvider: "whisperkit",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: ["stt_whisperkit": "disabled"]
        )

        XCTAssertFalse(config.isProviderEnabled("whisperkit"))
        XCTAssertTrue(config.isProviderEnabled("openai"))  // Still available
    }

    func testConfigCanChangeWhisperKitModel() {
        // Admin can switch between model sizes
        let models = ["tiny", "small", "medium", "large"]

        for model in models {
            let config = STTConfig(
                primaryProvider: "whisperkit",
                fallbackProvider: "openai",
                whisperkitModel: model,
                providerStatus: [:]
            )
            XCTAssertEqual(config.whisperkitModel, model)
        }
    }
}

// MARK: - Fallback Chain Tests
// Tests to verify graceful fallback when primary provider fails

final class STTFallbackChainTests: XCTestCase {

    func testFallbackChainWhenPrimaryDisabled() {
        let config = STTConfig(
            primaryProvider: "apple",
            fallbackProvider: "whisperkit",
            whisperkitModel: "small",
            providerStatus: ["stt_apple": "disabled", "stt_whisperkit": "active"]
        )

        // Primary is disabled
        XCTAssertFalse(config.isProviderEnabled("apple"))

        // Fallback should be available
        XCTAssertTrue(config.isProviderEnabled("whisperkit"))
    }

    func testOpenAIAlwaysAvailableAsLastResort() {
        // Even if primary and fallback are disabled, OpenAI should work
        let config = STTConfig(
            primaryProvider: "apple",
            fallbackProvider: "whisperkit",
            whisperkitModel: "small",
            providerStatus: [
                "stt_apple": "disabled",
                "stt_whisperkit": "disabled",
                "stt_openai": "active"
            ]
        )

        XCTAssertFalse(config.isProviderEnabled("apple"))
        XCTAssertFalse(config.isProviderEnabled("whisperkit"))
        XCTAssertTrue(config.isProviderEnabled("openai"))  // Last resort
    }

    func testAllProvidersCanBeDisabledExceptOne() {
        // At least one provider should remain available for fallback
        let config = STTConfig(
            primaryProvider: "openai",
            fallbackProvider: "openai",
            whisperkitModel: "small",
            providerStatus: [
                "stt_apple": "disabled",
                "stt_whisperkit": "disabled",
                "stt_openai": "active"
            ]
        )

        // Only OpenAI is available
        XCTAssertFalse(config.isProviderEnabled("apple"))
        XCTAssertFalse(config.isProviderEnabled("whisperkit"))
        XCTAssertTrue(config.isProviderEnabled("openai"))
    }
}
