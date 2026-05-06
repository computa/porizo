import XCTest
@testable import PorizoApp

final class AppUpdatePolicyTests: XCTestCase {

    func testEvaluatePromptsRequiredWhenCurrentVersionIsBelowMinimum() {
        let prompt = AppUpdatePolicy.evaluate(
            config: makeConfig(minimumVersion: "1.4.0"),
            currentVersion: "1.3.9",
            currentBuild: 120
        )

        XCTAssertEqual(prompt?.kind, .required)
        XCTAssertEqual(prompt?.targetVersion, "1.4.0")
    }

    func testEvaluatePromptsRecommendedWhenCurrentBuildIsBelowRecommendedBuild() {
        let prompt = AppUpdatePolicy.evaluate(
            config: makeConfig(recommendedBuild: 109),
            currentVersion: "1.4.0",
            currentBuild: 108
        )

        XCTAssertEqual(prompt?.kind, .recommended)
        XCTAssertEqual(prompt?.targetVersion, "build:109")
    }

    func testEvaluateDoesNotPromptWhenCurrentBuildMeetsRecommendedBuild() {
        let prompt = AppUpdatePolicy.evaluate(
            config: makeConfig(recommendedBuild: 109),
            currentVersion: "1.4.0",
            currentBuild: 109
        )

        XCTAssertNil(prompt)
    }

    func testEvaluateRequiredThresholdTakesPriorityOverRecommendedThreshold() {
        let prompt = AppUpdatePolicy.evaluate(
            config: makeConfig(minimumBuild: 110, recommendedBuild: 120),
            currentVersion: "1.4.0",
            currentBuild: 109
        )

        XCTAssertEqual(prompt?.kind, .required)
        XCTAssertEqual(prompt?.targetVersion, "build:110")
    }

    private func makeConfig(
        minimumVersion: String? = nil,
        minimumBuild: Int? = nil,
        recommendedVersion: String? = nil,
        recommendedBuild: Int? = nil
    ) -> AppUpdateConfig {
        AppUpdateConfig(
            minimumSupportedVersion: minimumVersion,
            minimumSupportedBuild: minimumBuild,
            recommendedVersion: recommendedVersion,
            recommendedBuild: recommendedBuild,
            message: nil,
            appStoreURL: AppConfig.appStoreURL
        )
    }
}
