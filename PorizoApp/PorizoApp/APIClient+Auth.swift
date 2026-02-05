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

    /// Complete registration with phone (for new users after verification)
    /// - Parameters:
    ///   - registrationToken: Token from verifyPhoneCode for new users
    ///   - username: Chosen username
    ///   - name: Optional display name
    /// - Returns: PhoneRegisterResponse with auth tokens and user ID
    func registerWithPhone(registrationToken: String, username: String, name: String?) async throws -> PhoneRegisterResponse {
        let url = URL(string: "\(baseURL)/auth/phone/register")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required - registration token provides authentication

        var body: [String: String] = [
            "registration_token": registrationToken,
            "username": username
        ]
        if let name = name {
            body["name"] = name
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(PhoneRegisterResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PhoneRegisterResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Check if username is available
    /// - Parameter username: Username to check
    /// - Returns: UsernameAvailabilityResponse with availability and suggestions
    func checkUsernameAvailability(username: String) async throws -> UsernameAvailabilityResponse {
        var components = URLComponents(string: "\(baseURL)/users/username/available")!
        components.queryItems = [URLQueryItem(name: "username", value: username)]

        guard let url = components.url else {
            throw APIClientError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required - public endpoint

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(UsernameAvailabilityResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("UsernameAvailabilityResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }
}
