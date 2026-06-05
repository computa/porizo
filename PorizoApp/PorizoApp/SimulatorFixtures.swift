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

    static let revealReadyTrackId = "track_fixture_reveal_ready"
    static let revealReadyVersionNum = 1

    /// A fixture that should land us straight in the app (skip onboarding+auth).
    /// Covers the offline `--mock-*` states and the real-backend `--demo-login`.
    static var isActive: Bool {
        has("--mock-payperson") || has("--mock-has-credits")
            || has("--mock-no-credits") || has("--demo-login")
    }

    /// Demo account: when `--demo-login` is set, the app acts as a fixed, seeded
    /// user (sent as `x-user-id` via the DEBUG fallback) instead of a random
    /// device id — a stable "logged-in" account against the REAL local backend.
    /// Seed it with `npm run seed:demo`. Run the backend with ALLOW_ANON_USER_ID=true.
    static let demoUserId: String? = has("--demo-login") ? "user_demo_porizo" : nil

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
