import Foundation

/// Pure render-poll decision logic (U9), ported from iOS `RenderController`.
/// Everything here is input→output with no async, no UI, no network — so the
/// exact-contract items (backoff schedule, terminal-status set, resume-before-
/// start, error taxonomy) are unit-tested on the host. The async poll loop and
/// @Observable phases live in `AndroidRenderModel`, which calls into this.
enum AndroidRenderController {

    // MARK: - Backoff schedule

    /// Exponential backoff intervals: 1s, 2s, 5s, 10s, 30s (max). Mirrors iOS
    /// `RenderPollingConfig.backoffIntervalsNs`.
    static let backoffIntervalsNs: [UInt64] = [
        1_000_000_000,
        2_000_000_000,
        5_000_000_000,
        10_000_000_000,
        30_000_000_000,
    ]

    /// 5-minute preview cap / 6-minute full cap (nanoseconds).
    static let previewMaxDurationNs: UInt64 = 5 * 60 * 1_000_000_000
    static let fullMaxDurationNs: UInt64 = 6 * 60 * 1_000_000_000

    /// 3 consecutive poll failures → fall back to a track fetch before erroring.
    static let maxPollingFailures = 3

    private static let backoffThresholdNs: UInt64 = 10_000_000_000

    /// Which backoff bucket the current elapsed time falls into. Every 10s of
    /// elapsed time advances one step, clamped to the last interval.
    static func backoffIndex(elapsedNs: UInt64) -> Int {
        min(Int(elapsedNs / backoffThresholdNs), backoffIntervalsNs.count - 1)
    }

    // MARK: - Terminal status set

    /// Terminal *failure* statuses (mirrors the iOS `case "failed","dead_letter","blocked"`).
    static func isTerminalFailure(_ status: String) -> Bool {
        status == "failed" || status == "dead_letter" || status == "blocked"
    }

    static func isCompleted(_ status: String) -> Bool { status == "completed" }

    // MARK: - Resume-before-start decision

    /// How a resume check on an existing track version resolves.
    enum ResumeDecision: Equatable {
        case complete(url: String)     // already has a playable URL — done
        case resumePoll(jobId: String) // in-flight job — poll it, don't re-render
        case failed(message: String)   // version already failed — surface friendly error
        case startFresh                // nothing in flight — call render_*
    }

    /// Decide what to do given a track version, without issuing a new render.
    /// Covers C12 (resume before start). For a full render we prefer the full
    /// URL/job; for a preview we prefer the preview URL/job.
    static func resumeDecision(version: PorizoTrackVersion, isFull: Bool) -> ResumeDecision {
        if version.status == "failed" {
            let message = userFacingMessage(
                code: version.lastErrorCode,
                message: version.lastErrorMessage,
                terms: []
            )
            return .failed(message: message)
        }

        let url = isFull ? (version.fullUrl ?? version.previewUrl)
                         : (version.previewUrl ?? version.fullUrl)
        if let url { return .complete(url: url) }

        let jobId = isFull ? (version.fullJobId ?? version.previewJobId)
                           : (version.previewJobId ?? version.fullJobId)
        if let jobId { return .resumePoll(jobId: jobId) }

        return .startFresh
    }

    // MARK: - Error taxonomy

    /// Category the error maps to; drives message + CTA. Trimmed to what the
    /// Android create flow surfaces (AI voice only — no persona-consent branches).
    enum Category: Equatable {
        case policyContent      // lyrics rejected — Edit Lyrics CTA
        case entitlementLimit   // out of credits — paywall CTA
        case dailyLimit         // preview cap hit today
        case processingRetryable
        case processingTerminal
        case infraRetryable
        case infraTerminal
    }

