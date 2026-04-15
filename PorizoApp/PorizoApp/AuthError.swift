import Foundation

enum AuthError: Error, LocalizedError {
    case requiresLinkConfirmation(provider: String, maskedEmail: String)
    case networkError(String)
    case tokenExpired
    case notAuthenticated
    case serverError(String)
    case keychainSaveFailed
    case phoneVerificationFailed(String)
    case registrationFailed(String)

    var errorDescription: String? {
        switch self {
        case .requiresLinkConfirmation(_, let maskedEmail):
            return "This sign-in matches an existing account (\(maskedEmail)). Confirm to link it."
        case .networkError(let msg):
            return "Network error: \(msg)"
        case .tokenExpired:
            return "Session expired. Please log in again."
        case .notAuthenticated:
            return "Not authenticated"
        case .serverError(let msg):
            return "Server error: \(msg)"
        case .keychainSaveFailed:
            return "Failed to save credentials securely. Please try again."
        case .phoneVerificationFailed(let msg):
            return msg
        case .registrationFailed(let msg):
            return msg
        }
    }
}
