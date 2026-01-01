//
//  APIClient.swift
//  PorizoApp
//
//  HTTP client for communicating with the Porizo backend.
//  Handles enrollment, upload, and profile management.
//

import Foundation
import Security

// MARK: - Keychain Helper

/// Secure storage for user credentials using iOS Keychain
enum KeychainHelper {
    private static let service = "com.porizo.app"

    /// Save data to Keychain
    static func save(key: String, data: Data) -> Bool {
        // Delete existing item first
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Load data from Keychain
    static func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess {
            return result as? Data
        }
        return nil
    }

    /// Delete item from Keychain
    @discardableResult
    static func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Save string to Keychain
    static func saveString(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        return save(key: key, data: data)
    }

    /// Load string from Keychain
    static func loadString(key: String) -> String? {
        guard let data = load(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

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

    private static let userIdKey = "porizo_user_id"

    private static func getOrCreateUserId() -> String {
        // Try to get existing ID from Keychain (secure storage)
        if let existingId = KeychainHelper.loadString(key: userIdKey) {
            return existingId
        }

        // Migration: Check UserDefaults for existing ID (from previous versions)
        if let legacyId = UserDefaults.standard.string(forKey: userIdKey) {
            // Migrate to Keychain
            _ = KeychainHelper.saveString(key: userIdKey, value: legacyId)
            // Clean up UserDefaults
            UserDefaults.standard.removeObject(forKey: userIdKey)
            return legacyId
        }

        // Generate new device-bound ID
        // TODO: Future - replace with bearer auth after OAuth integration
        let newId = "ios_\(UUID().uuidString.lowercased().prefix(12))"
        _ = KeychainHelper.saveString(key: userIdKey, value: newId)
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

    // MARK: - Memory Questions API

    /// Generate contextual follow-up questions based on a memory
    /// Used by the story wizard to extract emotional essence for personalized songs
    func generateMemoryQuestions(memory: String, occasion: String?, recipientName: String?) async throws -> MemoryQuestionsResponse {
        let url = URL(string: "\(baseURL)/memory/questions")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let requestBody = MemoryQuestionsRequest(
            memory: memory,
            occasion: occasion,
            recipientName: recipientName
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        // Question generation may take a few seconds
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try JSONDecoder().decode(MemoryQuestionsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("MemoryQuestionsResponse: \(error.localizedDescription). Response: \(responseText.prefix(500))")
        }
    }

    // MARK: - Track API

    /// Create a new track
    func createTrack(request trackRequest: CreateTrackRequest) async throws -> CreateTrackResponse {
        let url = URL(string: "\(baseURL)/tracks")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")
        request.httpBody = try JSONEncoder().encode(trackRequest)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try JSONDecoder().decode(CreateTrackResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CreateTrackResponse: \(error.localizedDescription). Response: \(responseText.prefix(500))")
        }
    }

    /// Get all tracks for the current user
    func getTracks() async throws -> GetTracksResponse {
        let url = URL(string: "\(baseURL)/tracks")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(GetTracksResponse.self, from: data)
    }

    /// Get a specific track with its versions
    func getTrack(trackId: String) async throws -> GetTrackResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(GetTrackResponse.self, from: data)
    }

    /// Create a new version for a track
    func createVersion(trackId: String, renderType: String = "preview") async throws -> CreateVersionResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let body: [String: Any] = ["render_type": renderType]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(CreateVersionResponse.self, from: data)
    }

    /// Generate lyrics for a track version
    func generateLyrics(trackId: String, versionNum: Int) async throws -> GenerateLyricsResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics/generate")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")
        request.httpBody = "{}".data(using: .utf8)

        // Lyrics generation can take time - use longer timeout
        request.timeoutInterval = 60

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try JSONDecoder().decode(GenerateLyricsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GenerateLyricsResponse: \(error.localizedDescription). Response: \(responseText.prefix(500))")
        }
    }

    /// Get lyrics for a track version
    func getLyrics(trackId: String, versionNum: Int) async throws -> Lyrics? {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        struct LyricsWrapper: Codable {
            let lyrics: Lyrics?
        }
        let wrapper = try JSONDecoder().decode(LyricsWrapper.self, from: data)
        return wrapper.lyrics
    }

    /// Update lyrics for a track version (user edits)
    func updateLyrics(trackId: String, versionNum: Int, lyrics: Lyrics) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics")!

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        // Wrap lyrics in expected format
        struct LyricsWrapper: Encodable {
            let lyrics: Lyrics
        }
        request.httpBody = try JSONEncoder().encode(LyricsWrapper(lyrics: lyrics))

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)
    }

    /// Approve lyrics for a track version
    func approveLyrics(trackId: String, versionNum: Int) async throws -> ApproveLyricsResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics/approve")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")
        request.httpBody = "{}".data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(ApproveLyricsResponse.self, from: data)
    }

    /// Render a preview for a track version
    func renderPreview(trackId: String, versionNum: Int) async throws -> RenderPreviewResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/render_preview")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(userId, forHTTPHeaderField: "x-user-id")
        request.httpBody = "{}".data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(RenderPreviewResponse.self, from: data)
    }

    /// Get job status (for polling render progress)
    func getJobStatus(jobId: String) async throws -> JobStatus {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userId, forHTTPHeaderField: "x-user-id")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        return try JSONDecoder().decode(JobStatus.self, from: data)
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
