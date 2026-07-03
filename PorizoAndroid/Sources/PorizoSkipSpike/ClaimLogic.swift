import Foundation

/// Pure claim decision logic (U12), ported from iOS ShareController/ShareClaimView.
/// Maps server share state to a UI state, chooses the preview URL, and decides
/// the device-token single-retry-on-401. No UI, no network — unit-tested on host.
enum ClaimLogic {

    /// The claim sheet's high-level state.
    enum State: Equatable {
        case claimable(needsPin: Bool)  // unbound — offer claim (PIN if required)
        case claimed                    // already bound to a device
        case unavailable                // revoked / demo / not claimable
    }

    /// Map a share-info response to a claim state.
    static func state(for info: PorizoShareInfoResponse) -> State {
        switch info.status {
        case "unbound":
            return .claimable(needsPin: info.pinRequiredForClaim ?? false)
        case "claimed":
            return .claimed
        default:
            // revoked, demo, expired, or anything not explicitly claimable.
            return .unavailable
        }
    }

    /// The pre-claim preview URL (web/pre-signed), when the server allows it.
    static func previewURL(from info: PorizoShareInfoResponse) -> String? {
        guard let url = info.webStreamUrl, !url.isEmpty else { return nil }
        return url
    }

    /// Whether a claim failure warrants re-registering the device token and
    /// retrying once — only a 401 with a device-token/sign-in code. Any other
    /// error (wrong PIN, conflict, network) surfaces to the user.
    static func shouldReregisterAndRetry(error: Error) -> Bool {
        guard case let AndroidAPIClientError.server(status, code, _) = error, status == 401 else {
            return false
        }
        let normalized = (code ?? "").uppercased()
        return normalized == "INVALID_DEVICE_TOKEN" || normalized == "SIGN_IN_REQUIRED"
    }
}
