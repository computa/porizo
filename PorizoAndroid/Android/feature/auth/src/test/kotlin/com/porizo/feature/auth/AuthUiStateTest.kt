package com.porizo.feature.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AuthUiStateTest {
    @Test
    fun googleSignInConfigurationDefaultsToUnavailable() {
        assertFalse(AuthUiState().isGoogleSignInConfigured)
        assertEquals(GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE, AuthUiState().googleSignInUnavailableMessage)
    }

    @Test
    fun googleSignInConfigurationCanBeMadeAvailable() {
        val state = AuthUiState(isGoogleSignInConfigured = true)

        assertTrue(state.isGoogleSignInConfigured)
        assertEquals(null, state.googleSignInUnavailableMessage)
    }

    @Test
    fun phoneSendRequiresNormalizedE164Number() {
        assertFalse(AuthUiState(phoneNumber = "555").canSendPhoneCode)
        assertTrue(
            AuthUiState(
                phoneNumber = "(555) 123-4567",
                normalizedPhoneNumber = "+15551234567",
            ).canSendPhoneCode,
        )
    }

    @Test
    fun phoneNumberFormattingNormalizesUsAndExplicitInternationalNumbers() {
        assertEquals("+15551234567", PhoneNumberFormatting.normalizedE164PhoneNumber("(555) 123-4567"))
        assertEquals("+61412345678", PhoneNumberFormatting.normalizedE164PhoneNumber("+61 412 345 678"))
    }
}
