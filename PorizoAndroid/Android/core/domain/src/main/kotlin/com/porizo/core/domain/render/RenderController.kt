package com.porizo.core.domain.render

import com.porizo.core.model.TrackVersion

object RenderController {
    val backoffIntervalsNs = listOf(
        1_000_000_000L,
        2_000_000_000L,
        5_000_000_000L,
        10_000_000_000L,
        30_000_000_000L,
    )

    const val previewMaxDurationNs: Long = 5 * 60 * 1_000_000_000L
    const val fullMaxDurationNs: Long = 6 * 60 * 1_000_000_000L
    const val maxPollingFailures: Int = 3

    private const val backoffThresholdNs: Long = 10_000_000_000L

    fun backoffIndex(elapsedNs: Long): Int =
        (elapsedNs / backoffThresholdNs)
            .toInt()
            .coerceIn(0, backoffIntervalsNs.lastIndex)

    fun isTerminalFailure(status: String): Boolean =
        status == "failed" || status == "dead_letter" || status == "blocked"

    fun isCompleted(status: String): Boolean = status == "completed"

    sealed interface ResumeDecision {
        data class Complete(val url: String) : ResumeDecision
        data class ResumePoll(val jobId: String) : ResumeDecision
        data class Failed(val message: String) : ResumeDecision
        data object StartFresh : ResumeDecision
    }

    fun resumeDecision(version: TrackVersion, isFull: Boolean): ResumeDecision {
        if (version.status == "failed") {
            return ResumeDecision.Failed(
                userFacingMessage(
                    code = version.lastErrorCode,
                    message = version.lastErrorMessage,
                    terms = emptyList(),
                ),
            )
        }

        val url = if (isFull) {
            version.fullUrl ?: version.previewUrl
        } else {
            version.previewUrl ?: version.fullUrl
        }
        if (url != null) return ResumeDecision.Complete(url)

        val jobId = if (isFull) {
            version.fullJobId ?: version.previewJobId
        } else {
            version.previewJobId ?: version.fullJobId
        }
        if (jobId != null) return ResumeDecision.ResumePoll(jobId)

        return ResumeDecision.StartFresh
    }

    enum class Category {
        PolicyContent,
        EntitlementLimit,
        DailyLimit,
        ProcessingRetryable,
        ProcessingTerminal,
        InfraRetryable,
        InfraTerminal,
    }

    fun classify(code: String?, message: String?): Category {
        val normalizedCode = code.orEmpty().uppercase()
        val lowercased = message.orEmpty().lowercase()

        if (
            normalizedCode == "E302_PROVIDER_POLICY_ERROR" ||
            normalizedCode == "E302_SUNO_POLICY_ERROR" ||
            normalizedCode == "E301_ELEVENLABS_VALIDATION" ||
            lowercased.contains("content policy") ||
            lowercased.contains("lyrics policy") ||
            lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("bad_composition_plan") ||
            lowercased.contains("compose validation failed")
        ) {
            return Category.PolicyContent
        }

        if (normalizedCode == "INSUFFICIENT_CREDITS" || normalizedCode == "NO_ENTITLEMENTS") {
            return Category.EntitlementLimit
        }

        if (normalizedCode == "DAILY_LIMIT_REACHED" || lowercased.contains("daily preview limit reached")) {
            return Category.DailyLimit
        }

        if (
            normalizedCode == "PROVIDER_ERROR_429" ||
            lowercased.contains("rate limit") ||
            normalizedCode == "E301_FFMPEG_TIMEOUT" ||
            normalizedCode == "E302_SUNO_INCOMPLETE_OUTPUT" ||
            lowercased.contains("no audio url in response")
        ) {
            return Category.InfraRetryable
        }

        if (normalizedCode == "E201_LYRICS_ERROR") {
            return if (lowercased.contains("ai_unavailable")) {
                Category.ProcessingRetryable
            } else {
                Category.ProcessingTerminal
            }
        }

        if (normalizedCode == "E302_WORKFLOW_ERROR" || normalizedCode == "E301_FFMPEG_ERROR") {
            return Category.ProcessingTerminal
        }

        if (lowercased.contains("timeout") || lowercased.contains("network")) {
            return Category.InfraRetryable
        }

        return Category.InfraTerminal
    }

    fun isPaywallError(code: String?): Boolean =
        when (code.orEmpty().uppercase()) {
            "INSUFFICIENT_CREDITS", "NO_ENTITLEMENTS" -> true
            else -> false
        }

    fun shouldShowEditLyricsCta(code: String?, message: String?, terms: List<String>): Boolean {
        if (classify(code, message) == Category.PolicyContent) return true
        if (terms.isNotEmpty()) return true
        val lowercased = message.orEmpty().lowercase()
        return lowercased.contains("producer tag") ||
            lowercased.contains("specific artists") ||
            lowercased.contains("sensitive_word_error") ||
            lowercased.contains("blocked word")
    }

    fun userFacingMessage(code: String?, message: String?, terms: List<String>): String {
        val trimmed = message.orEmpty().trim()
        return when (classify(code, message)) {
            Category.PolicyContent -> {
                if (terms.isNotEmpty()) {
                    "We found lyrics content the music provider rejected. Tap Edit Lyrics to revise the flagged lines, then try again."
                } else {
                    "The music provider rejected part of these lyrics. Tap Edit Lyrics to revise wording, then try again."
                }
            }
            Category.EntitlementLimit ->
                "You've used all songs included in your plan. Start a new song after upgrading or when your plan resets."
            Category.DailyLimit ->
                "You've reached today's preview limit. Try again after the daily reset."
            Category.InfraRetryable,
            Category.ProcessingRetryable ->
                "Song processing hit a temporary issue. Tap Try Again."
            Category.ProcessingTerminal ->
                "Song processing failed. Please try creating a new version."
            Category.InfraTerminal ->
                trimmed.ifEmpty { "Something went wrong. Tap Try Again or create a new version." }
        }
    }

    fun stepMessage(status: String, step: String?): String? {
        if (isCompleted(status) || isTerminalFailure(status)) return null
        val safeStep = step.orEmpty()
        if (safeStep.contains("instrumental") && status == "queued") {
            return "Waiting on the music provider\u2026"
        }
        return when (safeStep) {
            "moderation" -> "Checking content safety\u2026"
            "lyrics" -> "Writing lyrics\u2026"
            "music_plan" -> "Planning the music\u2026"
            "instrumental", "instrumental_full" -> "Generating the instrumental\u2026"
            "guide_vocal", "guide_vocal_full" -> "Preparing the guide vocal\u2026"
            "voice_convert", "voice_convert_sections" -> "Shaping the vocal performance\u2026"
            "mix" -> "Mixing vocals and instrumental\u2026"
            "watermark" -> "Finalizing your song\u2026"
            "ready" -> "Final touches\u2026"
            else -> "Processing\u2026"
        }
    }
}
