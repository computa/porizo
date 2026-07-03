import XCTest
@testable import PorizoSkipSpike

/// U12 — deep-link claim pure logic: share-state mapping, preview-URL choice,
/// and the device-token single-retry-on-401 decision (a contract item).
final class ClaimFlowTests: XCTestCase {

    // MARK: - Share-state mapping

    private func info(
        status: String,
        canAccess: Bool? = nil,
        pinRequired: Bool? = nil,
        claimRequiresApp: Bool? = nil
    ) -> PorizoShareInfoResponse {
        PorizoShareInfoResponse(
            status: status, appOnly: nil, canAccess: canAccess, appRequired: nil,
            claimRequiresApp: claimRequiresApp, pinRequiredForClaim: pinRequired,
            receiverSaveRequiresSession: nil, track: nil, trackPreview: nil,
            webStreamUrl: nil, appDownloadUrl: nil, isDemo: nil
        )
    }

    func testUnboundIsClaimable() {
        XCTAssertEqual(ClaimLogic.state(for: info(status: "unbound")), .claimable(needsPin: false))
    }

    func testUnboundWithPinRequiresPin() {
        XCTAssertEqual(ClaimLogic.state(for: info(status: "unbound", pinRequired: true)), .claimable(needsPin: true))
    }

    func testClaimedIsAlreadyClaimed() {
        XCTAssertEqual(ClaimLogic.state(for: info(status: "claimed")), .claimed)
    }

    func testRevokedIsUnavailable() {
        XCTAssertEqual(ClaimLogic.state(for: info(status: "revoked")), .unavailable)
    }

    func testDemoStatusIsUnavailable() {
        XCTAssertEqual(ClaimLogic.state(for: info(status: "demo")), .unavailable)
    }

    // MARK: - Preview URL selection

    func testPreviewPrefersWebStreamUrl() {
        let i = PorizoShareInfoResponse(
            status: "unbound", appOnly: nil, canAccess: true, appRequired: nil,
            claimRequiresApp: nil, pinRequiredForClaim: nil, receiverSaveRequiresSession: nil,
            track: nil, trackPreview: nil, webStreamUrl: "https://cdn/x.m4a",
            appDownloadUrl: nil, isDemo: nil
        )
        XCTAssertEqual(ClaimLogic.previewURL(from: i), "https://cdn/x.m4a")
    }

    func testPreviewNilWhenNoWebStream() {
        XCTAssertNil(ClaimLogic.previewURL(from: info(status: "unbound")))
    }

    // MARK: - Device-token single-retry-on-401 (contract item)

    func testDeviceTokenRetryOn401InvalidToken() {
        let err = AndroidAPIClientError.server(status: 401, code: "INVALID_DEVICE_TOKEN", message: "bad")
        XCTAssertTrue(ClaimLogic.shouldReregisterAndRetry(error: err))
    }

    func testDeviceTokenRetryOnSignInRequired() {
        let err = AndroidAPIClientError.server(status: 401, code: "SIGN_IN_REQUIRED", message: "x")
        XCTAssertTrue(ClaimLogic.shouldReregisterAndRetry(error: err))
    }

    func testNoRetryOnOther401Codes() {
        let err = AndroidAPIClientError.server(status: 401, code: "PIN_INVALID", message: "wrong pin")
        XCTAssertFalse(ClaimLogic.shouldReregisterAndRetry(error: err))
    }

    func testNoRetryOnNon401() {
        let err = AndroidAPIClientError.server(status: 409, code: "INVALID_DEVICE_TOKEN", message: "x")
        XCTAssertFalse(ClaimLogic.shouldReregisterAndRetry(error: err))
    }

    func testNoRetryOnNonServerError() {
        XCTAssertFalse(ClaimLogic.shouldReregisterAndRetry(error: AndroidAPIClientError.notAuthenticated))
    }

    // MARK: - Deep-link parsing (custom scheme host routing — regression guard)

    private let parser = AndroidDeepLinkParser()

    func testCustomSchemeReceiverHandoff() {
        XCTAssertEqual(parser.parse("porizo://receiver-handoff/rh_abc"), .receiverHandoff("rh_abc"))
    }

    func testCustomSchemePoemShare() {
        // Regression: the custom-scheme branch previously only matched
        // receiver-handoff, so porizo://poem-share/<id> fell through to .unknown.
        XCTAssertEqual(parser.parse("porizo://poem-share/ps_123"), .poemShare("ps_123"))
    }

    func testCustomSchemeShareAndPoem() {
        XCTAssertEqual(parser.parse("porizo://share/s1"), .share("s1"))
        XCTAssertEqual(parser.parse("porizo://poem/p1"), .poem("p1"))
    }

    func testCustomSchemeUnknownHost() {
        XCTAssertEqual(parser.parse("porizo://mystery/x"), .unknown("porizo://mystery/x"))
    }

    func testCustomSchemeMissingIdIsUnknown() {
        XCTAssertEqual(parser.parse("porizo://poem-share/"), .unknown("porizo://poem-share/"))
    }
}
