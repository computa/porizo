//
//  APIClient+Profile.swift
//  PorizoApp
//
//  Profile update API methods.
//

import Foundation

extension APIClient {

    struct UpdateProfileRequest: Encodable {
        let expectedUserId: String
        let contactEmail: String?
        let displayName: String?

        enum CodingKeys: String, CodingKey {
            case expectedUserId = "expected_user_id"
            case contactEmail = "contact_email"
            case displayName = "display_name"
        }
    }

    /// Update the current user's profile (email, display name)
    /// Phone number changes must go through /auth/phone/link (verified flow)
    func updateProfile(
        expectedUserId: String,
        contactEmail: String? = nil,
        displayName: String? = nil
    ) async throws -> AuthUser {
        let url = URL(string: "\(baseURL)/auth/profile")!
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body = UpdateProfileRequest(
            expectedUserId: expectedUserId,
            contactEmail: contactEmail,
            displayName: displayName
        )
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await executeWithAuthRetry(request: request)
        return try Self.jsonDecoder.decode(AuthUser.self, from: data)
    }
}
