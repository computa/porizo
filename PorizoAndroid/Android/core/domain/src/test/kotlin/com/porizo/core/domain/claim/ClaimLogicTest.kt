package com.porizo.core.domain.claim

import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.ShareInfo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ClaimLogicTest {
    @Test
    fun unboundIsClaimable() {
        assertEquals(ClaimLogic.State.Claimable(needsPin = false), ClaimLogic.stateFor(info("unbound")))
    }

    @Test
    fun unboundWithPinRequiresPin() {
        assertEquals(
            ClaimLogic.State.Claimable(needsPin = true),
            ClaimLogic.stateFor(info(status = "unbound", pinRequired = true)),
        )
    }

    @Test
    fun claimedIsAlreadyClaimed() {
        assertEquals(ClaimLogic.State.Claimed, ClaimLogic.stateFor(info("claimed")))
    }

    @Test
    fun revokedAndDemoAreUnavailable() {
        assertEquals(ClaimLogic.State.Unavailable, ClaimLogic.stateFor(info("revoked")))
        assertEquals(ClaimLogic.State.Unavailable, ClaimLogic.stateFor(info("demo")))
    }

    @Test
    fun previewPrefersWebStreamUrl() {
        assertEquals("https://cdn/x.m4a", ClaimLogic.previewUrl(info("unbound", webStreamUrl = "https://cdn/x.m4a")))
    }

    @Test
    fun previewNilWhenNoWebStream() {
        assertNull(ClaimLogic.previewUrl(info("unbound")))
    }

    @Test
    fun deviceTokenRetryOnlyForSpecific401Codes() {
        assertTrue(
            ClaimLogic.shouldReregisterAndRetry(
                PorizoFailure.Server(status = 401, code = "INVALID_DEVICE_TOKEN", message = "bad"),
            ),
        )
        assertTrue(
            ClaimLogic.shouldReregisterAndRetry(
                PorizoFailure.Server(status = 401, code = "SIGN_IN_REQUIRED", message = "x"),
            ),
        )
        assertFalse(
            ClaimLogic.shouldReregisterAndRetry(
                PorizoFailure.Server(status = 401, code = "PIN_INVALID", message = "wrong pin"),
            ),
        )
        assertFalse(
            ClaimLogic.shouldReregisterAndRetry(
                PorizoFailure.Server(status = 409, code = "INVALID_DEVICE_TOKEN", message = "x"),
            ),
        )
        assertFalse(ClaimLogic.shouldReregisterAndRetry(PorizoFailure.NotAuthenticated))
    }

    private fun info(
        status: String,
        pinRequired: Boolean? = null,
        webStreamUrl: String? = null,
    ) = ShareInfo(
        status = status,
        appOnly = null,
        canAccess = null,
        appRequired = null,
        claimRequiresApp = null,
        pinRequiredForClaim = pinRequired,
        receiverSaveRequiresSession = null,
        track = null,
        trackPreview = null,
        webStreamUrl = webStreamUrl,
        appDownloadUrl = null,
        isDemo = null,
    )
}
