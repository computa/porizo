import Foundation
import Observation
import SkipFuse

/// The reveal payload once a render resolves to a playable URL.
struct AndroidRenderResult: Equatable, Sendable {
    let trackId: String
    let audioURL: String
    let title: String
    let recipientName: String?
    let artworkURL: String?
}

/// Owns the async render lifecycle for the create flow (U9): kick off a preview
/// render, poll `/jobs/:id` on the exact iOS backoff, resume-before-start via
/// `GET /tracks/:id`, fall back after 3 poll misses, and surface friendly
/// errors. All the deterministic decisions live in `AndroidRenderController`;
/// this is the @Observable orchestration shell.
@MainActor
@Observable
final class AndroidRenderModel {

    /// Preview render phase, mirroring iOS `RenderPhase`.
    enum Phase: Equatable {
        case idle
        case rendering
        case completed
        case failed(String)
    }

    private(set) var phase: Phase = .idle
    /// Poll progress 0...100 when known.
    private(set) var progress: Int?
    /// Human-readable step line ("Writing lyrics…").
    private(set) var statusMessage: String?
    /// Friendly failure message + whether to offer Edit Lyrics / paywall CTAs.
    private(set) var errorMessage: String?
    private(set) var showEditLyricsCTA = false
    private(set) var showPaywallCTA = false
    /// The resolved reveal payload once complete.
    private(set) var result: AndroidRenderResult?

    var isRendering: Bool { phase == .rendering }

    private let apiClient: AndroidAPIClient
    private let pendingStore: AndroidRenderPollStore
    private var renderTask: Task<Void, Never>?
    private var pollingFailureCount = 0

    init(
        apiClient: AndroidAPIClient = AndroidAPIClient(),
        pendingStore: AndroidRenderPollStore = AndroidRenderPollStore()
    ) {
        self.apiClient = apiClient
        self.pendingStore = pendingStore
    }

