import XCTest
@testable import PorizoSkipSpike

/// U14 — push payload parsing → tap routing. Delivery is external (OneSignal
/// dashboard, R-2); the parse + route decision is pure and tested here. Ports
/// iOS PushPayloadParser.
final class PushRoutingTests: XCTestCase {

    func testRenderCompleteRoutesToTrackReveal() {
        let json = #"{"type":"render_complete","trackId":"t-123","trackTitle":"Birthday Song"}"#
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: json), .trackReveal(trackId: "t-123"))
    }

    func testRecipientPlayedIsInformational() {
        let json = #"{"type":"recipient_played","trackId":"t-9","trackTitle":"X","recipientName":"Sarah"}"#
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: json), .informational)
    }

    func testRecipientPlayedWithoutNameStillInformational() {
        let json = #"{"type":"recipient_played","trackId":"t-9","trackTitle":"X"}"#
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: json), .informational)
    }

    func testRenderCompleteMissingTrackIdIsNone() {
        let json = #"{"type":"render_complete","trackTitle":"X"}"#
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: json), Optional.none)
    }

    func testUnknownTypeIsNone() {
        let json = #"{"type":"marketing","trackId":"t-1"}"#
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: json), Optional.none)
    }

    func testMalformedJSONIsNone() {
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: "not json"), Optional.none)
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: ""), Optional.none)
    }

    func testEmptyTrackIdIsNone() {
        let json = #"{"type":"render_complete","trackId":"","trackTitle":"X"}"#
        XCTAssertEqual(AndroidPushRouting.route(fromJSON: json), Optional.none)
    }
}
