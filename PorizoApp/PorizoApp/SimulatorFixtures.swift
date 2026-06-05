#if DEBUG
import Foundation

/// Central registry for simulator launch-argument fixtures used in local
/// validation and screenshot capture. DEBUG-only — never compiled into Release.
///
/// Usage (XcodeBuildMCP / Argent):
///   launch_app_sim(args: ["--bypass-auth", "--mock-payperson"])
///
/// See docs/dev/simulator-testing.md for the full cheat-sheet.
enum SimulatorFixtures {
    private static var args: [String] { ProcessInfo.processInfo.arguments }

    static func has(_ flag: String) -> Bool { args.contains(flag) }

    /// Any `--mock-*` entitlement fixture is active (used to skip onboarding so
    /// fixtures land straight in the app without a backend).
    static var isActive: Bool {
        has("--mock-payperson") || has("--mock-has-credits") || has("--mock-no-credits")
    }

    /// Canned billing entitlements for offline paywall/credit testing — returned
    /// by `APIClient.getBillingEntitlements()` instead of calling the backend.
    /// - `--mock-payperson`: pay-per-song ON, 0 credits → create-flow wall + hero.
    /// - `--mock-has-credits`: ongoing credits → can make a song.
    /// - `--mock-no-credits`: 0 credits, flag OFF → subscription-only wall.
    static var mockEntitlements: BillingEntitlements? {
        if has("--mock-payperson") {
            return .mock(
                tier: "free",
                giftWalletBalance: 0,
                availableSongCredits: 0,
                payPerSongEnabled: true
            )
        }
        if has("--mock-has-credits") {
            return .mock(
                tier: "plus",
                songsRemaining: 3,
                songsAllowance: 10,
                availableSongCredits: 3
            )
        }
        if has("--mock-no-credits") {
            return .mock(tier: "free", availableSongCredits: 0, payPerSongEnabled: false)
        }
        return nil
    }
}
#endif
