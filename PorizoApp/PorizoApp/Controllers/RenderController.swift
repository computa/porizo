//
//  RenderController.swift
//  PorizoApp
//
//  Owns the full render lifecycle: preview render, full render, retry,
//  exponential-backoff polling, failure analysis, and error messaging.
//
//  Extracted from TrackPlayerFullView to enable reuse across player,
//  notification-driven flows, and background refresh.
//

import Foundation
import Observation

// MARK: - Polling Configuration

enum RenderPollingConfig {
    /// Exponential backoff intervals: 1s, 2s, 5s, 10s, 30s (max)
    static let backoffIntervalsNs: [UInt64] = [
        1_000_000_000,   // 1s
        2_000_000_000,   // 2s
        5_000_000_000,   // 5s
        10_000_000_000,  // 10s
        30_000_000_000   // 30s (max)
    ]

    /// Maximum duration for preview render polling (5 minutes)
    static let previewMaxDurationNs: UInt64 = 5 * 60 * 1_000_000_000

    /// Maximum duration for full render polling (6 minutes)
    static let fullRenderMaxDurationNs: UInt64 = 6 * 60 * 1_000_000_000

    /// Interval threshold for backoff calculation (10 seconds in ns)
    static let backoffThresholdNs: UInt64 = 10_000_000_000

    /// Calculate the appropriate backoff interval index based on elapsed time
    static func backoffIndex(elapsed: UInt64) -> Int {
        min(Int(elapsed / backoffThresholdNs), backoffIntervalsNs.count - 1)
    }
}

// MARK: - Render Phase

/// Phase of a preview render lifecycle.
enum RenderPhase: Equatable {
    case idle
    case rendering
    case completed
    case failed(String)
}

/// Phase of a full render lifecycle.
enum FullRenderPhase: Equatable {
    case notStarted
    case rendering
    case completed
    case failed(String)
}

// MARK: - Render Completion

/// Encapsulates the outcome of a render that resolved to a playable URL.
struct RenderResult: Sendable {
    let audioURL: String
    let trackTitle: String
    let recipientName: String
    let occasion: String
    let lyrics: [RenderController.LyricLine]
    let coverImageUrl: String?
    let coverImageSmallUrl: String?
    let coverImageLargeUrl: String?
    let artworkUrl: String?
}

// MARK: - Render Error Detail

/// All error detail for a render failure, gathered from the API response.
struct RenderErrorDetail: Equatable {
    var message: String?
    var code: String?
    var terms: [String] = []
    var category: String?
    var suggestedAction: String?
    var canAutoRewrite: Bool = false
    var provider: String?

    static let empty = RenderErrorDetail()
}

// MARK: - Render Controller

@Observable
@MainActor
final class RenderController {

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Published State

    /// Current phase of the preview render.
    private(set) var renderPhase: RenderPhase = .idle

    /// Current phase of the full render.
    private(set) var fullRenderPhase: FullRenderPhase = .notStarted

    /// Progress percentage (0-100) from job polling, nil when unknown.
    private(set) var progress: Int?

    /// Human-readable step message during rendering (e.g. "Writing lyrics...").
    private(set) var statusMessage: String?

    /// Structured error detail from the last render failure.
    private(set) var errorDetail: RenderErrorDetail = .empty

    /// Whether a preview render is in progress.
    var isPreviewRendering: Bool {
        if case .rendering = renderPhase { return true }
        return false
    }

    /// Whether a full render is in progress.
    var isFullRendering: Bool {
        if case .rendering = fullRenderPhase { return true }
        return false
    }

    /// Whether any render is active.
    var isRendering: Bool { isPreviewRendering || isFullRendering }

    // MARK: - Job State

    /// Job ID for the active preview render.
    private(set) var previewJobId: String?

    /// Job ID for the active full render.
    private(set) var fullRenderJobId: String?

    // MARK: - Polling

    private var pollingFailureCount = 0
    private let maxPollingFailures = 3

    // MARK: - Task Handles

    private var renderTask: Task<Void, Never>?
    private var fullRenderTask: Task<Void, Never>?

    // MARK: - Callbacks

    /// Called when a preview render completes with a playable URL.
    var onPreviewComplete: ((RenderResult) -> Void)?

    /// Called when a full render completes with a playable URL.
    var onFullRenderComplete: ((RenderResult) -> Void)?

    /// Called when a full render fails with a user-facing message.
    var onFullRenderFailed: ((String) -> Void)?

    // MARK: - Initialization

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Public API

    enum RecoveryMode { case preview, fullRender }

    /// Called by the view on foreground return. Checks current phase and resumes
    /// if a render was in-flight but the task was lost to backgrounding.
    /// Safe to call multiple times — startPreviewRender/startFullRender call
    /// resumeExistingRender first, which checks server state before creating work.
    func recoverAfterForeground(trackId: String, versionNum: Int, mode: RecoveryMode) {
        switch mode {
        case .preview:
            guard renderPhase == .rendering else { return }
            startPreviewRender(trackId: trackId, versionNum: versionNum)
        case .fullRender:
            guard fullRenderPhase == .rendering else { return }
            startFullRender(trackId: trackId, versionNum: versionNum)
        }
    }

