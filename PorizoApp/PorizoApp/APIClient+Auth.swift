//
//  APIClient+Auth.swift
//  PorizoApp
//
//  Phone authentication API methods.
//

import Foundation

enum MagicLoginPurpose: String, Codable, Sendable {
    case login
    case addEmail = "add_email"
}

struct MagicLoginRequestBody: Codable, Equatable, Sendable {
    let email: String
    let platform: String
    let purpose: MagicLoginPurpose
    let requesterKey: String

    enum CodingKeys: String, CodingKey {
        case email, platform, purpose
        case requesterKey = "requester_key"
    }
}

struct MagicLoginExchangeBody: Codable, Equatable, Sendable {
    let transactionId: String
    let platform: String
    let linkSecret: String
    let requestSecret: String

    enum CodingKeys: String, CodingKey {
        case transactionId = "transaction_id"
        case platform
        case linkSecret = "link_secret"
        case requestSecret = "request_secret"
    }
}

struct MagicLoginNativeProofBody: Codable, Equatable, Sendable {
    let transactionId: String
    let platform: String
    let requestSecret: String

    enum CodingKeys: String, CodingKey {
        case transactionId = "transaction_id"
        case platform
        case requestSecret = "request_secret"
    }
}

enum MagicLoginNativeStatus: String, Codable, Sendable {
    case pending
    case approved
    case expired
    case locked
    case consumed
    case conflict
}

struct MagicLoginNativeStatusResponse: Codable, Equatable, Sendable {
    let status: MagicLoginNativeStatus
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case status
        case expiresAt = "expires_at"
    }
}

struct MagicLoginRequestResponse: Codable, Sendable {
    let transactionId: String
    let requestSecret: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case transactionId = "transaction_id"
        case requestSecret = "request_secret"
        case expiresAt = "expires_at"
    }
}

struct MagicLoginExchangeResponse: Codable, Sendable {
    let accessToken: String?
    let refreshToken: String?
    let userId: String
    let expiresIn: Int?
    let contactVerified: Bool?
    let isNewUser: Bool?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case userId = "user_id"
        case expiresIn = "expires_in"
        case contactVerified = "contact_verified"
        case isNewUser = "is_new_user"
    }
}

protocol MagicLoginAPI: Sendable {
    func requestMagicLogin(
        email: String,
        purpose: MagicLoginPurpose,
        requesterKey: String,
        bearerToken: String?
    ) async throws -> MagicLoginRequestResponse

    func exchangeMagicLogin(
        transactionId: String,
        linkSecret: String,
        requestSecret: String
    ) async throws -> MagicLoginExchangeResponse

    func magicLoginNativeStatus(
        transactionId: String,
        requestSecret: String
    ) async throws -> MagicLoginNativeStatusResponse

    func completeApprovedMagicLogin(
        transactionId: String,
        requestSecret: String
    ) async throws -> MagicLoginExchangeResponse
}

extension APIClient: MagicLoginAPI {}

extension APIClient {

    // MARK: - Platform-bound Magic Login

    func requestMagicLogin(
        email: String,
        purpose: MagicLoginPurpose,
        requesterKey: String,
        bearerToken: String? = nil
    ) async throws -> MagicLoginRequestResponse {
        let path = purpose == .addEmail
            ? "/auth/magic/add-email/request"
            : "/auth/magic/request"
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONEncoder().encode(MagicLoginRequestBody(
            email: email,
            platform: "ios",
            purpose: purpose,
            requesterKey: requesterKey
        ))

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        return try Self.jsonDecoder.decode(MagicLoginRequestResponse.self, from: data)
    }

    func exchangeMagicLogin(
        transactionId: String,
        linkSecret: String,
        requestSecret: String
    ) async throws -> MagicLoginExchangeResponse {
        let url = URL(string: "\(baseURL)/auth/magic/exchange")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(MagicLoginExchangeBody(
            transactionId: transactionId,
            platform: "ios",
            linkSecret: linkSecret,
            requestSecret: requestSecret
        ))

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        return try Self.jsonDecoder.decode(MagicLoginExchangeResponse.self, from: data)
    }

    func magicLoginNativeStatus(
        transactionId: String,
        requestSecret: String
    ) async throws -> MagicLoginNativeStatusResponse {
        let url = URL(string: "\(baseURL)/auth/magic/native/status")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(MagicLoginNativeProofBody(
            transactionId: transactionId,
            platform: "ios",
            requestSecret: requestSecret
        ))

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        return try Self.jsonDecoder.decode(MagicLoginNativeStatusResponse.self, from: data)
    }

