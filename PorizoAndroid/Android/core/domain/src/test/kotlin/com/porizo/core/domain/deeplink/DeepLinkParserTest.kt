package com.porizo.core.domain.deeplink

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DeepLinkParserTest {
    private val parser = DeepLinkParser()

    @Test
    fun exactAndroidMagicLinkParsesBothLinkValues() {
        assertEquals(
            DeepLinkRoute.AndroidMagicLogin("tx_123", "link-secret"),
            parser.parse("https://auth.porizo.co/auth/magic/android?transaction_id=tx_123#secret=link-secret"),
        )
    }

    @Test
    fun magicLinkRejectsWrongSurfaceAndAmbiguousValues() {
        val rejected = listOf(
            "http://auth.porizo.co/auth/magic/android?transaction_id=tx#secret=s",
            "porizo://auth/magic/android?transaction_id=tx#secret=s",
            "https://auth.porizo.co.evil.test/auth/magic/android?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/android/extra?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx&transaction_id=other#secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx#secret=s&secret=other",
            "https://auth.porizo.co/auth/magic/android?transaction_id=#secret=s",
            "https://auth.porizo.co:443/auth/magic/android?transaction_id=tx#secret=s",
            "https://user@auth.porizo.co/auth/magic/android?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx&extra=x#secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx&secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx#secret=s&extra=x",
        )
        assertTrue(rejected.all { parser.parse(it) is DeepLinkRoute.Unknown })
    }

    @Test
    fun customSchemeMagicResumeCarriesOnlyTransactionId() {
        assertEquals(
            DeepLinkRoute.MagicLoginResume("tx_123"),
            parser.parse("porizo://auth/magic/resume?transaction_id=tx_123"),
        )

        val rejected = listOf(
            "porizo://auth/magic/resume",
            "porizo://auth/magic/resume?transaction_id=tx&request_secret=secret",
            "porizo://auth/magic/resume?transaction_id=tx&link_secret=secret",
            "porizo://auth/magic/resume?transaction_id=tx#secret=secret",
            "porizo://auth/magic/resume?transaction_id=tx&transaction_id=other",
            "porizo://user@auth/magic/resume?transaction_id=tx",
            "porizo://auth:123/magic/resume?transaction_id=tx",
            "porizo://auth/magic/resume/extra?transaction_id=tx",
        )
        assertTrue(rejected.all { parser.parse(it) is DeepLinkRoute.Unknown })
    }

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

    @Test
    fun tripleSlashPathRoutesMatchHostRoutes() {
        assertEquals(DeepLinkRoute.ReceiverHandoff("rh_x"), parser.parse("porizo:///receiver-handoff/rh_x"))
        assertEquals(DeepLinkRoute.PoemShare("ps_x"), parser.parse("porizo:///poem-share/ps_x"))
        assertEquals(DeepLinkRoute.Share("s_x"), parser.parse("porizo:///s/s_x"))
        assertEquals(DeepLinkRoute.Poem("p_x"), parser.parse("porizo:///poem/p_x"))
    }

    @Test
    fun customSchemeQueryParamDeepLinkValueRoutesReceiverHandoff() {
        assertEquals(
            DeepLinkRoute.ReceiverHandoff("rh_789"),
            parser.parse("porizo://open?deep_link_value=rh_789&deep_link_sub1=rs_456&deep_link_sub2=song"),
        )
    }

    @Test
    fun oneLinkBareDeepLinkValueRoutesReceiverHandoff() {
        assertEquals(
            DeepLinkRoute.ReceiverHandoff("rh_x"),
            parser.parse("https://porizo.onelink.me/app?deep_link_value=rh_x"),
        )
    }
}
