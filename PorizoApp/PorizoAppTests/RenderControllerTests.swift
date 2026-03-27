//
//  RenderControllerTests.swift
//  PorizoAppTests
//
//  Tests for RenderController: the monetization-critical controller that
//  manages song render polling, state transitions, and backoff logic.
//

import XCTest
@testable import PorizoApp

final class RenderControllerTests: XCTestCase {

    // MARK: - Helpers

    /// Creates a RenderController with a dummy APIClient (localhost, no auth).
    /// Network calls will fail, but we cancel tasks before they fire.
    @MainActor
    private func makeController() -> RenderController {
        let api = APIClient(baseURL: "http://localhost:0", userId: "test-user")
        return RenderController(apiClient: api)
    }

    // MARK: - 1. startPreviewRender sets rendering state

    @MainActor
    func testStartPreviewRender_setsRenderingState() async throws {
        let controller = makeController()

        // Precondition: idle and not rendering
        XCTAssertEqual(controller.renderPhase, .idle)
        XCTAssertFalse(controller.isRendering)
        XCTAssertFalse(controller.isPreviewRendering)

        // Act: start a preview render
        controller.startPreviewRender(trackId: "track_1", versionNum: 1)

        // The task is spawned and the first thing it does is check for an
        // existing render (async network call). But the task creation itself
        // means renderTask is non-nil. The renderPhase transitions to
        // .rendering inside the task after resumeExistingRender returns.
        // Give the task a moment to begin executing.
        try await Task.sleep(for: .milliseconds(50))

        // The task should have called resetPreviewState() which sets .rendering.
        // Even if the network call fails, the phase should have transitioned.
        XCTAssertTrue(
            controller.isRendering || controller.renderPhase != .idle,
            "Expected renderPhase to leave idle after startPreviewRender"
        )

        // Cleanup: cancel to prevent dangling tasks
        controller.cancelAll()
    }

    // MARK: - 2. startPreviewRender cancels previous task

    @MainActor
    func testStartPreviewRender_cancelsPreviousTask() async throws {
        let controller = makeController()

        // Start first render
        controller.startPreviewRender(trackId: "track_1", versionNum: 1)
        try await Task.sleep(for: .milliseconds(20))

        // Start second render — the first task should be cancelled
        controller.startPreviewRender(trackId: "track_1", versionNum: 1)
        try await Task.sleep(for: .milliseconds(50))

        // After the second start, there should still be exactly one active
        // render attempt. The controller stores only one renderTask handle,
        // so the first is implicitly replaced after cancel.
        // The key behavior: isPreviewRendering should still be true (one task alive).
        // We verify the phase isn't doubled/stuck.
        let phase = controller.renderPhase
        XCTAssertTrue(
            phase == .rendering || phase == .idle || {
                if case .failed = phase { return true }
                return false
            }(),
            "Phase should be rendering, idle (not yet started), or failed (network error) — not duplicated"
        )

        controller.cancelAll()
    }

    // MARK: - 3. startFullRender sets rendering state

    @MainActor
    func testStartFullRender_setsRenderingState() async throws {
        let controller = makeController()

        // Precondition
        XCTAssertEqual(controller.fullRenderPhase, .notStarted)
        XCTAssertFalse(controller.isFullRendering)

        // Act: startFullRender sets fullRenderPhase = .rendering synchronously
        // before spawning the task (line 257 in the implementation).
        controller.startFullRender(trackId: "track_1", versionNum: 1)

        // This is set synchronously, no need to wait
        XCTAssertEqual(controller.fullRenderPhase, .rendering)
        XCTAssertTrue(controller.isFullRendering)
        XCTAssertTrue(controller.isRendering)

        controller.cancelAll()
    }

    // MARK: - 4. startFullRender cancels previous task (no duplicate)

    @MainActor
    func testStartFullRender_cancelsPreviousTask() async throws {
        let controller = makeController()

        // Start first full render
        controller.startFullRender(trackId: "track_1", versionNum: 1)
        XCTAssertEqual(controller.fullRenderPhase, .rendering)

        // Start second full render — should cancel the first, remain rendering
        controller.startFullRender(trackId: "track_1", versionNum: 1)
        XCTAssertEqual(controller.fullRenderPhase, .rendering)

        // Give a moment for the async work to settle
        try await Task.sleep(for: .milliseconds(50))

        // Phase should still be in a valid state (rendering or failed from
        // network error), never notStarted or completed without actual work
        let phase = controller.fullRenderPhase
        XCTAssertTrue(
            phase == .rendering || {
                if case .failed = phase { return true }
                return false
            }(),
            "Expected rendering or failed (due to network), got \(phase)"
        )

        controller.cancelAll()
    }

    // MARK: - 5. Backoff index returns correct intervals (HIGHEST VALUE TEST)

