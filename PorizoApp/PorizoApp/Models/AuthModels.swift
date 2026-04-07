//
//  AuthModels.swift
//  PorizoApp
//
//  Authentication API response types matching the Node.js backend.
//  All types conform to Sendable for Swift 6 actor isolation.
//

import Foundation

// MARK: - Auth Response Models

/// Response from auth endpoints (signup/login)
struct AuthResponse: Codable {
    let userId: String
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let isNewUser: Bool?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case isNewUser = "is_new_user"
    }
}

/// Response from refresh endpoint
struct RefreshResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

// MARK: - Phone Auth Models

/// Response from POST /auth/phone/send-code
struct SendPhoneCodeResponse: Codable, Sendable {
    let success: Bool
    let expiresAt: String?
    let maskedPhone: String?

    enum CodingKeys: String, CodingKey {
        case success
        case expiresAt = "expires_at"
        case maskedPhone = "masked_phone"
    }
}

/// Response from POST /auth/phone/verify
struct VerifyPhoneCodeResponse: Codable, Sendable {
    let success: Bool
    let verified: Bool
    let registrationToken: String?
    let remainingAttempts: Int?
    let accessToken: String?
    let refreshToken: String?
    let userId: String?
    let isNewUser: Bool?

    enum CodingKeys: String, CodingKey {
        case success, verified
        case registrationToken = "registration_token"
        case remainingAttempts = "remaining_attempts"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case userId = "user_id"
        case isNewUser = "is_new_user"
    }
}

/// Response from POST /auth/social when email auto-link requires confirmation
struct LinkConfirmationResponse: Codable, Sendable {
    let requiresLinkConfirmation: Bool?
    let existingAccountEmail: String?
    let provider: String?

    enum CodingKeys: String, CodingKey {
        case requiresLinkConfirmation = "requires_link_confirmation"
        case existingAccountEmail = "existing_account_email"
        case provider
    }
}

/// Response from POST /auth/phone/register when a cross-identifier match is found
struct AccountExistsResponse: Codable, Sendable {
    let accountExists: Bool
    let authMethods: [String]
    let maskedEmail: String?
    let maskedPhone: String?

    enum CodingKeys: String, CodingKey {
        case accountExists = "account_exists"
        case authMethods = "auth_methods"
        case maskedEmail = "masked_email"
        case maskedPhone = "masked_phone"
    }
}

// MARK: - Device Registration

/// Response from POST /device/register
struct DeviceRegistrationResponse: Codable, Sendable {
    let deviceToken: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case deviceToken = "device_token"
        case expiresAt = "expires_at"
    }
}
