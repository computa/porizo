package com.porizo.core.domain.claim

import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo
import kotlin.test.Test
import kotlin.test.assertEquals

class PoemClaimLogicTest {
    @Test
    fun poemShareStateMapping() {
        assertEquals(ClaimLogic.State.Claimable(false), PoemClaimLogic.stateFor(info("unbound")))
        assertEquals(ClaimLogic.State.Claimable(true), PoemClaimLogic.stateFor(info("unbound", pin = true)))
        assertEquals(ClaimLogic.State.Claimable(false), PoemClaimLogic.stateFor(info("active")))
        assertEquals(ClaimLogic.State.Claimable(true), PoemClaimLogic.stateFor(info("active", pin = true)))
        assertEquals(ClaimLogic.State.Claimed, PoemClaimLogic.stateFor(info("claimed")))
        assertEquals(ClaimLogic.State.Unavailable, PoemClaimLogic.stateFor(info("revoked")))
    }

    @Test
    fun versesPreferFullBodyThenPreviewLines() {
        assertEquals(listOf("Line one", "Line two"), PoemClaimLogic.verses(info("unbound", verses = listOf("Line one", "Line two"))))
        assertEquals(
            listOf("Peek one"),
            PoemClaimLogic.verses(
                PoemShareInfo(
                    status = "unbound",
                    canAccess = true,
                    poem = PoemBody(id = "p", title = "T", recipientName = "R", verses = null, previewLines = listOf("Peek one")),
                    requiresPin = null,
                    requiresPinForClaim = null,
                ),
            ),
        )
        assertEquals(listOf("A", "B"), PoemClaimLogic.verses(PoemBody("p", "T", "R", listOf("A", "B"), null)))
    }

    private fun info(
        status: String,
        pin: Boolean? = null,
        verses: List<String>? = null,
    ) = PoemShareInfo(
        status = status,
        canAccess = true,
        poem = PoemBody(id = "p1", title = "For Mom", recipientName = "Mom", verses = verses, previewLines = null),
        requiresPin = pin,
        requiresPinForClaim = pin,
    )
}