    static func classify(code: String?, message: String?) -> Category {
        let normalizedCode = (code ?? "").uppercased()
        let lowercased = (message ?? "").lowercased()

        if normalizedCode == "E302_PROVIDER_POLICY_ERROR" ||
            normalizedCode == "E302_SUNO_POLICY_ERROR" ||
            normalizedCode == "E301_ELEVENLABS_VALIDATION" ||
            lowercased.contains("content policy") ||
            lowercased.contains("lyrics policy") ||
            lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("bad_composition_plan") ||
            lowercased.contains("compose validation failed") {
            return .policyContent
        }

        if normalizedCode == "INSUFFICIENT_CREDITS" || normalizedCode == "NO_ENTITLEMENTS" {
            return .entitlementLimit
        }

        if normalizedCode == "DAILY_LIMIT_REACHED" || lowercased.contains("daily preview limit reached") {
            return .dailyLimit
        }

        if normalizedCode == "PROVIDER_ERROR_429" || lowercased.contains("rate limit") ||
            normalizedCode == "E301_FFMPEG_TIMEOUT" ||
            normalizedCode == "E302_SUNO_INCOMPLETE_OUTPUT" ||
            lowercased.contains("no audio url in response") {
            return .infraRetryable
        }

        if normalizedCode == "E201_LYRICS_ERROR" {
            return lowercased.contains("ai_unavailable") ? .processingRetryable : .processingTerminal
        }

        if normalizedCode == "E302_WORKFLOW_ERROR" || normalizedCode == "E301_FFMPEG_ERROR" {
            return .processingTerminal
        }

        if lowercased.contains("timeout") || lowercased.contains("network") {
            return .infraRetryable
        }

        return .infraTerminal
    }

    /// Whether the failure warrants an out-of-credits paywall CTA.
    static func isPaywallError(code: String?) -> Bool {
        let normalized = (code ?? "").uppercased()
        return normalized == "INSUFFICIENT_CREDITS" || normalized == "NO_ENTITLEMENTS"
    }

    /// Whether the failure warrants an "Edit Lyrics" CTA (policy rejection).
    static func shouldShowEditLyricsCTA(code: String?, message: String?, terms: [String]) -> Bool {
        if classify(code: code, message: message) == .policyContent { return true }
        if !terms.isEmpty { return true }
        let lowercased = (message ?? "").lowercased()
        return lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("sensitive_word_error") ||
            lowercased.contains("blocked word")
    }

    /// Friendly, user-facing message for a render failure. Falls back to the
    /// server message when nothing in the taxonomy matches.
    static func userFacingMessage(code: String?, message: String?, terms: [String]) -> String {
        let trimmed = (message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        switch classify(code: code, message: message) {
        case .policyContent:
            if !terms.isEmpty {
                return "We found lyrics content the music provider rejected. Tap Edit Lyrics to revise the flagged lines, then try again."
            }
            return "The music provider rejected part of these lyrics. Tap Edit Lyrics to revise wording, then try again."
        case .entitlementLimit:
            return "You've used all songs included in your plan. Start a new song after upgrading or when your plan resets."
        case .dailyLimit:
            return "You've reached today's preview limit. Try again after the daily reset."
        case .infraRetryable, .processingRetryable:
            return "Song processing hit a temporary issue. Tap Try Again."
        case .processingTerminal:
            return "Song processing failed. Please try creating a new version."
        case .infraTerminal:
            return trimmed.isEmpty ? "Something went wrong. Tap Try Again or create a new version." : trimmed
        }
    }

    // MARK: - Step → status message

    /// Human-readable status line for a non-terminal poll step. Nil for terminal
    /// statuses (the phase message takes over). Mirrors iOS `renderMessage(for:)`.
    static func stepMessage(status: String, step: String?) -> String? {
        if isCompleted(status) || isTerminalFailure(status) { return nil }
        let step = step ?? ""
        if step.contains("instrumental") && status == "queued" {
            return "Waiting on the music provider…"
        }
        switch step {
        case "moderation": return "Checking content safety…"
        case "lyrics": return "Writing lyrics…"
        case "music_plan": return "Planning the music…"
        case "instrumental", "instrumental_full": return "Generating the instrumental…"
        case "guide_vocal", "guide_vocal_full": return "Preparing the guide vocal…"
        case "voice_convert", "voice_convert_sections": return "Shaping the vocal performance…"
        case "mix": return "Mixing vocals and instrumental…"
        case "watermark": return "Finalizing your song…"
        case "ready": return "Final touches…"
        default: return "Processing…"
        }
    }
}
