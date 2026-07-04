package com.porizo.core.domain.auth

import com.porizo.core.model.VerifyPhoneCodeResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class AuthLogicTest {
    @Test
    fun definitiveCodesForceHardLogout() {
        val definitive = listOf(
            "TOKEN_REUSE_DETECTED",
            "TOKEN_REVOKED",
            "TOKEN_EXPIRED",
            "INVALID_TOKEN",
            "INVALID_REFRESH_TOKEN",
            "TOKEN_FAMILY_COMPROMISED",
            "SESSION_REVOKED",
            "SESSION_EXPIRED",
        )

        definitive.forEach { code ->
            assertEquals(AuthLogic.RefreshDisposition.HardLogout, AuthLogic.classifyRefreshError(code))
        }
    }

    @Test
    fun alreadyRotatedIsRecheck() {
        assertEquals(
            AuthLogic.RefreshDisposition.RecheckCachedToken,
            AuthLogic.classifyRefreshError("TOKEN_ALREADY_ROTATED"),
        )
    }

    @Test
    fun unknownOrNetworkCodeIsTransient() {
        assertEquals(AuthLogic.RefreshDisposition.RetryTransient, AuthLogic.classifyRefreshError("SOMETHING_ELSE"))
        assertEquals(AuthLogic.RefreshDisposition.RetryTransient, AuthLogic.classifyRefreshError(null))
        assertEquals(AuthLogic.RefreshDisposition.RetryTransient, AuthLogic.classifyRefreshError(""))
    }

    @Test
    fun classifierIsCaseInsensitive() {
        assertEquals(AuthLogic.RefreshDisposition.HardLogout, AuthLogic.classifyRefreshError("token_revoked"))
        assertEquals(AuthLogic.RefreshDisposition.RecheckCachedToken, AuthLogic.classifyRefreshError("Token_Already_Rotated"))
    }

    @Test
    fun proactiveRefreshThreshold() {
        assertTrue(AuthLogic.shouldProactivelyRefresh(120))
        assertTrue(AuthLogic.shouldProactivelyRefresh(299))
        assertTrue(AuthLogic.shouldProactivelyRefresh(0))
        assertTrue(AuthLogic.shouldProactivelyRefresh(-10))
        assertFalse(AuthLogic.shouldProactivelyRefresh(301))
        assertFalse(AuthLogic.shouldProactivelyRefresh(3600))
    }

    @Test
    fun verifyWithTokensAuthenticatesDirectly() {
        val outcome = AuthLogic.phoneVerifyOutcome(verify(tokens = true))
        assertEquals(AuthLogic.PhoneVerifyOutcome.Authenticated("u1", "acc", "ref"), outcome)
    }

    @Test
    fun verifyNewUserNeedsRegistration() {
        val outcome = AuthLogic.phoneVerifyOutcome(verify(registration = true))
        assertEquals(AuthLogic.PhoneVerifyOutcome.NeedsRegistration("reg_tok"), outcome)
    }

    @Test
    fun verifyNotVerifiedIsRejected() {
        val outcome = AuthLogic.phoneVerifyOutcome(
            VerifyPhoneCodeResult(
                success = true,
                verified = false,
                registrationToken = null,
                remainingAttempts = 2,
                accessToken = null,
                refreshToken = null,
                userId = null,
                isNewUser = null,
                existingUser = null,
            ),
        )
        assertEquals(AuthLogic.PhoneVerifyOutcome.Rejected(2), outcome)
    }

    @Test
    fun verifyTokensTakePrecedenceOverRegistration() {
        val outcome = AuthLogic.phoneVerifyOutcome(verify(tokens = true, registration = true))
        assertIs<AuthLogic.PhoneVerifyOutcome.Authenticated>(outcome)
    }

    private fun verify(
        tokens: Boolean = false,
        registration: Boolean = false,
    ) = VerifyPhoneCodeResult(
        success = true,
        verified = true,
        registrationToken = if (registration) "reg_tok" else null,
        remainingAttempts = null,
        accessToken = if (tokens) "acc" else null,
        refreshToken = if (tokens) "ref" else null,
        userId = if (tokens) "u1" else null,
        isNewUser = if (registration) true else null,
        existingUser = null,
    )
}