    /// Approve the reviewed lyrics, then start (or resume) the preview render.
    func approveAndRender(trackId: String, versionNum: Int) {
        renderTask?.cancel()
        phase = .rendering
        progress = nil
        statusMessage = nil
        errorMessage = nil
        showEditLyricsCTA = false
        showPaywallCTA = false
        pollingFailureCount = 0

        renderTask = Task { [weak self] in
            guard let self else { return }
            do {
                // Resume-before-start: a render may already be in flight/done.
                if await self.resumeIfPossible(trackId: trackId, versionNum: versionNum) { return }

                _ = try? await self.apiClient.approveLyrics(trackId: trackId, versionNum: versionNum)

                let response = try await self.apiClient.renderPreview(trackId: trackId, versionNum: versionNum)
                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    self.persistPending(trackId: trackId, versionNum: versionNum, jobId: jobId)
                    await self.poll(jobId: jobId, trackId: trackId, versionNum: versionNum)
                } else {
                    _ = await self.checkTrack(trackId: trackId, versionNum: versionNum, failOnMissing: true)
                }
            } catch {
                guard !Task.isCancelled else { return }
                if await self.resumeIfPossible(trackId: trackId, versionNum: versionNum) { return }
                self.applyFailure(code: nil, message: String(describing: error), terms: [])
            }
        }
    }

    /// Retry a failed render via /retry, falling back to a fresh render.
    func retry(trackId: String, versionNum: Int) {
        renderTask?.cancel()
        phase = .rendering
        errorMessage = nil
        showEditLyricsCTA = false
        showPaywallCTA = false
        pollingFailureCount = 0

        renderTask = Task { [weak self] in
            guard let self else { return }
            do {
                let response = try await self.apiClient.retryPreview(trackId: trackId, versionNum: versionNum)
                guard !Task.isCancelled else { return }
                if let jobId = response.jobId {
                    self.persistPending(trackId: trackId, versionNum: versionNum, jobId: jobId)
                    await self.poll(jobId: jobId, trackId: trackId, versionNum: versionNum)
                } else {
                    _ = await self.checkTrack(trackId: trackId, versionNum: versionNum, failOnMissing: true)
                }
            } catch {
                guard !Task.isCancelled else { return }
                // On 404 / NO_FAILED_JOB the retry endpoint is a no-op — restart fresh.
                self.approveAndRender(trackId: trackId, versionNum: versionNum)
            }
        }
    }

    func cancel() {
        renderTask?.cancel()
        renderTask = nil
    }

    // MARK: - Resume

    private func resumeIfPossible(trackId: String, versionNum: Int) async -> Bool {
        guard let version = await fetchVersion(trackId: trackId, versionNum: versionNum) else {
            return false
        }
        switch AndroidRenderController.resumeDecision(version: version, isFull: false) {
        case .complete(let url):
            await complete(trackId: trackId, url: url)
            return true
        case .resumePoll(let jobId):
            self.persistPending(trackId: trackId, versionNum: versionNum, jobId: jobId)
            await poll(jobId: jobId, trackId: trackId, versionNum: versionNum)
            return true
        case .failed(let message):
            applyFailure(code: version.lastErrorCode, message: message, terms: [])
            return true
        case .startFresh:
            return false
        }
    }

    // MARK: - Poll loop

    private func poll(jobId: String, trackId: String, versionNum: Int) async {
        var elapsed: UInt64 = 0
        while elapsed < AndroidRenderController.previewMaxDurationNs {
            guard !Task.isCancelled else { return }

            let idx = AndroidRenderController.backoffIndex(elapsedNs: elapsed)
            let interval = AndroidRenderController.backoffIntervalsNs[idx]
            try? await Task.sleep(nanoseconds: interval)
            elapsed += interval
            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getJobStatus(jobId: jobId)
                pollingFailureCount = 0
                progress = status.progress
                statusMessage = AndroidRenderController.stepMessage(status: status.status, step: status.step)

                if AndroidRenderController.isCompleted(status.status) {
                    // C7: never trust a URL from the job payload — re-fetch the track.
                    _ = await checkTrack(trackId: trackId, versionNum: versionNum, failOnMissing: true)
                    return
                }
                if AndroidRenderController.isTerminalFailure(status.status) {
                    applyFailure(code: status.errorCode, message: status.errorMessage, terms: status.errorTerms ?? [])
                    return
                }
            } catch {
                guard !Task.isCancelled else { return }
                pollingFailureCount += 1
                if pollingFailureCount >= AndroidRenderController.maxPollingFailures {
                    if await checkTrack(trackId: trackId, versionNum: versionNum, failOnMissing: false) { return }
                    applyFailure(code: nil, message: "Connection error. Check your network and try again.", terms: [])
                    return
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }

        guard !Task.isCancelled else { return }
        if await checkTrack(trackId: trackId, versionNum: versionNum, failOnMissing: false) { return }
        applyFailure(code: nil, message: "Render timed out. Please try again.", terms: [])
    }

    // MARK: - Track fetch

    private func fetchVersion(trackId: String, versionNum: Int) async -> PorizoTrackVersion? {
        let response = try? await apiClient.getTrack(id: trackId)
        return response?.versions.first { $0.versionNum == versionNum }
    }

    /// Re-fetch the track; complete if the version now has a URL, else optionally fail.
    @discardableResult
    private func checkTrack(trackId: String, versionNum: Int, failOnMissing: Bool) async -> Bool {
        guard let response = try? await apiClient.getTrack(id: trackId) else {
            if failOnMissing { applyFailure(code: nil, message: "Preview not ready yet", terms: []) }
            return false
        }
        guard let version = response.versions.first(where: { $0.versionNum == versionNum }) else {
            if failOnMissing { applyFailure(code: nil, message: "Preview not ready yet", terms: []) }
            return false
        }
        if version.status == "failed" {
            applyFailure(code: version.lastErrorCode, message: version.lastErrorMessage, terms: [])
            return true
        }
        if let url = version.previewUrl ?? version.fullUrl {
            await complete(trackId: trackId, url: url, track: response.track)
            return true
        }
        if failOnMissing { applyFailure(code: nil, message: "Preview not ready yet", terms: []) }
        return false
    }

    private func complete(trackId: String, url: String, track: PorizoTrackSummary? = nil) async {
        var resolved = track
        if resolved == nil {
            resolved = (try? await apiClient.getTrack(id: trackId))?.track
        }
        progress = 100
        statusMessage = nil
        pendingStore.clear()
        result = AndroidRenderResult(
            trackId: trackId,
            audioURL: url,
            title: resolved?.title ?? "Your song",
            recipientName: resolved?.recipientName,
            artworkURL: resolved?.artworkUrl
        )
        phase = .completed
    }

    // MARK: - Failure

    private func applyFailure(code: String?, message: String?, terms: [String]) {
        let friendly = AndroidRenderController.userFacingMessage(code: code, message: message, terms: terms)
        errorMessage = friendly
        showEditLyricsCTA = AndroidRenderController.shouldShowEditLyricsCTA(code: code, message: message, terms: terms)
        showPaywallCTA = AndroidRenderController.isPaywallError(code: code)
        pendingStore.clear()
        phase = .failed(friendly)
    }

    private func persistPending(trackId: String, versionNum: Int, jobId: String) {
        pendingStore.save(PorizoPendingRender(
            trackId: trackId, versionNum: versionNum, jobId: jobId,
            renderType: "preview", updatedAt: ""
        ))
    }
}
