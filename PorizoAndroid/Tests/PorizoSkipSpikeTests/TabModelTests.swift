import XCTest
@testable import PorizoSkipSpike

/// U1 — parity: the Android tab bar must mirror iOS `MainTabView` exactly.
/// iOS ships 4 tabs (Home / Songs / Poems / Settings) and has NO "Claim" tab —
/// claim is a deep-link-triggered sheet. These tests lock that contract so the
/// removed sarah-birthday "Claim" fixture tab cannot silently return.
final class TabModelTests: XCTestCase {

    func testExactlyFourTabsInCanonicalOrder() {
        XCTAssertEqual(
            ContentTab.allCases,
            [.home, .songs, .poems, .settings],
            "Android tabs must match iOS: Home, Songs, Poems, Settings"
        )
    }

    func testNoClaimOrRecipientTab() {
        let titles = ContentTab.allCases.map { $0.title }
        XCTAssertFalse(titles.contains("Claim"), "Claim must not be a tab (deep-link only)")
        XCTAssertEqual(ContentTab.allCases.count, 4, "No extra tabs beyond the canonical four")
    }

    func testFirstTabIsHome() {
        let first = ContentTab.allCases.first
        XCTAssertEqual(first, .home)
        XCTAssertEqual(first?.title, "Home")
        XCTAssertEqual(first?.symbol, "house")
    }

    func testTabTitlesMatchIOS() {
        XCTAssertEqual(ContentTab.home.title, "Home")
        XCTAssertEqual(ContentTab.songs.title, "Songs")
        XCTAssertEqual(ContentTab.poems.title, "Poems")
        XCTAssertEqual(ContentTab.settings.title, "Settings")
    }
}