    /// Start a preview render. Resumes an existing render if one is in progress.
    func startPreviewRender(trackId: String, versionNum: Int) {
        renderTask?.cancel()
        #if DEBUG
        if completeRevealReadyFixtureRender(trackId: trackId, versionNum: versionNum, isFull: false) {
            return
        }
        #endif
        renderTask = Task {
            do {
                print("[RenderController] Checking for existing render...")
                if await resumeExistingRender(trackId: trackId, versionNum: versionNum) {
                    print("[RenderController] Resumed existing render")
                    return
                }

                resetPreviewState()

                print("[RenderController] No existing render, calling renderPreview API...")
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderPreview") {
                    try await self.apiClient.renderPreview(trackId: trackId, versionNum: versionNum)
                }
                print("[RenderController] renderPreview response: jobId=\(response.jobId ?? "nil")")

                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    self.previewJobId = jobId
                    await pollForCompletion(jobId: jobId, trackId: trackId, versionNum: versionNum)
                } else {
                    _ = await checkTrackStatus(trackId: trackId, versionNum: versionNum)
                }
            } catch {
                print("[RenderController] renderPreview failed: \(error.localizedDescription)")
                guard !Task.isCancelled else { return }
                if await resumeExistingRender(trackId: trackId, versionNum: versionNum) {
                    return
                }
                applyPreviewFailure(from: error)
            }
        }
    }

    /// Retry a failed preview render via the /retry endpoint.
    func retryPreviewRender(trackId: String, versionNum: Int) {
        print("[RenderController] retryPreviewRender() called — using /retry endpoint")
        #if DEBUG
        if completeRevealReadyFixtureRender(trackId: trackId, versionNum: versionNum, isFull: false) {
            return
        }
        #endif
        resetPreviewState()

        renderTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "retryPreview") {
                    try await self.apiClient.retryPreview(trackId: trackId, versionNum: versionNum)
                }
                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    self.previewJobId = jobId
                    await pollForCompletion(jobId: jobId, trackId: trackId, versionNum: versionNum)
                } else {
                    _ = await checkTrackStatus(trackId: trackId, versionNum: versionNum)
                }
            } catch let APIClientError.httpError(statusCode, _) where statusCode == 404 {
                print("[RenderController] retryPreview got 404, falling back to startPreviewRender")
                guard !Task.isCancelled else { return }
                startPreviewRender(trackId: trackId, versionNum: versionNum)
            } catch let APIClientError.serverError(message, code, _) where isMissingRetryableJobError(message: message, code: code) {
                print("[RenderController] retryPreview got NO_FAILED_JOB, falling back to startPreviewRender")
                guard !Task.isCancelled else { return }
                startPreviewRender(trackId: trackId, versionNum: versionNum)
            } catch {
                print("[RenderController] retryPreview failed: \(error.localizedDescription)")
                guard !Task.isCancelled else { return }
                applyPreviewFailure(from: error)
            }
        }
    }

    /// Start a full render. Resumes an existing render if one is in progress.
    func startFullRender(trackId: String, versionNum: Int) {
        fullRenderTask?.cancel()
        #if DEBUG
        if completeRevealReadyFixtureRender(trackId: trackId, versionNum: versionNum, isFull: true) {
            return
        }
        #endif
        fullRenderPhase = .rendering
        statusMessage = nil
        pollingFailureCount = 0

        fullRenderTask = Task {
            do {
                if await resumeExistingFullRender(trackId: trackId, versionNum: versionNum) {
                    return
                }
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderFull") {
                    try await self.apiClient.renderFull(trackId: trackId, versionNum: versionNum)
                }

                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    fullRenderJobId = jobId
                    await pollForFullRenderCompletion(jobId: jobId, trackId: trackId, versionNum: versionNum)
                } else {
                    _ = await checkFullRenderStatus(trackId: trackId, versionNum: versionNum)
                }
            } catch {
                guard !Task.isCancelled else { return }
                if await resumeExistingFullRender(trackId: trackId, versionNum: versionNum) {
                    return
                }
                applyFullRenderFailure(from: error)
            }
        }
    }

    /// Retry a failed full render via the /retry endpoint.
    func retryFullRender(trackId: String, versionNum: Int) {
        print("[RenderController] retryFullRender() called — using /retry endpoint")
        #if DEBUG
        if completeRevealReadyFixtureRender(trackId: trackId, versionNum: versionNum, isFull: true) {
            return
        }
        #endif
        fullRenderPhase = .rendering
        statusMessage = nil
        pollingFailureCount = 0

        fullRenderTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "retryFullRender") {
                    try await self.apiClient.retryFullRender(trackId: trackId, versionNum: versionNum)
                }
                guard !Task.isCancelled else { return }

                if let jobId = response.jobId {
                    fullRenderJobId = jobId
                    await pollForFullRenderCompletion(jobId: jobId, trackId: trackId, versionNum: versionNum)
                } else {
                    _ = await checkFullRenderStatus(trackId: trackId, versionNum: versionNum)
                }
            } catch let APIClientError.httpError(statusCode, _) where statusCode == 404 {
                print("[RenderController] retryFullRender got 404, falling back to startFullRender")
                guard !Task.isCancelled else { return }
                startFullRender(trackId: trackId, versionNum: versionNum)
            } catch let APIClientError.serverError(message, code, _) where isMissingRetryableJobError(message: message, code: code) {
                print("[RenderController] retryFullRender got NO_FAILED_JOB, falling back to startFullRender")
                guard !Task.isCancelled else { return }
                startFullRender(trackId: trackId, versionNum: versionNum)
            } catch {
                guard !Task.isCancelled else { return }
                if await resumeExistingFullRender(trackId: trackId, versionNum: versionNum) {
                    return
                }
                applyFullRenderFailure(from: error)
            }
        }
    }

    /// Cancel all in-flight render tasks and polling.
    func cancelAll() {
        renderTask?.cancel()
        renderTask = nil
        fullRenderTask?.cancel()
        fullRenderTask = nil
    }

    // MARK: - Error Analysis (Public)

    /// Whether the current error state warrants showing an "Edit Lyrics" CTA.
    func shouldShowEditLyricsCTA() -> Bool {
        guard let message = errorDetail.message else { return false }
        return Self.shouldShowEditLyricsCTA(message, detail: errorDetail)
    }

    /// User-facing suggestions for how to fix policy-violating terms.
    func policySuggestions() -> [String] {
        Self.renderPolicySuggestions(errorDetail.terms)
    }

    // MARK: - Preview Render Internals

    private func resetPreviewState() {
        renderPhase = .rendering
        progress = nil
        statusMessage = nil
        errorDetail = .empty
        pollingFailureCount = 0
    }

    private func resumeExistingRender(trackId: String, versionNum: Int) async -> Bool {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "resumeExistingRender") {
                try await self.apiClient.getTrack(trackId: trackId)
            }

            let result = Self.extractTrackMetadata(from: response)

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                if version.status == "failed" {
                    applyVersionFailure(version)
                    return true
                }

                let lyrics = Self.parseLyrics(from: version.lyricsJson)

                if let url = version.previewUrl ?? version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    self.progress = 100
                    self.renderPhase = .completed
                    onPreviewComplete?(buildRenderResult(
                        audioURL: transformedUrl, response: response, version: version,
                        metadata: result, lyrics: lyrics
                    ))
                    return true
                }
                if let existingJobId = version.previewJobId {
                    self.previewJobId = existingJobId
                    await pollForCompletion(jobId: existingJobId, trackId: trackId, versionNum: versionNum)
                    return true
                }
            }
        } catch {
            print("[RenderController] Resume existing render check failed: \(error.localizedDescription)")
        }
        return false
    }

    private func pollForCompletion(jobId: String, trackId: String, versionNum: Int) async {
        var elapsed: UInt64 = 0

        while elapsed < RenderPollingConfig.previewMaxDurationNs {
            guard !Task.isCancelled else { return }

            let intervalIndex = RenderPollingConfig.backoffIndex(elapsed: elapsed)
            let pollInterval = RenderPollingConfig.backoffIntervalsNs[intervalIndex]

            try? await Task.sleep(for: .nanoseconds(pollInterval))
            elapsed += pollInterval

            guard !Task.isCancelled else { return }

            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "pollJobStatus") {
                    try await self.apiClient.getJobStatus(jobId: jobId)
                }

                self.progress = status.progress
                self.statusMessage = Self.renderMessage(for: status)
                self.pollingFailureCount = 0

                switch status.status {
                case "completed":
                    _ = await checkTrackStatus(trackId: trackId, versionNum: versionNum)
                    return

                case "failed", "dead_letter", "blocked":
                    applyJobFailure(status, phase: .preview)
                    return

                default:
                    continue
                }
            } catch {
                guard !Task.isCancelled else { return }

                pollingFailureCount += 1

                if pollingFailureCount >= maxPollingFailures {
                    if await checkTrackStatus(trackId: trackId, versionNum: versionNum, setFailureOnMissing: false) {
                        return
                    }
                    renderPhase = .failed("Connection error after \(maxPollingFailures) attempts")
                    return
                }

                try? await Task.sleep(for: .seconds(2))
                continue
            }
        }

        guard !Task.isCancelled else { return }
        if await checkTrackStatus(trackId: trackId, versionNum: versionNum, setFailureOnMissing: false) {
            return
        }
        renderPhase = .failed("Render timed out. Please try again.")
    }

    private func checkTrackStatus(trackId: String, versionNum: Int, setFailureOnMissing: Bool = true) async -> Bool {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkTrackStatus") {
                try await self.apiClient.getTrack(trackId: trackId)
            }

            let result = Self.extractTrackMetadata(from: response)

            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                if version.status == "failed" {
                    applyVersionFailure(version)
                    return true
                }

                let lyrics = Self.parseLyrics(from: version.lyricsJson)

                if let url = version.previewUrl ?? version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    self.progress = 100
                    self.renderPhase = .completed
                    onPreviewComplete?(buildRenderResult(
                        audioURL: transformedUrl, response: response, version: version,
                        metadata: result, lyrics: lyrics
                    ))
                    return true
                } else {
                    if setFailureOnMissing {
                        renderPhase = .failed("Preview not ready yet")
                    }
                    return false
                }
            } else {
                if setFailureOnMissing {
                    renderPhase = .failed("Preview not ready yet")
                }
                return false
            }
        } catch {
            if setFailureOnMissing {
                applyPreviewFailure(from: error)
            }
            return false
        }
    }

    private func applyPreviewFailure(from error: Error) {
        let context = Self.renderErrorContext(for: error)
        let derived = Self.deriveRenderFailureHints(code: context.code, message: context.message)
        let friendlyMessage = Self.userFacingRenderError(context.message, code: context.code, detail: errorDetail)
        let terms = Self.mergedPolicyTerms(nil, fromMessage: error.localizedDescription)

        errorDetail = RenderErrorDetail(
            message: friendlyMessage,
            code: context.code,
            terms: terms,
            category: derived.category,
            suggestedAction: derived.suggestedAction,
            canAutoRewrite: derived.canAutoRewrite,
            provider: derived.provider
        )
        renderPhase = .failed(friendlyMessage)
    }

    // MARK: - Full Render Internals

    private func resumeExistingFullRender(trackId: String, versionNum: Int) async -> Bool {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "resumeFullRender") {
                try await self.apiClient.getTrack(trackId: trackId)
            }
            if let version = response.versions.first(where: { $0.versionNum == versionNum }) {
                if version.status == "failed" {
                    applyVersionFailure(version, isFull: true)
                    return true
                }
                if let url = version.fullUrl {
                    let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                    let result = Self.extractTrackMetadata(from: response)
                    let lyrics = Self.parseLyrics(from: version.lyricsJson)
                    fullRenderPhase = .completed
                    onFullRenderComplete?(buildRenderResult(
                        audioURL: transformedUrl, response: response, version: version,
                        metadata: result, lyrics: lyrics
                    ))
                    return true
                }
                if let existingJobId = version.fullJobId {
                    fullRenderJobId = existingJobId
                    await pollForFullRenderCompletion(jobId: existingJobId, trackId: trackId, versionNum: versionNum)
                    return true
                }
            }
        } catch {
            print("[RenderController] Resume existing full render check failed: \(error.localizedDescription)")
        }
        return false
    }

    private func pollForFullRenderCompletion(jobId: String, trackId: String, versionNum: Int) async {
        var elapsed: UInt64 = 0

        while elapsed < RenderPollingConfig.fullRenderMaxDurationNs {
            guard !Task.isCancelled else { return }

            let intervalIndex = RenderPollingConfig.backoffIndex(elapsed: elapsed)
            let pollInterval = RenderPollingConfig.backoffIntervalsNs[intervalIndex]

            try? await Task.sleep(for: .nanoseconds(pollInterval))
            elapsed += pollInterval

            guard !Task.isCancelled else { return }

            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "pollFullRenderStatus") {
                    try await self.apiClient.getJobStatus(jobId: jobId)
                }

                self.statusMessage = Self.renderMessage(for: status, isFull: true)

                switch status.status {
                case "completed":
                    _ = await checkFullRenderStatus(trackId: trackId, versionNum: versionNum)
                    return

                case "failed", "dead_letter", "blocked":
                    applyJobFailure(status, phase: .full)
                    return

                default:
                    continue
                }
            } catch {
                guard !Task.isCancelled else { return }

                pollingFailureCount += 1

                if pollingFailureCount >= maxPollingFailures {
                    let msg = "Connection error. Check your network and try again."
                    fullRenderPhase = .failed(msg)
                    onFullRenderFailed?(msg)
                    return
                }

                try? await Task.sleep(for: .seconds(2))
                continue
            }
        }

        guard !Task.isCancelled else { return }
        if await checkFullRenderStatus(trackId: trackId, versionNum: versionNum, setFailureOnMissing: false) {
            return
        }
        let msg = "Full render timed out. Please try again."
        fullRenderPhase = .failed(msg)
        onFullRenderFailed?(msg)
    }

    private func checkFullRenderStatus(trackId: String, versionNum: Int, setFailureOnMissing: Bool = true) async -> Bool {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkFullRenderStatus") {
                try await self.apiClient.getTrack(trackId: trackId)
            }

            if let version = response.versions.first(where: { $0.versionNum == versionNum }),
               let url = version.fullUrl {
                let transformedUrl = transformAudioUrl(url, baseURL: apiClient.baseURL)
                let result = Self.extractTrackMetadata(from: response)
                let lyrics = Self.parseLyrics(from: version.lyricsJson)
                fullRenderPhase = .completed
                // Delay review prompt so user enjoys "Song Created!" moment first
                try? await Task.sleep(for: .seconds(3))
                if !Task.isCancelled {
                    ReviewManager.shared.recordFullRenderComplete()
                }
                onFullRenderComplete?(buildRenderResult(
                    audioURL: transformedUrl, response: response, version: version,
                    metadata: result, lyrics: lyrics
                ))
                return true
            } else if let version = response.versions.first(where: { $0.versionNum == versionNum }),
                      version.status == "failed" {
                applyVersionFailure(version, isFull: true)
                return true
            } else {
                if setFailureOnMissing {
                    let msg = "Full render not ready"
                    fullRenderPhase = .failed(msg)
                    onFullRenderFailed?(msg)
                }
                return false
            }
        } catch {
            if setFailureOnMissing {
                applyFullRenderFailure(from: error)
            }
            return false
        }
    }

    private func applyFullRenderFailure(from error: Error) {
        let friendlyMessage = Self.userFacingRenderError(error.localizedDescription, code: nil, detail: errorDetail)
        let terms = Self.mergedPolicyTerms(nil, fromMessage: error.localizedDescription)
        errorDetail = RenderErrorDetail(
            message: friendlyMessage,
            code: nil,
            terms: terms,
            category: nil,
            suggestedAction: nil,
            canAutoRewrite: false,
            provider: nil
        )
        fullRenderPhase = .failed(friendlyMessage)
        onFullRenderFailed?(friendlyMessage)
    }

    // MARK: - Shared Failure Helpers

    private enum FailurePhase { case preview, full }

    private func applyJobFailure(_ status: JobStatus, phase: FailurePhase) {
        let terms = Self.mergedPolicyTerms(status.errorTerms, fromMessage: status.errorMessage)
        let friendlyMessage = Self.userFacingRenderError(status.errorMessage, code: status.errorCode, detail: errorDetail)

        errorDetail = RenderErrorDetail(
            message: friendlyMessage,
            code: status.errorCode,
            terms: terms,
            category: status.effectiveErrorCategory,
            suggestedAction: status.suggestedAction,
            canAutoRewrite: status.canAutoRewrite ?? false,
            provider: status.provider
        )

        switch phase {
        case .preview: renderPhase = .failed(friendlyMessage)
        case .full:
            fullRenderPhase = .failed(friendlyMessage)
            onFullRenderFailed?(friendlyMessage)
        }
    }

    private func applyVersionFailure(_ version: TrackVersion, isFull: Bool = false) {
        let failureCode = version.lastErrorCode ?? "RENDER_FAILED"
        let hints = Self.deriveRenderFailureHints(code: failureCode, message: version.lastErrorMessage ?? errorDetail.message)
        let friendlyMessage = Self.userFacingRenderError(
            version.lastErrorMessage ?? errorDetail.message,
            code: failureCode,
            detail: errorDetail
        )
        let terms = Self.mergedPolicyTerms(version.lastErrorTerms, fromMessage: version.lastErrorMessage)

        errorDetail = RenderErrorDetail(
            message: friendlyMessage,
            code: failureCode,
            terms: terms,
            category: version.lastErrorCategory ?? hints.category,
            suggestedAction: version.lastErrorSuggestedAction ?? hints.suggestedAction,
            canAutoRewrite: version.lastErrorCanAutoRewrite ?? hints.canAutoRewrite,
            provider: version.lastErrorProvider ?? hints.provider
        )

        if isFull {
            fullRenderPhase = .failed(friendlyMessage)
            onFullRenderFailed?(friendlyMessage)
        } else {
            renderPhase = .failed(friendlyMessage)
        }
    }

    // MARK: - Metadata Extraction

    private struct TrackMetadata {
        let title: String
        let recipientName: String
        let occasion: String
    }

    private static func extractTrackMetadata(from response: GetTrackResponse) -> TrackMetadata {
        TrackMetadata(
            title: response.track.title,
            recipientName: response.track.recipientName ?? "",
            occasion: response.track.occasion ?? ""
        )
    }

    /// Build a `RenderResult` from a track response, version, and resolved audio URL.
    /// Centralizes the cover-image fallback logic that was duplicated across four call sites.
    private func buildRenderResult(
        audioURL: String,
        response: GetTrackResponse,
        version: TrackVersion,
        metadata: TrackMetadata,
        lyrics: [LyricLine]
    ) -> RenderResult {
        RenderResult(
            audioURL: audioURL,
            trackTitle: metadata.title,
            recipientName: metadata.recipientName,
            occasion: metadata.occasion,
            lyrics: lyrics,
            coverImageUrl: version.coverImageUrl ?? response.track.coverImageUrl,
            coverImageSmallUrl: version.coverImageSmallUrl ?? response.track.coverImageSmallUrl,
            coverImageLargeUrl: version.coverImageLargeUrl ?? response.track.coverImageLargeUrl,
            artworkUrl: response.track.artworkUrl
        )
    }

    // MARK: - Lyrics Parsing

    /// A parsed lyric line for display.
    struct LyricLine: Identifiable, Sendable {
        let id = UUID()
        let text: String
        let startTime: Double?
    }

    static func parseLyrics(from lyricsData: Lyrics?) -> [LyricLine] {
        guard let lyrics = lyricsData else { return [] }

        var lines: [LyricLine] = []
        for section in lyrics.sections {
            for line in section.lines {
                let trimmed = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    lines.append(LyricLine(text: trimmed, startTime: line.startTime))
                }
            }
        }
        return lines
    }

    #if DEBUG
    @discardableResult
    private func completeRevealReadyFixtureRender(trackId: String, versionNum: Int, isFull: Bool) -> Bool {
        guard SimulatorFixtures.has("--fixture-reveal-ready"),
              trackId == SimulatorFixtures.revealReadyTrackId,
              versionNum == SimulatorFixtures.revealReadyVersionNum else {
            return false
        }

        let result = Self.revealReadyFixtureResult(isFull: isFull)
        progress = 100
        statusMessage = nil
        errorDetail = .empty

        if isFull {
            fullRenderPhase = .completed
            onFullRenderComplete?(result)
        } else {
            renderPhase = .completed
            onPreviewComplete?(result)
        }
        return true
    }

    private static func revealReadyFixtureResult(isFull: Bool) -> RenderResult {
        RenderResult(
            audioURL: revealReadyFixtureAudioURL().absoluteString,
            trackTitle: "Birthday Song for Sarah",
            recipientName: "Sarah",
            occasion: "birthday",
            lyrics: [
                LyricLine(text: "Sarah, today the room lights up for you", startTime: 0.5),
                LyricLine(text: "Every laugh turns into something new", startTime: 4.0),
                LyricLine(text: "We saved this chorus for your birthday night", startTime: 8.0),
                LyricLine(text: isFull ? "Sing it loud, let every candle shine" : "One more year of stories taking flight", startTime: 12.0)
            ],
            coverImageUrl: nil,
            coverImageSmallUrl: nil,
            coverImageLargeUrl: nil,
            artworkUrl: nil
        )
    }

    private static func revealReadyFixtureAudioURL() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("porizo-reveal-ready-fixture.wav")

        guard !FileManager.default.fileExists(atPath: url.path) else { return url }

        do {
            try buildRevealReadyFixtureWav().write(to: url, options: .atomic)
        } catch {
            print("[RenderController] Failed to write reveal-ready fixture audio: \(error.localizedDescription)")
        }
        return url
    }

    private static func buildRevealReadyFixtureWav() -> Data {
        let sampleRate = 44_100
        let channels = 1
        let bitsPerSample = 16
        let durationSeconds = 16
        let totalSamples = sampleRate * durationSeconds
        let byteRate = sampleRate * channels * bitsPerSample / 8
        let blockAlign = channels * bitsPerSample / 8
        let dataByteCount = totalSamples * blockAlign
        let notes = [261.63, 329.63, 392.00, 523.25]

        var data = Data()
        appendASCII("RIFF", to: &data)
        appendUInt32LE(UInt32(36 + dataByteCount), to: &data)
        appendASCII("WAVE", to: &data)
        appendASCII("fmt ", to: &data)
        appendUInt32LE(16, to: &data)
        appendUInt16LE(1, to: &data)
        appendUInt16LE(UInt16(channels), to: &data)
        appendUInt32LE(UInt32(sampleRate), to: &data)
        appendUInt32LE(UInt32(byteRate), to: &data)
        appendUInt16LE(UInt16(blockAlign), to: &data)
        appendUInt16LE(UInt16(bitsPerSample), to: &data)
        appendASCII("data", to: &data)
        appendUInt32LE(UInt32(dataByteCount), to: &data)

        for sampleIndex in 0..<totalSamples {
            let time = Double(sampleIndex) / Double(sampleRate)
            let noteIndex = min(Int(time / 4.0), notes.count - 1)
            let frequency = notes[noteIndex]
            let notePosition = time.truncatingRemainder(dividingBy: 4.0)
            let fadeIn = min(1.0, notePosition / 0.25)
            let fadeOut = min(1.0, (4.0 - notePosition) / 0.35)
            let envelope = min(fadeIn, fadeOut)
            let sample = Int16((sin(2.0 * .pi * frequency * time) * envelope * 4_000.0).rounded())
            appendInt16LE(sample, to: &data)
        }

        return data
    }

    private static func appendASCII(_ string: String, to data: inout Data) {
        data.append(contentsOf: string.utf8)
    }

    private static func appendUInt16LE(_ value: UInt16, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }

    private static func appendUInt32LE(_ value: UInt32, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }

    private static func appendInt16LE(_ value: Int16, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }
    #endif

    // MARK: - Render Step Messaging

    private static func renderErrorContext(for error: Error) -> (message: String, code: String?) {
        if case let APIClientError.serverError(message: message, code: code, details: _) = error {
            return (message, code)
        }
        return (error.localizedDescription, nil)
    }

    private func isMissingRetryableJobError(message: String, code: String?) -> Bool {
        if (code ?? "").uppercased() == "NO_FAILED_JOB" {
            return true
        }
        return message.localizedCaseInsensitiveContains("no failed job found to retry")
    }

    static func deriveRenderFailureHints(code: String?, message: String?) -> (category: String?, suggestedAction: String?, canAutoRewrite: Bool, provider: String?) {
        let normalizedCode = (code ?? "").uppercased()
        let lowercased = (message ?? "").lowercased()

        let inferredProvider: String? = {
            if normalizedCode.hasPrefix("E302_SUNO") || lowercased.contains("suno") { return "suno" }
            if normalizedCode.hasPrefix("E301_ELEVENLABS") || lowercased.contains("elevenlabs") { return "elevenlabs" }
            return nil
        }()

        if normalizedCode == "E302_PROVIDER_POLICY_ERROR" ||
            normalizedCode == "E302_SUNO_POLICY_ERROR" ||
            lowercased.contains("content policy") ||
            lowercased.contains("lyrics policy") ||
            lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") {
            return ("policy_content", "rewrite_and_retry", true, inferredProvider)
        }

        if normalizedCode == "E301_ELEVENLABS_VALIDATION" ||
            lowercased.contains("bad_composition_plan") ||
            lowercased.contains("bad_prompt") ||
            lowercased.contains("compose validation failed") {
            return ("policy_validation", "rewrite_and_retry", true, inferredProvider ?? "elevenlabs")
        }

        if normalizedCode == "E302_QUALITY_GATE_FAILED" || lowercased.contains("quality gate") {
            return ("quality_gate", "retry_with_adjusted_style", true, inferredProvider)
        }

        if normalizedCode == "E302_SUNO_INCOMPLETE_OUTPUT" ||
            lowercased.contains("no audio url in response") ||
            lowercased.contains("no audio data in response") ||
            lowercased.contains("incomplete audio result") {
            return ("infra_retryable", "retry", false, inferredProvider ?? "suno")
        }

        if normalizedCode == "PROVIDER_ERROR_429" || lowercased.contains("rate limit") {
            return ("provider_transient", "wait_and_retry", false, inferredProvider)
        }

        if normalizedCode == "INSUFFICIENT_CREDITS" || normalizedCode == "NO_ENTITLEMENTS" {
            return ("entitlement_limit", "upgrade_or_wait", false, inferredProvider)
        }

        // U4: server returns HTTP 422 SUNO_PERSONA_NOT_READY when the user
        // selects voice_mode=user_voice but their Suno persona profile is not
        // yet active. Without a dedicated branch this falls through to the
        // catch-all and surfaces as ("infra_terminal","retry") — wrong UX
        // because retrying changes nothing while the persona is preparing.
        if normalizedCode == "SUNO_PERSONA_NOT_READY" ||
            normalizedCode == "E302_SUNO_PERSONA_NOT_READY" ||
            normalizedCode == "SUNO_VOICE_PERSONA_REQUIRED" {
            return ("input_missing", "wait_for_persona", false, "suno")
        }

        if normalizedCode == "E302_SUNO_PERSONA_CONSENT_REQUIRED" ||
            normalizedCode == "E302_SUNO_PERSONA_REQUIRED" ||
            normalizedCode == "E302_VOICE_PROFILE_REQUIRED" ||
            normalizedCode == "E302_SUNO_PERSONA_PROFILE_MISSING" {
            return ("input_missing", "enroll_voice", false, "suno")
        }

        if normalizedCode == "E302_PERSONALIZED_VOICE_CONVERSION_DISABLED" ||
            normalizedCode == "E302_SUNO_PERSONA_FAILED" {
            return ("input_missing", "switch_voice_mode", false, "suno")
        }

        if normalizedCode == "DAILY_LIMIT_REACHED" || lowercased.contains("daily preview limit reached") {
            return ("entitlement_limit", "wait_for_reset", false, inferredProvider)
        }

        // FFmpeg/processing errors
        if normalizedCode == "E301_FFMPEG_TIMEOUT" || normalizedCode == "E301_FFMPEG_SPAWN" {
            return ("processing_retryable", "retry", false, nil)
        }

        if normalizedCode == "E301_FFMPEG_ERROR" {
            return ("processing_terminal", "retry", false, nil)
        }

        // Missing inputs (deterministic)
        if normalizedCode == "E301_MISSING_INPUTS" ||
            normalizedCode == "E301_MISSING_STEMS" ||
            normalizedCode == "E301_GUIDE_VOCAL_MISSING" {
            return ("input_missing", "retry", false, nil)
        }

        // Lyrics/workflow errors
        if normalizedCode == "E201_LYRICS_ERROR" {
            if lowercased.contains("ai_unavailable") {
                return ("processing_retryable", "retry", false, nil)
            }
            return ("processing_terminal", "retry", false, nil)
        }

        if normalizedCode == "E302_WORKFLOW_ERROR" ||
            normalizedCode == "E302_PERSONALIZED_NO_PROVIDER" ||
            normalizedCode == "E305_ELEVENLABS_VOICE_ERROR" ||
            normalizedCode == "E301_SOURCE_URL_EXPIRED" {
            return ("processing_terminal", "retry", false, inferredProvider)
        }

        if lowercased.contains("timeout") || lowercased.contains("network") {
            return ("infra_retryable", "retry", false, inferredProvider)
        }

        return ("infra_terminal", "retry", false, inferredProvider)
    }

    static func userFacingRenderError(_ rawMessage: String?, code: String?, detail: RenderErrorDetail) -> String {
        let message = (rawMessage ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let lowercased = message.lowercased()
        let normalizedCode = (code ?? "").uppercased()
        let derived = deriveRenderFailureHints(code: normalizedCode.isEmpty ? nil : normalizedCode, message: message)
        let effectiveCategory = detail.category ?? derived.category
        let effectiveAction = detail.suggestedAction ?? derived.suggestedAction
        let effectiveCanRewrite = detail.canAutoRewrite || derived.canAutoRewrite

        if effectiveCategory == "quality_gate" {
            return "The generated audio didn't meet quality standards. Tap Try Again to regenerate, or edit the style."
        }

        if effectiveAction == "rewrite_and_retry" ||
            effectiveCategory == "policy_content" ||
            effectiveCategory == "policy_validation" ||
            effectiveCanRewrite {
            if !detail.terms.isEmpty {
                return "We found lyrics content the music provider rejected. Tap Edit Lyrics to revise the flagged lines, then try again."
            }
            return "The music provider rejected part of these lyrics. Tap Edit Lyrics to revise wording, then try again."
        }

        if normalizedCode == "E302_PROVIDER_POLICY_ERROR" ||
            normalizedCode == "E302_SUNO_POLICY_ERROR" {
            if !detail.terms.isEmpty {
                return "Lyrics were blocked by provider policy. Tap Edit Lyrics to update the flagged terms and retry."
            }
            return "Lyrics were blocked by provider policy. Tap Edit Lyrics and remove artist names, brand names, explicit content, or age references."
        }

        if normalizedCode == "DAILY_LIMIT_REACHED" || lowercased.contains("daily preview limit reached") {
            return "You've reached today's preview limit. Try again after the daily reset."
        }

        if normalizedCode == "INSUFFICIENT_CREDITS" || normalizedCode == "NO_ENTITLEMENTS" {
            return "You've used all songs included in your plan. Start a new song after upgrading or when your plan resets."
        }

        if normalizedCode == "E301_ELEVENLABS_VALIDATION" ||
            lowercased.contains("bad_composition_plan") ||
            lowercased.contains("bad_prompt") ||
            lowercased.contains("compose validation failed") {
            return "The music provider rejected this composition request. Edit lyrics/style wording and retry."
        }

        if lowercased.contains("no audio url in response") || lowercased.contains("no audio url") {
            return "Music provider returned an incomplete audio result. Tap Try Again."
        }

        if effectiveCategory == "provider_transient" {
            return "Music service is temporarily rate-limited. Please wait a minute and try again."
        }

        if effectiveCategory == "processing_retryable" {
            return "Song processing hit a temporary issue. Tap Try Again."
        }

        if effectiveCategory == "processing_terminal" {
            return "Song processing failed. Please try creating a new version."
        }

        if effectiveCategory == "input_missing" {
            return "Some audio inputs are missing. Tap Try Again. If it fails again, create a new version."
        }

        if effectiveCategory == "provider_retryable" || effectiveCategory == "infra_retryable" {
            return "Music provider returned an incomplete result. Tap Try Again."
        }

        if effectiveCategory == "provider_terminal" {
            return "Music provider encountered an issue. Tap Try Again."
        }

        if effectiveCategory == "infra_terminal" || effectiveCategory == "unknown_terminal" {
            return "Something went wrong. Tap Try Again or create a new version."
        }

        // Fallback: use server-provided message if available, else generic
        if message.isEmpty {
            return "Render failed. Please try again."
        }

        return message
    }

    static func shouldShowEditLyricsCTA(_ errorMessage: String, detail: RenderErrorDetail) -> Bool {
        let derived = deriveRenderFailureHints(code: detail.code, message: errorMessage)
        let effectiveCategory = detail.category ?? derived.category
        let effectiveAction = detail.suggestedAction ?? derived.suggestedAction
        let effectiveCanRewrite = detail.canAutoRewrite || derived.canAutoRewrite

        if effectiveAction == "rewrite_and_retry" ||
            effectiveCategory == "policy_content" ||
            effectiveCategory == "policy_validation" ||
            effectiveCanRewrite {
            return true
        }

        // If the server sent a category and we haven't returned true yet, it's not a lyrics issue
        if effectiveCategory != nil {
            return false
        }

        if let code = detail.code {
            if code == "E302_SUNO_POLICY_ERROR" ||
                code == "E302_PROVIDER_POLICY_ERROR" ||
                code == "E301_ELEVENLABS_VALIDATION" {
                return true
            }
            if code == "E302_SUNO_ERROR" {
                let lower = errorMessage.lowercased()
                return lower.contains("policy") ||
                    lower.contains("sensitive_word_error") ||
                    lower.contains("specific artists") ||
                    lower.contains("producer tag")
            }
            if code.hasPrefix("provider_error_") || code == "RENDER_FAILED" {
                return false
            }
        }

        if !detail.terms.isEmpty {
            return true
        }
        let lowercased = errorMessage.lowercased()
        return lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("sensitive_word_error") ||
            lowercased.contains("lyrics policy") ||
            lowercased.contains("content policy") ||
            lowercased.contains("blocked word") ||
            lowercased.contains("disallowed") ||
            lowercased.contains("restricted")
    }

    static func renderMessage(for status: JobStatus, isFull: Bool = false) -> String? {
        if status.status == "completed" ||
            status.status == "failed" ||
            status.status == "dead_letter" ||
            status.status == "blocked" {
            return nil
        }
        let step = status.step ?? ""
        if step.contains("instrumental") && status.status == "queued" {
            return "Waiting on the music provider..."
        }
        switch step {
        case "moderation":
            return "Checking content safety..."
        case "lyrics":
            return "Writing lyrics..."
        case "music_plan":
            return "Planning the music..."
        case "instrumental", "instrumental_full":
            return isFull ? "Generating the full instrumental..." : "Generating the instrumental..."
        case "guide_vocal", "guide_vocal_full":
            return isFull ? "Preparing the full guide vocal..." : "Preparing the guide vocal..."
        case "voice_convert", "voice_convert_sections":
            return "Shaping the vocal performance..."
        case "mix":
            return "Mixing vocals and instrumental..."
        case "watermark":
            return "Finalizing your song..."
        case "ready":
            return "Final touches..."
        default:
            return "Processing..."
        }
    }

    // MARK: - Policy Term Analysis

    static func mergedPolicyTerms(_ apiTerms: [String]?, fromMessage message: String?) -> [String] {
        var terms = Set<String>()

        for term in apiTerms ?? [] {
            for variant in normalizedPolicyTermVariants(term) {
                terms.insert(variant)
            }
        }
        for term in extractPolicyTerms(from: message) {
            for variant in normalizedPolicyTermVariants(term) {
                terms.insert(variant)
            }
        }

        return Array(terms).sorted()
    }

    static func renderPolicySuggestions(_ terms: [String]) -> [String] {
        guard !terms.isEmpty else { return [] }

        var suggestions: [String] = [
            "Avoid artist or producer-style references; keep wording personal and occasion-focused."
        ]

        for term in terms.prefix(3) {
            let compact = term.replacingOccurrences(
                of: "[^a-z0-9]",
                with: "",
                options: .regularExpression
            )
            if let expanded = expandCompactNumberWord(compact) {
                suggestions.append("If this is age-related, rewrite \"\(term)\" as \"\(expanded.spaced) years old\".")
            } else if let numericValue = Int(compact), (1...125).contains(numericValue) {
                suggestions.append("If \"\(term)\" is an age, try \"\(numericValue) years old\".")
            } else {
                suggestions.append("Rewrite \"\(term)\" with a neutral phrase (for example, \"special day\").")
            }
        }

        var unique = Set<String>()
        return suggestions.filter { unique.insert($0).inserted }
    }

    // MARK: - Policy Term Internals

    private static func extractPolicyTerms(from message: String?) -> [String] {
        guard let message, !message.isEmpty else { return [] }
        let fullRange = NSRange(message.startIndex..<message.endIndex, in: message)
        let patterns = [
            #"producer tag(?:\s+error)?(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"lyrics contain(?:s)?(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"(?:flagged|blocked|disallowed|restricted|banned|sensitive)\s+(?:word|words|term|terms|phrase|phrases)(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"sensitive[_\s-]?word[_\s-]?error(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#,
            #"(?:specific artists?|artist references?)(?:\s*[:=\-]\s*|\s+)([^.;\n]+)"#
        ]
        var terms = Set<String>()
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                continue
            }
            let matches = regex.matches(in: message, options: [], range: fullRange)
            for match in matches {
                guard match.numberOfRanges > 1,
                      let range = Range(match.range(at: 1), in: message) else {
                    continue
                }
                for term in splitPolicyTermCandidates(String(message[range])) {
                    terms.insert(term)
                }
            }
        }

        if terms.isEmpty {
            let lowercased = message.lowercased()
            let hasPolicyContext = lowercased.contains("policy") ||
                lowercased.contains("producer tag") ||
                lowercased.contains("specific artists") ||
                lowercased.contains("sensitive_word_error") ||
                lowercased.contains("blocked") ||
                lowercased.contains("disallowed")
            if hasPolicyContext,
               let quotedRegex = try? NSRegularExpression(
                pattern: #"["""'`]\s*([^"""'`]{2,64})\s*["""'`]"#,
                options: []
               ) {
                let matches = quotedRegex.matches(in: message, options: [], range: fullRange)
                for match in matches {
                    guard match.numberOfRanges > 1,
                          let range = Range(match.range(at: 1), in: message),
                          let normalized = normalizePolicyTerm(String(message[range])) else {
                        continue
                    }
                    terms.insert(normalized)
                }
            }
        }

        return Array(terms).sorted()
    }

    private static func splitPolicyTermCandidates(_ chunk: String) -> [String] {
        var terms = Set<String>()
        let fullRange = NSRange(chunk.startIndex..<chunk.endIndex, in: chunk)
        if let quotedRegex = try? NSRegularExpression(
            pattern: #"["""'`]\s*([^"""'`]{1,64})\s*["""'`]"#,
            options: []
        ) {
            let matches = quotedRegex.matches(in: chunk, options: [], range: fullRange)
            for match in matches {
                guard match.numberOfRanges > 1,
                      let range = Range(match.range(at: 1), in: chunk),
                      let normalized = normalizePolicyTerm(String(chunk[range])) else {
                    continue
                }
                terms.insert(normalized)
            }
        }

        var cleaned = chunk.replacingOccurrences(
            of: #"[\"""'`\[\]\{\}]"#,
            with: " ",
            options: .regularExpression
        )
        cleaned = cleaned.replacingOccurrences(
            of: #"\s+\band\b\s+"#,
            with: ",",
            options: .regularExpression
        )
        cleaned = cleaned.replacingOccurrences(of: ";", with: ",")
        let parts = cleaned.split(separator: ",")
        for rawPart in parts {
            if let normalized = normalizePolicyTerm(String(rawPart)) {
                terms.insert(normalized)
            }
        }

        return Array(terms)
    }

    private static func normalizePolicyTerm(_ rawTerm: String) -> String? {
        let genericTerms: Set<String> = [
            "artist", "artists", "producer", "producer tag", "policy", "lyrics policy",
            "sensitive word", "sensitive words", "blocked word", "blocked words",
            "restricted word", "restricted words", "disallowed word", "disallowed words",
            "term", "terms", "word", "words", "phrase", "phrases",
            "content", "lyrics", "failed", "error"
        ]

        var term = rawTerm
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        term = term.replacingOccurrences(
            of: #"^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$"#,
            with: "",
            options: .regularExpression
        )
        term = term.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        term = term.replacingOccurrences(
            of: #"^(the\s+)?(word|words|term|terms|phrase|phrases)\s+"#,
            with: "",
            options: .regularExpression
        )
        term = term.replacingOccurrences(
            of: #"\s+(word|words|term|terms|phrase|phrases)$"#,
            with: "",
            options: .regularExpression
        )
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !term.isEmpty, term.count <= 64 else { return nil }

        let compact = term.replacingOccurrences(
            of: "[^a-z0-9]",
            with: "",
            options: .regularExpression
        )
        guard compact.count >= 2, compact.count <= 48 else { return nil }
        guard !genericTerms.contains(term), !genericTerms.contains(compact) else { return nil }
        guard term.range(of: #"[a-z0-9]"#, options: .regularExpression) != nil else { return nil }
        return term
    }

    private static func normalizedPolicyTermVariants(_ rawTerm: String) -> [String] {
        let term = rawTerm
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !term.isEmpty else { return [] }

        var variants = Set([term])
        let spaced = term.replacingOccurrences(of: "-", with: " ")
        let hyphenated = term.replacingOccurrences(of: #"\s+"#, with: "-", options: .regularExpression)
        variants.insert(spaced)
        variants.insert(hyphenated)
        let compact = term.replacingOccurrences(
            of: "[^a-z0-9]",
            with: "",
            options: .regularExpression
        )
        variants.insert(compact)
        if let expanded = expandCompactNumberWord(compact) {
            variants.insert(expanded.compact)
            variants.insert(expanded.spaced)
            variants.insert(expanded.spaced.replacingOccurrences(of: " ", with: "-"))
            variants.insert(expanded.numeric)
        }
        return Array(variants)
    }

    private static func expandCompactNumberWord(_ value: String) -> (compact: String, spaced: String, numeric: String)? {
        let tens: [(String, Int)] = [
            ("twenty", 20),
            ("thirty", 30),
            ("forty", 40),
            ("fifty", 50),
            ("sixty", 60),
            ("seventy", 70),
            ("eighty", 80),
            ("ninety", 90)
        ]
        let ones: [(String, Int)] = [
            ("one", 1),
            ("two", 2),
            ("three", 3),
            ("four", 4),
            ("five", 5),
            ("six", 6),
            ("seven", 7),
            ("eight", 8),
            ("nine", 9)
        ]
        for (tensWord, tensValue) in tens {
            for (onesWord, onesValue) in ones {
                let compact = "\(tensWord)\(onesWord)"
                if value == compact {
                    return (compact, "\(tensWord) \(onesWord)", "\(tensValue + onesValue)")
                }
            }
        }
        return nil
    }
}
