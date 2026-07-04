package com.porizo.core.platform

import com.porizo.core.domain.platform.DeviceTrustGateway
import com.porizo.core.domain.platform.DeviceTrustSnapshot
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceTrustProvider @Inject constructor() : DeviceTrustGateway {
    override fun snapshot(nonce: String?): DeviceTrustSnapshot =
        DeviceTrustSnapshot(
            appSetId = null,
            integrityToken = null,
            status = if (nonce.isNullOrBlank()) {
                "Device trust provider is in debug no-op mode."
            } else {
                "Device trust provider seam is ready; Play Integrity backend verification is not provisioned."
            },
        )
}
