//
//  ShareControllerTests.swift
//  PorizoAppTests
//
//  Tests for ShareController phase transitions, revocation, and
//  concurrent operation safety.
//

import XCTest
@testable import PorizoApp

final class ShareControllerTests: XCTestCase {

    // MARK: - Helpers

    /// Create a test APIClient that will fail network calls (expected —
    /// we only observe phase transitions, not actual responses).
    private func makeAPIClient() -> APIClient {
        APIClient(baseURL: "http://localhost:9999", userId: "test-share")
    }

    // MARK: - Generate Share Link Phase Transitions

    @MainActor
    func testGenerateShareLink_phaseTransitions() async {
        let controller = ShareController(apiClient: makeAPIClient())

        // Initial state
        XCTAssertEqual(controller.phase, .idle, "Should start in idle phase")
        XCTAssertFalse(controller.isLoading)
        XCTAssertFalse(controller.isGeneratingLink)

        // Trigger generation — will move to .creating immediately,
        // then settle on .failed (no real server).
        controller.generateShareLink(trackId: "track_1", versionNum: 1)

        // Synchronous: phase should be .creating right after the call
        XCTAssertEqual(controller.phase, .creating,
                       "Phase should transition to .creating immediately")
        XCTAssertTrue(controller.isLoading,
                      "isLoading should be true during .creating")
        XCTAssertTrue(controller.isGeneratingLink,
                      "isGeneratingLink should be true during .creating")

        // Wait for the async Task to settle (network failure)
        let expectation = XCTestExpectation(description: "Phase settles after network call")
        Task { @MainActor in
            // Poll until phase is no longer .creating (up to 5s)
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                if controller.phase != .creating {
                    break
                }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        // Should have settled to .failed or .hasShare
        // (With a fake server it will be .failed)
        switch controller.phase {
        case .failed:
            XCTAssertNotNil(controller.shareError,
                            "shareError should be populated on failure")
        case .hasShare:
            // Would happen with a real server — also acceptable
            break
        default:
            XCTFail("Unexpected final phase: \(controller.phase)")
        }
    }

    // MARK: - Revoke Share Phase Transitions

    @MainActor
    func testRevokeShare_phaseTransitions() async {
        let controller = ShareController(apiClient: makeAPIClient())

        // Simulate starting from .hasShare state by injecting a createResponse.
        // We can't directly set phase since it's private(set), but we can
        // call generateShareLink to go through the flow, or we can verify
        // from the revokeShare call directly.

        // Calling revokeShare from any state should attempt the revocation.
        // The Task inside revokeShare runs async — on failure, it goes to .failed.
        controller.revokeShare(trackId: "track_1")

        // Wait for the async Task to settle
        let expectation = XCTestExpectation(description: "Revoke settles")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                if controller.phase != .idle {
                    break
                }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        // On network failure, phase goes to .failed
        // On success (not possible here), it would go to .noShare and clear state
        switch controller.phase {
        case .failed:
            XCTAssertNotNil(controller.shareError)
        case .noShare:
            // Would mean revocation succeeded — verify cleanup
            XCTAssertNil(controller.createResponse)
            XCTAssertNil(controller.stats)
            XCTAssertNil(controller.shareURL)
        default:
            // .idle is also acceptable if the Task hasn't executed yet
            break
        }
    }

    // MARK: - Concurrent Generate + Revoke Safety

    @MainActor
    func testConcurrentGenerateRevoke_noCorruption() async {
        let controller = ShareController(apiClient: makeAPIClient())

        // Fire both operations in rapid succession
        controller.generateShareLink(trackId: "track_1", versionNum: 1)
        controller.revokeShare(trackId: "track_1")

        // Wait for both Tasks to settle
        let expectation = XCTestExpectation(description: "Both operations settle")
        Task { @MainActor in
            for _ in 0..<50 {
                try? await Task.sleep(nanoseconds: 100_000_000)
                let phase = controller.phase
                // Settled when not in a transitional state
                if phase != .creating && phase != .loading {
                    break
                }
            }
            expectation.fulfill()
        }
        await fulfillment(of: [expectation], timeout: 10)

        // The key assertion: phase must be a valid terminal state.
        // It should NOT be stuck in .creating or .loading.
        let finalPhase = controller.phase
        let validTerminalStates: [SharePhase] = [.idle, .noShare, .hasShare]

        switch finalPhase {
        case .idle, .noShare, .hasShare:
            // All valid terminal states after concurrent ops
            break
        case .failed:
            // Also valid — network errors from both operations
            break
        case .creating, .loading:
            XCTFail("Phase should not be stuck in transitional state: \(finalPhase)")
        }

        // Verify internal state consistency: if phase is .noShare,
        // share data should be cleared
        if finalPhase == .noShare {
            XCTAssertNil(controller.createResponse,
                         "createResponse should be nil when phase is .noShare")
            XCTAssertNil(controller.shareURL,
                         "shareURL should be nil when phase is .noShare")
        }
    }

    // MARK: - Reset

    @MainActor
    func testReset_clearsAllState() {
        let controller = ShareController(apiClient: makeAPIClient())

        // Put controller into a non-idle state
        controller.generateShareLink(trackId: "track_1", versionNum: 1)
        // Now reset
        controller.reset()

        XCTAssertEqual(controller.phase, .idle)
        XCTAssertNil(controller.shareURL)
        XCTAssertNil(controller.shareError)
        XCTAssertNil(controller.createResponse)
        XCTAssertNil(controller.stats)
        XCTAssertNil(controller.qrCodeData)
        XCTAssertFalse(controller.isLoading)
        XCTAssertFalse(controller.isGeneratingLink)
    }

    // MARK: - prepareShareData

    @MainActor
    func testPrepareShareData_returnsNilWithoutShare() {
        let controller = ShareController(apiClient: makeAPIClient())

        let content = controller.prepareShareData(
            trackTitle: "Happy Birthday",
            recipientName: "Chioma"
        )
        XCTAssertNil(content,
                     "prepareShareData should return nil when no share exists")
    }

    // MARK: - Song Share Payload Contract

    func testSongShareMessage_containsUrlAndPin() {
        let message = SongSharePayloadBuilder.message(
            shareURL: "https://porizo.app/play/sh_123",
            claimPin: "246810",
            recipientName: "Chioma",
            occasion: "mothers_day"
        )

        XCTAssertTrue(message.contains("https://porizo.app/play/sh_123"))
        XCTAssertTrue(message.contains("PIN: 246810"))
        XCTAssertTrue(message.contains("Chioma"))
        XCTAssertTrue(message.lowercased().contains("mother"))
    }

    func testNativeShareURLs_preserveFullMessageAsSingleTextValue() throws {
        let body = SongSharePayloadBuilder.message(
            shareURL: "https://porizo.app/play/sh_123?gift=1&recipient=Chioma",
            claimPin: "246810",
            recipientName: "Chioma",
            occasion: "birthday"
        )

        let whatsapp = SongSharePayloadBuilder.nativeURL(for: .whatsapp, body: body)
        let whatsappText = URLComponents(
            url: try XCTUnwrap(whatsapp),
            resolvingAgainstBaseURL: false
        )?.queryItems?.first(where: { $0.name == "text" })?.value
        XCTAssertEqual(whatsappText, body)

        let x = SongSharePayloadBuilder.nativeURL(for: .x, body: body)
        let xText = URLComponents(
            url: try XCTUnwrap(x),
            resolvingAgainstBaseURL: false
        )?.queryItems?.first(where: { $0.name == "message" })?.value
        XCTAssertEqual(xText, body)

        let messages = try XCTUnwrap(SongSharePayloadBuilder.nativeURL(for: .messages, body: body))
        XCTAssertTrue(messages.absoluteString.hasPrefix("sms:&body="))
        XCTAssertFalse(
            messages.absoluteString.contains("&recipient=Chioma"),
            "Nested ampersands from the share URL must be encoded inside the SMS body value"
        )
        XCTAssertTrue(messages.absoluteString.removingPercentEncoding?.contains("PIN: 246810") == true)
        XCTAssertTrue(
            messages.absoluteString.removingPercentEncoding?.contains("https://porizo.app/play/sh_123?gift=1&recipient=Chioma") == true
        )
    }

    #if DEBUG
    @MainActor
    func testSeedDebugShare_marksShareAsReady() {
        let controller = ShareController(apiClient: makeAPIClient())

        controller.seedDebugShare(
            shareUrl: "https://porizo.app/play/sh_fixture",
            claimPin: "246810",
            shareId: "sh_fixture"
        )

        XCTAssertEqual(controller.phase, .hasShare)
        XCTAssertEqual(controller.shareURLString, "https://porizo.app/play/sh_fixture")
        XCTAssertEqual(controller.claimPin, "246810")
        XCTAssertFalse(controller.isGeneratingLink)
        XCTAssertNil(controller.shareError)
    }
    #endif
}
