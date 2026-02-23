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

/// Response from POST /auth/phone/register
struct PhoneRegisterResponse: Codable, Sendable {
    let success: Bool
    let userId: String
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case success
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

// MARK: - Username

/// Response from GET /users/username/available
struct UsernameAvailabilityResponse: Codable, Sendable {
    let available: Bool
    let suggestions: [String]?
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
