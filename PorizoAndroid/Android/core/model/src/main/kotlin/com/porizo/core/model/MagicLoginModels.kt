package com.porizo.core.model

data class MagicLoginRequest(val transactionId: String, val requestSecret: String, val expiresAt: String)

data class PendingMagicLogin(
    val transactionId: String,
    val email: String,
    val expiresAt: String,
    val resendAvailableAtEpochSeconds: Long,
)

enum class MagicLoginTransactionStatus {
    Pending,
    Approved,
    Expired,
    Locked,
    Consumed,
    Conflict,
}

data class MagicLoginStatus(
    val status: MagicLoginTransactionStatus,
    val expiresAt: String,
)

data class MagicLoginSession(
    val userId: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Int,
)
