import XCTest
@testable import PorizoSkipSpike

/// U2 — audio adapter pure policy (URL transform + header encoding).
/// These assertions are host-runnable: they exercise only static Swift logic,
/// no ExoPlayer and no iOS-only SwiftUI.
final class AudioHeaderTests: XCTestCase {

    func testOwnedContentUsesBearerOnly() {
        let headers = AndroidAudioPlayerProvider.ownedContentHeaders(accessToken: "abc123")
        XCTAssertEqual(headers, ["Authorization": "Bearer abc123"])
    }

    func testSharedContentHasNoHeaders() {
        XCTAssertTrue(AndroidAudioPlayerProvider.sharedContentHeaders().isEmpty,
                      "Shared/pre-signed URLs must not carry auth headers")
    }

    func testAbsoluteURLPassesThroughUnchanged() {
        let httpsURL = "https://cdn.porizo.co/tracks/1/full.m4a"
        XCTAssertEqual(AndroidAudioPlayerProvider.absoluteURL(httpsURL), httpsURL)
        let httpURL = "http://localhost:3000/stream.mp3"
        XCTAssertEqual(AndroidAudioPlayerProvider.absoluteURL(httpURL), httpURL)
    }

    func testRelativeURLResolvesAgainstApiBase() {
        let base = AndroidAppConfig.apiBaseURL
        let expectedBase = base.hasSuffix("/") ? String(base.dropLast()) : base

        XCTAssertEqual(
            AndroidAudioPlayerProvider.absoluteURL("/tracks/1/stream"),
            expectedBase + "/tracks/1/stream"
        )
        // Missing leading slash is normalized in.
        XCTAssertEqual(
            AndroidAudioPlayerProvider.absoluteURL("tracks/1/stream"),
            expectedBase + "/tracks/1/stream"
        )
    }

    func testEncodeEmptyHeadersIsEmptyObject() {
        XCTAssertEqual(AndroidAudioPlayerProvider.encodeHeaders([:]), "{}")
    }

    func testEncodeHeadersProducesValidJSON() {
        let json = AndroidAudioPlayerProvider.encodeHeaders(["Authorization": "Bearer x"])
        XCTAssertEqual(json, "{\"Authorization\":\"Bearer x\"}")

        // Round-trips through JSONSerialization.
        let data = Data(json.utf8)
        let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: String]
        XCTAssertEqual(parsed, ["Authorization": "Bearer x"])
    }

    func testEncodeHeadersEscapesSpecialCharacters() {
        let json = AndroidAudioPlayerProvider.encodeHeaders(["X-Quote": "a\"b\\c"])
        let data = Data(json.utf8)
        let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: String]
        XCTAssertEqual(parsed, ["X-Quote": "a\"b\\c"], "Quotes and backslashes must survive a JSON round-trip")
    }
}