    func completeApprovedMagicLogin(
        transactionId: String,
        requestSecret: String
    ) async throws -> MagicLoginExchangeResponse {
        let url = URL(string: "\(baseURL)/auth/magic/native/complete")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        request.httpBody = try JSONEncoder().encode(MagicLoginNativeProofBody(
            transactionId: transactionId,
            platform: "ios",
            requestSecret: requestSecret
        ))

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        return try Self.jsonDecoder.decode(MagicLoginExchangeResponse.self, from: data)
    }

    // MARK: - Phone Auth

    /// Send verification code to phone number
    /// - Parameter phoneNumber: Phone number in E.164 format (e.g., +1234567890)
    /// - Returns: SendPhoneCodeResponse with expiration and masked phone
    func sendPhoneVerificationCode(phoneNumber: String) async throws -> SendPhoneCodeResponse {
        let url = URL(string: "\(baseURL)/auth/phone/send-code")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required for sending verification code

        let body: [String: String] = ["phone_number": phoneNumber]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(SendPhoneCodeResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SendPhoneCodeResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Verify phone code - returns registration token for new users or logs in existing users
    /// - Parameters:
    ///   - phoneNumber: Phone number in E.164 format
    ///   - code: 6-digit verification code
    /// - Returns: VerifyPhoneCodeResponse with tokens for existing users or registration token for new users
    func verifyPhoneCode(phoneNumber: String, code: String) async throws -> VerifyPhoneCodeResponse {
        let url = URL(string: "\(baseURL)/auth/phone/verify")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required for verification

        let body: [String: String] = [
            "phone_number": phoneNumber,
            "code": code
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(VerifyPhoneCodeResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("VerifyPhoneCodeResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Register a new phone account (no username required)
    /// - Parameters:
    ///   - registrationToken: Token from verifyPhoneCode for new users
    ///   - phoneNumber: Phone number in E.164 format
    /// - Returns: AuthResponse with tokens and user ID
    func registerPhoneAccount(registrationToken: String, phoneNumber: String) async throws -> AuthResponse {
        let url = URL(string: "\(baseURL)/auth/phone/register")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")

        let body: [String: String] = [
            "registration_token": registrationToken,
            "phone_number": phoneNumber,
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
        return try Self.jsonDecoder.decode(AuthResponse.self, from: data)
    }


    // MARK: - Phone Linking (Authenticated)

    /// Link a verified phone number to the current authenticated account
    /// - Parameters:
    ///   - phoneNumber: Phone number in E.164 format
    ///   - code: 6-digit verification code
    /// - Returns: Updated user profile
    func linkPhone(phoneNumber: String, code: String) async throws -> AuthUser {
        var request = try await makeRequest(
            url: URL(string: "\(baseURL)/auth/phone/link")!,
            method: "POST",
            requiresAuth: true
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = [
            "phone_number": phoneNumber,
            "code": code,
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        return try Self.jsonDecoder.decode(AuthUser.self, from: data)
    }

    // MARK: - Apple Identity Linking (Authenticated)

    /// Link an Apple identity to the current authenticated account
    /// - Parameters:
    ///   - idToken: Apple identity token from ASAuthorizationAppleIDCredential
    ///   - nonce: Raw nonce used for the Apple Sign-In request
    ///   - authorizationCode: Apple authorization code
    ///   - providerUserId: Apple's stable user identifier
    /// - Returns: Updated user profile
    func linkAppleIdentity(
        idToken: String,
        nonce: String,
        authorizationCode: String,
        providerUserId: String
    ) async throws -> AuthUser {
        var request = try await makeRequest(
            url: URL(string: "\(baseURL)/auth/identity/link/apple")!,
            method: "POST",
            requiresAuth: true
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = [
            "id_token": idToken,
            "nonce": nonce,
            "authorization_code": authorizationCode,
            "provider_user_id": providerUserId,
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await executeWithAuthRetry(request: request)
        return try decodeResponse(AuthUser.self, from: data)
    }

    /// Skip profile completion for now
    func skipProfileCompletion() async throws {
        var request = try await makeRequest(
            url: URL(string: "\(baseURL)/auth/profile/skip-completion")!,
            method: "POST",
            requiresAuth: true
        )
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (_, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: Data())
    }

    // MARK: - Email Verification

    /// Resend verification email to the user's current email address
    func resendEmailVerification() async throws {
        let request = try await makeRequest(
            url: URL(string: "\(baseURL)/auth/email/resend-verification")!,
            method: "POST",
            requiresAuth: true
        )

        let (_, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: Data())
    }

    /// Verify email using a deep link token.
    /// Server returns `{ message }` on success — caller should re-fetch profile.
    func verifyEmailToken(_ token: String) async throws {
        let url = URL(string: "\(baseURL)/auth/verify-email")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        let body = ["token": token]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)
    }
}
