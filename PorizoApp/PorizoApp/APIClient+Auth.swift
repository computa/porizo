//
//  APIClient+Auth.swift
//  PorizoApp
//
//  Phone authentication API methods.
//

import Foundation

extension APIClient {

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
}
