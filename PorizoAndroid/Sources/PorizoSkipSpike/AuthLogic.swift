import Foundation

/// Pure auth decision logic (U4b), extracted from the auth model so the
/// correctness-critical token-rotation and phone-verify branching can be tested
/// on the host. Mirrors iOS AuthManager's refresh classification + phone flow.
enum AuthLogic {

    /// How to react to a refresh-token rejection.
    enum RefreshDisposition: Equatable {
        case hardLogout            // definitive: session is dead, sign the user out
        case recheckCachedToken    // a concurrent refresh already rotated — reuse cached token
        case retryTransient        // network/unknown — safe to retry
    }

    /// Server error codes that mean the session is definitively gone.
    private static let definitiveCodes: Set<String> = [
        "token_reuse_detected", "token_revoked", "token_expired",
        "invalid_token", "invalid_refresh_token", "token_family_compromised",
        "session_revoked", "session_expired",
    ]

    static func classifyRefreshError(code: String?) -> RefreshDisposition {
        let normalized = (code ?? "").lowercased()
        if normalized == "token_already_rotated" { return .recheckCachedToken }
        if definitiveCodes.contains(normalized) { return .hardLogout }
        return .retryTransient
    }

    /// Proactively refresh when under 5 minutes remain before expiry.
    static func shouldProactivelyRefresh(secondsUntilExpiry: Int) -> Bool {
        secondsUntilExpiry < 300
    }

    /// Outcome of a phone code verification.
    enum PhoneVerifyOutcome: Equatable {
        case authenticated(userId: String, accessToken: String, refreshToken: String)
        case needsRegistration(registrationToken: String)
        case rejected(remainingAttempts: Int?)
    }

    /// Resolve a verify response into a next step. Tokens take precedence
    /// (existing user signs in directly); otherwise a registration token means a
    /// new user must complete registration; otherwise it's a rejected code.
    static func phoneVerifyOutcome(_ response: PorizoVerifyPhoneCodeResponse) -> PhoneVerifyOutcome {
        if let userId = response.userId,
           let access = response.accessToken,
           let refresh = response.refreshToken {
            return .authenticated(userId: userId, accessToken: access, refreshToken: refresh)
        }
        if let regToken = response.registrationToken {
            return .needsRegistration(registrationToken: regToken)
        }
        return .rejected(remainingAttempts: response.remainingAttempts)
    }
}
