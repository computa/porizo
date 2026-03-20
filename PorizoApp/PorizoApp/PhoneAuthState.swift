import Foundation

enum PhoneAuthState: Sendable, Equatable {
    case idle
    case phoneEntry
    case phoneVerification(phoneNumber: String)
    case usernameSelection(registrationToken: String, phoneNumber: String)
}
