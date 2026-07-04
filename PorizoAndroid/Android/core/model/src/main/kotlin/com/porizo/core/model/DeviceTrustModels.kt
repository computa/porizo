package com.porizo.core.model

data class DeviceIntegrityNonce(
    val nonce: String,
    val requestHash: String?,
    val expiresAt: String?,
)

data class DeviceIntegrityVerification(
    val verified: Boolean,
    val nonceValid: Boolean?,
    val status: String?,
    val appSetId: String?,
)
