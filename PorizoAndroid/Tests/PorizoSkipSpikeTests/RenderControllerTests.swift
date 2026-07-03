import XCTest
@testable import PorizoSkipSpike

/// U9 — render-poll state machine pure logic. The plan flags the backoff
/// schedule, terminal-status set, resume-before-start decision, and error
/// taxonomy as exact-contract items, so this is the correctness core.
final class RenderControllerTests: XCTestCase {

    // MARK: - Backoff schedule (1,2,5,10,30,30…)

    func testBackoffIndexByElapsedBucket() {
        // 10s threshold buckets: <10 → idx0, <20 → idx1, <30 → idx2, <40 → idx3, ≥40 → idx4
        let s: UInt64 = 1_000_000_000
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 0), 0)
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 9 * s), 0)
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 10 * s), 1)
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 25 * s), 2)
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 35 * s), 3)
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 45 * s), 4)
        XCTAssertEqual(AndroidRenderController.backoffIndex(elapsedNs: 600 * s), 4) // clamps
    }

    func testBackoffIntervalsAreOneTwoFiveTenThirtySeconds() {
        let intervals = AndroidRenderController.backoffIntervalsNs
        XCTAssertEqual(intervals, [1, 2, 5, 10, 30].map { UInt64($0) * 1_000_000_000 })
    }

    func testBackoffScheduleRampsByElapsedNotPollCount() {
        // The interval keys off *cumulative elapsed time*, not poll count: the
        // first ~10s of polls are 1s each, then 2s until 20s elapsed, etc. This
        // is the exact iOS behavior — a slow ramp, not per-poll doubling.
        var elapsed: UInt64 = 0
        var schedule: [UInt64] = []
        for _ in 0..<14 {
            let idx = AndroidRenderController.backoffIndex(elapsedNs: elapsed)
            let interval = AndroidRenderController.backoffIntervalsNs[idx]
            schedule.append(interval / 1_000_000_000)
            elapsed += interval
        }
        // 10×1s (0→10s), then 5×2s (10→20s), then 5s once (20→25s)…
        XCTAssertEqual(Array(schedule.prefix(10)), Array(repeating: 1, count: 10))
        XCTAssertEqual(schedule[10], 2)
        XCTAssertEqual(schedule[13], 2)
    }

    // MARK: - Terminal status set

    func testTerminalStatuses() {
        XCTAssertTrue(AndroidRenderController.isTerminalFailure("failed"))
        XCTAssertTrue(AndroidRenderController.isTerminalFailure("dead_letter"))
        XCTAssertTrue(AndroidRenderController.isTerminalFailure("blocked"))
        XCTAssertFalse(AndroidRenderController.isTerminalFailure("completed"))
        XCTAssertFalse(AndroidRenderController.isTerminalFailure("queued"))
        XCTAssertFalse(AndroidRenderController.isTerminalFailure("processing"))
    }

    func testCompletedIsCompleteButNotFailure() {
        XCTAssertTrue(AndroidRenderController.isCompleted("completed"))
        XCTAssertFalse(AndroidRenderController.isCompleted("processing"))
    }

    // MARK: - Resume-before-start decision (covers C12)

    private func version(
        status: String = "processing",
        previewUrl: String? = nil,
        fullUrl: String? = nil,
        previewJobId: String? = nil,
        fullJobId: String? = nil,
        lastErrorCode: String? = nil,
        lastErrorMessage: String? = nil
    ) -> PorizoTrackVersion {
        PorizoTrackVersion(
            id: "v1", versionNum: 1, status: status,
            previewUrl: previewUrl, fullUrl: fullUrl,
            previewJobId: previewJobId, fullJobId: fullJobId,
            lastErrorCode: lastErrorCode, lastErrorMessage: lastErrorMessage
        )
    }

    func testResumeExistingUrlCompletesImmediately() {
        let decision = AndroidRenderController.resumeDecision(
            version: version(previewUrl: "/tracks/x/v1/preview.m4a"), isFull: false
        )
        XCTAssertEqual(decision, .complete(url: "/tracks/x/v1/preview.m4a"))
    }

    func testResumePrefersFullUrlForFullRender() {
        let decision = AndroidRenderController.resumeDecision(
            version: version(previewUrl: "/p.m4a", fullUrl: "/f.m4a"), isFull: true
        )
        XCTAssertEqual(decision, .complete(url: "/f.m4a"))
    }

    func testResumeExistingJobIdResumesPollNoNewRender() {
        let decision = AndroidRenderController.resumeDecision(
            version: version(previewJobId: "job-abc"), isFull: false
        )
        XCTAssertEqual(decision, .resumePoll(jobId: "job-abc"))
    }

    func testResumeFailedVersionSurfacesError() {
        let decision = AndroidRenderController.resumeDecision(
            version: version(status: "failed", lastErrorCode: "E302_SUNO_POLICY_ERROR",
                             lastErrorMessage: "content policy"),
            isFull: false
        )
        guard case let .failed(message) = decision else {
            return XCTFail("expected .failed, got \(decision)")
        }
        XCTAssertTrue(message.lowercased().contains("edit lyrics"))
    }

    func testResumeNoUrlNoJobStartsFresh() {
        let decision = AndroidRenderController.resumeDecision(version: version(), isFull: false)
        XCTAssertEqual(decision, .startFresh)
    }

    // MARK: - Error taxonomy → friendly message + CTA (covers C11)

    func testInsufficientCreditsMapsToPaywallMessage() {
        let msg = AndroidRenderController.userFacingMessage(code: "INSUFFICIENT_CREDITS", message: nil, terms: [])
        XCTAssertTrue(msg.lowercased().contains("plan"))
        XCTAssertFalse(AndroidRenderController.shouldShowEditLyricsCTA(code: "INSUFFICIENT_CREDITS", message: nil, terms: []))
        XCTAssertTrue(AndroidRenderController.isPaywallError(code: "INSUFFICIENT_CREDITS"))
        XCTAssertTrue(AndroidRenderController.isPaywallError(code: "NO_ENTITLEMENTS"))
    }

    func testPolicyErrorShowsEditLyricsCTA() {
        XCTAssertTrue(AndroidRenderController.shouldShowEditLyricsCTA(
            code: "E302_SUNO_POLICY_ERROR", message: "lyrics policy violation", terms: ["kanye"]))
        let msg = AndroidRenderController.userFacingMessage(
            code: "E302_SUNO_POLICY_ERROR", message: "lyrics policy", terms: ["kanye"])
        XCTAssertTrue(msg.lowercased().contains("edit lyrics"))
    }

    func testDailyLimitMessage() {
        let msg = AndroidRenderController.userFacingMessage(code: "DAILY_LIMIT_REACHED", message: nil, terms: [])
        XCTAssertTrue(msg.lowercased().contains("daily") || msg.lowercased().contains("limit"))
    }

    func testGenericFailureFallsBackToTryAgain() {
        let msg = AndroidRenderController.userFacingMessage(code: nil, message: "", terms: [])
        XCTAssertFalse(msg.isEmpty)
    }

    func testServerMessagePreservedWhenNoTaxonomyMatch() {
        let msg = AndroidRenderController.userFacingMessage(
            code: nil, message: "Something oddly specific happened", terms: [])
        XCTAssertEqual(msg, "Something oddly specific happened")
    }

    // MARK: - Step → status message

    func testStepMessages() {
        XCTAssertEqual(AndroidRenderController.stepMessage(status: "processing", step: "lyrics"), "Writing lyrics…")
        XCTAssertEqual(AndroidRenderController.stepMessage(status: "processing", step: "mix"),
                       "Mixing vocals and instrumental…")
        XCTAssertNil(AndroidRenderController.stepMessage(status: "completed", step: "ready"))
        XCTAssertNil(AndroidRenderController.stepMessage(status: "failed", step: "mix"))
    }
}
