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
}
