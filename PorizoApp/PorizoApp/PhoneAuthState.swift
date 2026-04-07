import Foundation

enum PhoneAuthState: Sendable, Equatable {
    case idle
    case phoneEntry
    case phoneVerification(phoneNumber: String)
    /// New phone — collect name + email before creating account
    case profileEntry(registrationToken: String, phoneNumber: String)
    /// Cross-identifier match — existing account found, user must sign in via existing method to link
    case accountExists(authMethods: [String], maskedEmail: String?, maskedPhone: String?, phoneNumber: String)
}
