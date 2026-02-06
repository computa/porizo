//
//  APIClient+Poems.swift
//  PorizoApp
//
//  Poem creation, management, and sharing API methods.
//

import Foundation

extension APIClient {

    // MARK: - Poems API

    /// Get poems for the current user with optional pagination
    /// - Parameters:
    ///   - limit: Maximum number of poems to return (default: 50, max: 100)
    ///   - offset: Number of poems to skip (for pagination)
    func getPoems(limit: Int = 50, offset: Int = 0) async throws -> GetPoemsResponse {
        var components = URLComponents(string: "\(baseURL)/poems")!
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(min(limit, 100))),
            URLQueryItem(name: "offset", value: String(offset))
        ]

        return try await withRetry {
            var request = URLRequest(url: components.url!)
            request.httpMethod = "GET"
            try await applyAuthHeaders(&request)

            // Use auth retry wrapper - handles 401 with refresh-and-retry
            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(GetPoemsResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("GetPoemsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Create a new poem
    /// - Parameter poemRequest: The poem creation request with title, recipient, occasion, tone, and message
    /// - Returns: The created Poem
    func createPoem(request poemRequest: CreatePoemRequest) async throws -> Poem {
        let url = URL(string: "\(baseURL)/poems")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = try JSONEncoder().encode(poemRequest)

        // Poem generation may take a few seconds if using LLM
        request.timeoutInterval = 120

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(Poem.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("Poem: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get a specific poem by ID
    /// - Parameter poemId: The poem ID
    /// - Returns: GetPoemResponse containing the poem
    func getPoem(poemId: String) async throws -> GetPoemResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(GetPoemResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GetPoemResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Update a poem
    /// - Parameters:
    ///   - poemId: The poem ID
    ///   - updates: Fields to update (title, tone, etc.)
    /// - Returns: The updated Poem
    func updatePoem(poemId: String, updates: UpdatePoemRequest) async throws -> UpdatePoemResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = try JSONEncoder().encode(updates)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(UpdatePoemResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("UpdatePoemResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Delete a poem (soft delete)
    /// - Parameter poemId: The poem ID
    func deletePoem(poemId: String) async throws {
        let url = URL(string: "\(baseURL)/poems/\(poemId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try await applyAuthHeaders(&request)

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    // MARK: - Poem Audio API

    /// Generate TTS audio for a poem (idempotent — skips if already generated)
    /// - Parameter poemId: The poem ID
    /// - Returns: PoemAudioResponse with audio URL and generation timestamp
    func generatePoemAudio(poemId: String) async throws -> PoemAudioResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)/audio")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.timeoutInterval = 60

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(PoemAudioResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PoemAudioResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Construct the authenticated audio streaming URL for a poem
    /// - Parameter poemId: The poem ID
    /// - Returns: Full URL string for audio streaming
    func poemAudioURL(poemId: String) -> String {
        "\(baseURL)/poems/\(poemId)/audio"
    }

    // MARK: - Poem Share API

    /// Create a share link for a poem
    /// - Parameters:
    ///   - poemId: The poem ID to share
    ///   - expiresInDays: How many days until the share expires (default 30)
    ///   - allowSave: Whether recipient can save the poem to their library
    /// - Returns: CreatePoemShareResponse with share URL and claim PIN
    func createPoemShare(poemId: String, expiresInDays: Int = 30, allowSave: Bool = true) async throws -> CreatePoemShareResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)/share")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: Any] = [
            "expires_in_days": expiresInDays,
            "allow_save": allowSave
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(CreatePoemShareResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CreatePoemShareResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get public share info for a poem share token (no auth required)
    /// - Parameter shareId: The share token ID
    /// - Returns: PoemShareInfoResponse with poem preview and status
    func getPoemShareInfo(shareId: String) async throws -> PoemShareInfoResponse {
        let url = URL(string: "\(baseURL)/poem-share/\(shareId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // Public endpoint - no auth required

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(PoemShareInfoResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PoemShareInfoResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Claim a shared poem with PIN verification
    /// - Parameters:
    ///   - shareId: The share token ID
    ///   - pin: 6-digit PIN from sender
    /// - Returns: PoemShareClaimResponse with full poem if successful
    func claimPoemShare(shareId: String, pin: String) async throws -> PoemShareClaimResponse {
        let url = URL(string: "\(baseURL)/poem-share/\(shareId)/claim")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")

        // Get device token for binding
        guard let deviceToken = try await ensureDeviceToken() else {
            throw APIClientError.notAuthenticated
        }
        request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")

        let body: [String: String] = ["pin": pin]
        request.httpBody = try JSONEncoder().encode(body)

        var (data, response) = try await Self.session.data(for: request)

        // Handle device token refresh if needed
        if let httpResponse = response as? HTTPURLResponse,
           shouldRetryDeviceToken(httpResponse: httpResponse, data: data) {
            clearDeviceToken()
            guard let refreshedToken = try await ensureDeviceToken() else {
                throw APIClientError.notAuthenticated
            }
            var retryRequest = request
            retryRequest.setValue(refreshedToken, forHTTPHeaderField: "x-device-token")
            (data, response) = try await Self.session.data(for: retryRequest)
        }

        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(PoemShareClaimResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PoemShareClaimResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }
}
