//
//  APIClient+Onboarding.swift
//  PorizoApp
//
//  Onboarding V2 API methods: suggestion generation.
//

import Foundation

extension APIClient {

    /// Request a personalized onboarding suggestion from the server.
    /// Falls back to local template on timeout or error (handled by caller).
    func requestOnboardingSuggestion(_ request: OnboardingSuggestionRequest) async throws -> OnboardingSuggestionResponse {
        let url = URL(string: "\(baseURL)/onboarding/suggest")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&urlRequest)
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, _) = try await executeWithAuthRetry(request: urlRequest)

        do {
            return try Self.jsonDecoder.decode(OnboardingSuggestionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("OnboardingSuggestionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }
}
