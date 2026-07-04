package com.porizo.core.domain.share

import com.porizo.core.model.CreateContentType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ShareLogicTest {
    @Test
    fun messageBodyWithName() {
        assertEquals(
            "I made you a song \uD83C\uDFB5 Maya \u2014 open it here: https://porizo.co/s/abc",
            ShareLogic.messageBody("Maya", "https://porizo.co/s/abc", CreateContentType.Song),
        )
    }

    @Test
    fun messageBodyWithoutName() {
        assertEquals(
            "I made you a song \uD83C\uDFB5 \u2014 open it here: https://porizo.co/s/abc",
            ShareLogic.messageBody("  ", "https://porizo.co/s/abc", CreateContentType.Song),
        )
    }

    @Test
    fun messageBodyForPoemHasNoExpiryUrgency() {
        val body = ShareLogic.messageBody("Sam", "L", CreateContentType.Poem)
        assertTrue(body.contains("poem"))
        assertTrue(body.contains("Sam"))

        val lower = ShareLogic.messageBody("Maya", "L", CreateContentType.Song).lowercase()
        assertFalse(lower.contains("expire"))
        assertFalse(lower.contains("days"))
        assertFalse(lower.contains("hurry"))
        assertFalse(lower.contains("soon"))
    }

    @Test
    fun sendChannelUsesSmsOnlyWhenPhonePresent() {
        assertEquals(ShareLogic.SendChannel.Sms("+15551234567"), ShareLogic.sendChannel("+15551234567"))
        assertEquals(ShareLogic.SendChannel.ShareSheet, ShareLogic.sendChannel(null))
        assertEquals(ShareLogic.SendChannel.ShareSheet, ShareLogic.sendChannel("   "))
    }

    @Test
    fun smsUriEncodesBody() {
        val uri = ShareLogic.smsUri("+15551234567", "hi there & you")
        assertTrue(uri.startsWith("smsto:+15551234567?body="))
        assertTrue(uri.contains("%26"))
        assertFalse(uri.contains(" hi there"))
    }
}
