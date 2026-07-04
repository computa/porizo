package com.porizo.core.domain.deeplink

import kotlin.test.Test
import kotlin.test.assertEquals

class DeepLinkParserTest {
    private val parser = DeepLinkParser()

    @Test
    fun customSchemeRoutes() {
        assertEquals(DeepLinkRoute.ReceiverHandoff("rh_abc"), parser.parse("porizo://receiver-handoff/rh_abc"))
        assertEquals(DeepLinkRoute.PoemShare("ps_123"), parser.parse("porizo://poem-share/ps_123"))
        assertEquals(DeepLinkRoute.Share("s1"), parser.parse("porizo://share/s1"))
        assertEquals(DeepLinkRoute.Poem("p1"), parser.parse("porizo://poem/p1"))
    }

    @Test
    fun customSchemeUnknownAndMissingId() {
        assertEquals(DeepLinkRoute.Unknown("porizo://mystery/x"), parser.parse("porizo://mystery/x"))
        assertEquals(DeepLinkRoute.Unknown("porizo://poem-share/"), parser.parse("porizo://poem-share/"))
    }

    @Test
    fun appLinkRoutes() {
        assertEquals(DeepLinkRoute.Share("abc"), parser.parse("https://porizo.co/s/abc"))
        assertEquals(DeepLinkRoute.Share("abc"), parser.parse("https://www.porizo.co/play/abc"))
        assertEquals(DeepLinkRoute.Poem("p1"), parser.parse("https://porizo.co/p/p1"))
        assertEquals(DeepLinkRoute.Poem("p1"), parser.parse("https://porizo.co/poem/p1"))
        assertEquals(DeepLinkRoute.PoemShare("ps1"), parser.parse("https://porizo.co/poem-share/ps1"))
        assertEquals(DeepLinkRoute.ReceiverHandoff("rh1"), parser.parse("https://porizo.co/receiver-handoff/rh1"))
    }

    @Test
    fun legacyAppHostRoutesRemainSupported() {
        assertEquals(DeepLinkRoute.Share("abc"), parser.parse("https://porizo.app/play/abc"))
    }

    @Test
    fun oneLinkRoutesParseNestedDeepLinks() {
        assertEquals(
            DeepLinkRoute.Share("abc"),
            parser.parse("https://porizo.onelink.me/app?deep_link_value=https%3A%2F%2Fporizo.co%2Fplay%2Fabc"),
        )
        assertEquals(
            DeepLinkRoute.PoemShare("ps1"),
            parser.parse("https://porizo.onelink.me/app?deep_link_sub1=porizo%3A%2F%2Fpoem-share%2Fps1"),
        )
    }
}
