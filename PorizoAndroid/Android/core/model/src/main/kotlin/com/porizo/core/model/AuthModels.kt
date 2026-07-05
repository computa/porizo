package com.porizo.core.model

data class AuthSession(
    val userId: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Int,
    val issuedAtEpochSeconds: Long = 0,
)

data class PhoneRegisterResult(
    val userId: String?,
    val accessToken: String?,
    val refreshToken: String?,
    val expiresInSeconds: Int?,
    val accountExists: Boolean?,
    val authMethods: List<String>?,
    val maskedEmail: String?,
    val maskedPhone: String?,
)

data class SendPhoneCodeResult(
    val success: Boolean,
    val expiresAt: String?,
    val maskedPhone: String?,
)

data class VerifyPhoneCodeResult(
    val success: Boolean,
    val verified: Boolean,
    val registrationToken: String?,
    val remainingAttempts: Int?,
    val accessToken: String?,
    val refreshToken: String?,
    val userId: String?,
    val isNewUser: Boolean?,
    val existingUser: Boolean?,
)

data class DeviceRegistration(
    val deviceToken: String,
    val expiresAt: String,
)

data class SocialAuthResult(
    val userId: String?,
    val accessToken: String?,
    val refreshToken: String?,
    val expiresInSeconds: Int?,
    val isNewUser: Boolean?,
    val requiresLinkConfirmation: Boolean?,
    val existingAccountEmail: String?,
    val provider: String?,
)

data class SocialAuthChallenge(
    val challengeId: String,
    val nonce: String,
    val expiresAt: String?,
)

data class RefreshTokenResult(
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Int?,
)

data class AuthUser(
    val userId: String,
    val email: String?,
    val displayName: String?,
    val phoneNumber: String?,
    val emailVerified: Boolean?,
    val needsProfileCompletion: Boolean?,
)