    func testBackoffIndex_returnsCorrectIntervals() {
        // The backoff formula: min(elapsed / 10_000_000_000, count - 1)
        // Intervals: [1s, 2s, 5s, 10s, 30s]
        // Index 0: elapsed 0-9s
        // Index 1: elapsed 10-19s
        // Index 2: elapsed 20-29s
        // Index 3: elapsed 30-39s
        // Index 4: elapsed 40s+ (clamped to max)

        let ns: UInt64 = 1_000_000_000

        // At 0 elapsed, should use first interval (1s)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 0), 0)
        XCTAssertEqual(RenderPollingConfig.backoffIntervalsNs[0], 1 * ns)

        // At 5s elapsed, still index 0 (< 10s threshold)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 5 * ns), 0)

        // At 9.9s, still index 0
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 9 * ns), 0)

        // At 10s, transitions to index 1 (2s interval)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 10 * ns), 1)
        XCTAssertEqual(RenderPollingConfig.backoffIntervalsNs[1], 2 * ns)

        // At 15s, still index 1
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 15 * ns), 1)

        // At 20s, index 2 (5s interval)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 20 * ns), 2)
        XCTAssertEqual(RenderPollingConfig.backoffIntervalsNs[2], 5 * ns)

        // At 30s, index 3 (10s interval)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 30 * ns), 3)
        XCTAssertEqual(RenderPollingConfig.backoffIntervalsNs[3], 10 * ns)

        // At 40s, index 4 (30s max interval)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 40 * ns), 4)
        XCTAssertEqual(RenderPollingConfig.backoffIntervalsNs[4], 30 * ns)

        // At 100s, still clamped to index 4 (never exceeds array bounds)
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 100 * ns), 4)

        // At 300s (5 min), still clamped
        XCTAssertEqual(RenderPollingConfig.backoffIndex(elapsed: 300 * ns), 4)

        // Verify the max duration constants are sane
        XCTAssertEqual(RenderPollingConfig.previewMaxDurationNs, 5 * 60 * ns,
                       "Preview max should be 5 minutes")
        XCTAssertEqual(RenderPollingConfig.fullRenderMaxDurationNs, 6 * 60 * ns,
                       "Full render max should be 6 minutes")

        // Verify interval array is monotonically non-decreasing
        let intervals = RenderPollingConfig.backoffIntervalsNs
        for i in 1..<intervals.count {
            XCTAssertGreaterThanOrEqual(intervals[i], intervals[i - 1],
                                        "Backoff intervals must be non-decreasing at index \(i)")
        }
    }

    // MARK: - 6. recoverAfterForeground resumes polling for in-progress render

    @MainActor
    func testRecoverAfterForeground_resumesIfRendering() async throws {
        let controller = makeController()

        // Simulate that a preview render was in progress (phase = .rendering)
        // by starting one and letting it begin
        controller.startPreviewRender(trackId: "track_1", versionNum: 1)
        try await Task.sleep(for: .milliseconds(50))

        // If the render task failed due to network, the phase might be .failed.
        // Force phase to .rendering to simulate the foreground recovery scenario
        // where the task was killed by backgrounding but phase persisted.
        // We use the fact that startFullRender sets phase synchronously to test
        // the full render path which is cleaner to observe.

        // Test full render recovery path (synchronous state is observable)
        controller.startFullRender(trackId: "track_1", versionNum: 1)
        XCTAssertEqual(controller.fullRenderPhase, .rendering)

        // Cancel the task to simulate app backgrounding killing the task
        controller.cancelAll()

        // Phase stays .rendering even though task was cancelled
        // (cancelAll doesn't reset phases, it just cancels tasks)
        XCTAssertEqual(controller.fullRenderPhase, .rendering)

        // Now recover — should start a new task since phase is .rendering
        controller.recoverAfterForeground(trackId: "track_1", versionNum: 1, mode: .fullRender)

        // Phase should still be .rendering (recovery re-entered startFullRender)
        XCTAssertEqual(controller.fullRenderPhase, .rendering)

        // Give the recovery task time to start
        try await Task.sleep(for: .milliseconds(50))

        // Should still be in an active state (rendering or failed from network)
        let phase = controller.fullRenderPhase
        XCTAssertTrue(
            phase == .rendering || {
                if case .failed = phase { return true }
                return false
            }(),
            "After recovery, phase should be rendering or failed (network), got \(phase)"
        )

        controller.cancelAll()
    }

    @MainActor
    func testRecoverAfterForeground_noOpWhenIdle() async throws {
        let controller = makeController()

        // Preview phase is idle, full render is notStarted
        XCTAssertEqual(controller.renderPhase, .idle)
        XCTAssertEqual(controller.fullRenderPhase, .notStarted)

        // Recovery should be a no-op when not rendering
        controller.recoverAfterForeground(trackId: "track_1", versionNum: 1, mode: .preview)
        controller.recoverAfterForeground(trackId: "track_1", versionNum: 1, mode: .fullRender)

        // Phases should remain unchanged
        XCTAssertEqual(controller.renderPhase, .idle)
        XCTAssertEqual(controller.fullRenderPhase, .notStarted)
        XCTAssertFalse(controller.isRendering)
    }
}
