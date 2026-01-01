//
//  APIClient.swift
//  PorizoApp
//
//  HTTP client for communicating with the Porizo backend.
//  Handles enrollment, upload, and profile management.
//

import Foundation

/// API client for Porizo backend
actor APIClient {

    // MARK: - Configuration

    /// Base URL for the API - change this to your Mac's local IP for development
    /// Find your IP with: ifconfig | grep "inet " | grep -v 127.0.0.1
    private let baseURL: String

    /// User ID for authentication (generated once, stored in Keychain)
    private let userId: String

    // MARK: - Initialization

    init(baseURL: String = "http://localhost:3000", userId: String? = nil) {
        self.baseURL = baseURL
        self.userId = userId ?? Self.getOrCreateUserId()
    }

    // MARK: - User ID Management

    private static func getOrCreateUserId() -> String {
        let key = "porizo_user_id"

        // Try to get existing ID from UserDefaults (use Keychain in production)
        if let existingId = UserDefaults.standard.string(forKey: key) {
            return existingId
        }

        // Generate new ID
        let newId = "ios_\(UUID().uuidString.lowercased().prefix(12))"
        UserDefaults.standard.set(newId, forKey: key)
        return newId
    }

    func getUserId() -> String {
        return userId
    }

    // MARK: - Enrollment API

    /// Start a new voice enrollment session
    func startEnrollment() async throws -> EnrollmentSession {
        let url = URL(string: "\(baseURL)/voice/enrollment/start")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let body: [String: Any] = [
            "consent_accepted": true,
            "consent_version": "ios_v1"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try JSONDecoder().decode(EnrollmentSession.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("EnrollmentSession: \(error.localizedDescription). Response: \(responseText.prefix(500))")
        }
    }

    /// Upload a recorded audio chunk
    func uploadChunk(sessionId: String, chunkId: String, audioData: Data) async throws -> ChunkUploadResponse {
        let url = URL(string: "\(baseURL)/debug/upload-chunk")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        // Build multipart form data
        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        // Add session_id field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"session_id\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(sessionId)\r\n".data(using: .utf8)!)

        // Add chunk_id field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"chunk_id\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(chunkId)\r\n".data(using: .utf8)!)

        // Add audio file
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(chunkId).wav\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/wav\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try JSONDecoder().decode(ChunkUploadResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ChunkUploadResponse: \(error.localizedDescription). Response: \(responseText.prefix(500))")
        }
    }

    /// Complete the enrollment session and create voice profile
    func completeEnrollment(sessionId: String) async throws -> VoiceProfile {
        let url = URL(string: "\(baseURL)/voice/enrollment/complete")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let body: [String: Any] = ["session_id": sessionId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try JSONDecoder().decode(VoiceProfile.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("VoiceProfile: \(error.localizedDescription). Response: \(responseText.prefix(500))")
        }
    }

    /// Check if user has an existing voice profile
    func getVoiceProfile() async throws -> VoiceProfileStatus {
        let url = URL(string: "\(baseURL)/voice/profile")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(VoiceProfileStatus.self, from: data)
    }

    // MARK: - Response Validation

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            // Try to parse error response
            if let apiError = try? JSONDecoder().decode(APIError.self, from: data) {
                throw APIClientError.serverError(apiError.message)
            }
            // Try to get raw response text for debugging
            let responseText = String(data: data, encoding: .utf8) ?? "No response body"
            throw APIClientError.httpError(statusCode: httpResponse.statusCode, body: responseText)
        }
    }
}

// MARK: - Errors

enum APIClientError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int, body: String)
    case networkError(underlying: Error)
    case serverError(String)
    case decodingError(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode, let body):
            return "Server error (HTTP \(statusCode)): \(body.prefix(200))"
        case .networkError(let underlying):
            return "Network error: \(underlying.localizedDescription)"
        case .serverError(let message):
            return message
        case .decodingError(let details):
            return "Failed to parse response: \(details)"
        }
    }
}
