package com.porizo.core.domain.render

import com.porizo.core.model.TrackVersion
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RenderControllerTest {
    @Test
    fun backoffIndexAndIntervalsMatchIosContract() {
        val second = 1_000_000_000L
        assertEquals(0, RenderController.backoffIndex(0))
        assertEquals(0, RenderController.backoffIndex(9 * second))
        assertEquals(1, RenderController.backoffIndex(10 * second))
        assertEquals(2, RenderController.backoffIndex(25 * second))
        assertEquals(3, RenderController.backoffIndex(35 * second))
        assertEquals(4, RenderController.backoffIndex(45 * second))
        assertEquals(4, RenderController.backoffIndex(600 * second))
        assertEquals(listOf(1L, 2L, 5L, 10L, 30L).map { it * second }, RenderController.backoffIntervalsNs)
    }

    @Test
    fun terminalStatuses() {
        assertTrue(RenderController.isTerminalFailure("failed"))
        assertTrue(RenderController.isTerminalFailure("dead_letter"))
        assertTrue(RenderController.isTerminalFailure("blocked"))
        assertFalse(RenderController.isTerminalFailure("completed"))
        assertFalse(RenderController.isTerminalFailure("queued"))
        assertTrue(RenderController.isCompleted("completed"))
        assertFalse(RenderController.isCompleted("processing"))
    }

    @Test
    fun resumeDecisions() {
        assertEquals(
            RenderController.ResumeDecision.Complete("/tracks/x/v1/preview.m4a"),
            RenderController.resumeDecision(version(previewUrl = "/tracks/x/v1/preview.m4a"), isFull = false),
        )
        assertEquals(
            RenderController.ResumeDecision.Complete("/f.m4a"),
            RenderController.resumeDecision(version(previewUrl = "/p.m4a", fullUrl = "/f.m4a"), isFull = true),
        )
        assertEquals(
            RenderController.ResumeDecision.ResumePoll("job-abc"),
            RenderController.resumeDecision(version(previewJobId = "job-abc"), isFull = false),
        )

        val failed = RenderController.resumeDecision(
            version(status = "failed", lastErrorCode = "E302_SUNO_POLICY_ERROR", lastErrorMessage = "content policy"),
            isFull = false,
        )
        assertIs<RenderController.ResumeDecision.Failed>(failed)
        assertTrue(failed.message.lowercase().contains("edit lyrics"))

        assertEquals(RenderController.ResumeDecision.StartFresh, RenderController.resumeDecision(version(), isFull = false))
    }

    @Test
    fun errorTaxonomyAndMessages() {
        val paywall = RenderController.userFacingMessage("INSUFFICIENT_CREDITS", null, emptyList())
        assertTrue(paywall.lowercase().contains("plan"))
        assertFalse(RenderController.shouldShowEditLyricsCta("INSUFFICIENT_CREDITS", null, emptyList()))
        assertTrue(RenderController.isPaywallError("INSUFFICIENT_CREDITS"))
        assertTrue(RenderController.isPaywallError("NO_ENTITLEMENTS"))

        assertTrue(
            RenderController.shouldShowEditLyricsCta("E302_SUNO_POLICY_ERROR", "lyrics policy violation", listOf("kanye")),
        )
        assertTrue(
            RenderController.userFacingMessage("E302_SUNO_POLICY_ERROR", "lyrics policy", listOf("kanye"))
                .lowercase()
                .contains("edit lyrics"),
        )

        assertTrue(RenderController.userFacingMessage("DAILY_LIMIT_REACHED", null, emptyList()).lowercase().contains("daily"))
        assertNotEquals("", RenderController.userFacingMessage(null, "", emptyList()))
        assertEquals(
            "Something oddly specific happened",
            RenderController.userFacingMessage(null, "Something oddly specific happened", emptyList()),
        )
    }

    @Test
    fun stepMessages() {
        assertEquals("Writing lyrics\u2026", RenderController.stepMessage("processing", "lyrics"))
        assertEquals("Mixing vocals and instrumental\u2026", RenderController.stepMessage("processing", "mix"))
        assertNull(RenderController.stepMessage("completed", "ready"))
        assertNull(RenderController.stepMessage("failed", "mix"))
    }

    private fun version(
        status: String = "processing",
        previewUrl: String? = null,
        fullUrl: String? = null,
        previewJobId: String? = null,
        fullJobId: String? = null,
        lastErrorCode: String? = null,
        lastErrorMessage: String? = null,
    ) = TrackVersion(
        id = "v1",
        versionNum = 1,
        status = status,
        previewUrl = previewUrl,
        fullUrl = fullUrl,
        previewJobId = previewJobId,
        fullJobId = fullJobId,
        lastErrorCode = lastErrorCode,
        lastErrorMessage = lastErrorMessage,
    )
}
