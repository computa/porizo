//
//  APIClient+Tracks.swift
//  PorizoApp
//
//  Track creation, rendering, lyrics, and reroll API methods.
//

import Foundation
import UIKit  // For BackgroundTaskManager

extension APIClient {

    // MARK: - Track API

    /// Create a new track
    func createTrack(request trackRequest: CreateTrackRequest) async throws -> CreateTrackResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createTrack") { [self] in
            let url = URL(string: "\(baseURL)/tracks")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = try JSONEncoder().encode(trackRequest)

            // Use auth retry wrapper - handles 401 with refresh-and-retry
            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(CreateTrackResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("CreateTrackResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get tracks for the current user with optional pagination
    /// - Parameters:
    ///   - limit: Maximum number of tracks to return (default: 50, max: 100)
    ///   - offset: Number of tracks to skip (for pagination)
    func getTracks(limit: Int = 50, offset: Int = 0) async throws -> GetTracksResponse {
        var components = URLComponents(string: "\(baseURL)/tracks")!
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
                return try Self.jsonDecoder.decode(GetTracksResponse.self, from: data)
            } catch let decodingError as DecodingError {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                print("[APIClient] GetTracks decoding error: \(decodingError)")
                print("[APIClient] GetTracks response: \(responseText.prefix(500))")
                throw decodingError
            }
        }
    }

    /// Get a specific track with its versions
    func getTrack(trackId: String) async throws -> GetTrackResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        // Use auth retry wrapper - handles 401 with refresh-and-retry
        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(GetTrackResponse.self, from: data)
    }

    /// Debug stream check for a track version (server-side availability)
    func streamCheck(trackId: String, versionNum: Int) async throws -> StreamCheckResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/stream-check")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(StreamCheckResponse.self, from: data)
    }

    /// Create a new version for a track
    func createVersion(trackId: String, renderType: String = "preview") async throws -> CreateVersionResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: Any] = ["render_type": renderType]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(CreateVersionResponse.self, from: data)
    }

    /// Generate lyrics for a track version
    func generateLyrics(trackId: String, versionNum: Int) async throws -> GenerateLyricsResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "generateLyrics") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics/generate")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = "{}".data(using: .utf8)

            // Lyrics generation can take time - use longer timeout
            request.timeoutInterval = 60

            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(GenerateLyricsResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("GenerateLyricsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get lyrics for a track version
    func getLyrics(trackId: String, versionNum: Int) async throws -> Lyrics? {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        struct LyricsWrapper: Codable {
            let lyrics: Lyrics?
        }
        let wrapper = try Self.jsonDecoder.decode(LyricsWrapper.self, from: data)
        return wrapper.lyrics
    }

    /// Update lyrics for a track version (user edits)
    func updateLyrics(trackId: String, versionNum: Int, lyrics: Lyrics) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics")!

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        // Wrap lyrics in expected format
        struct LyricsWrapper: Encodable {
            let lyrics: Lyrics
        }
        request.httpBody = try JSONEncoder().encode(LyricsWrapper(lyrics: lyrics))

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    /// Approve lyrics for a track version
    func approveLyrics(trackId: String, versionNum: Int) async throws -> ApproveLyricsResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics/approve")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = "{}".data(using: .utf8)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(ApproveLyricsResponse.self, from: data)
    }

    /// Render a preview for a track version
    func renderPreview(trackId: String, versionNum: Int) async throws -> RenderPreviewResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderPreview") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/render_preview")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = "{}".data(using: .utf8)

            let (data, _) = try await executeWithAuthRetry(request: request)

            return try Self.jsonDecoder.decode(RenderPreviewResponse.self, from: data)
        }
    }

    /// Render full version of a track (requires credit confirmation)
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - versionNum: Version number
    /// - Returns: RenderFullResponse with job ID and billing hold info
    func renderFull(trackId: String, versionNum: Int) async throws -> RenderFullResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderFull") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/render_full")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)

            // confirm_credit_spend is required by the API
            let body = ["confirm_credit_spend": true]
            request.httpBody = try JSONEncoder().encode(body)

            let (data, _) = try await executeWithAuthRetry(request: request)

            return try Self.jsonDecoder.decode(RenderFullResponse.self, from: data)
        }
    }

    /// Get user entitlements (credits, tier, limits)
    func getEntitlements() async throws -> EntitlementsResponse {
        let url = URL(string: "\(baseURL)/entitlements")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        // Use auth retry wrapper - handles 401 with refresh-and-retry
        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(EntitlementsResponse.self, from: data)
    }

    /// Get job status (for polling render progress)
    func getJobStatus(jobId: String) async throws -> JobStatus {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(JobStatus.self, from: data)
    }

    // MARK: - Reroll API

    /// Reroll a track version to create a new version with changes
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - versionNum: Version number to base the reroll on
    ///   - rerollType: Type of reroll (lyrics, beat, or vocals)
    /// - Returns: RerollResponse with new version number and job info
    func reroll(trackId: String, versionNum: Int, rerollType: RerollType) async throws -> RerollResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/reroll")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: String] = ["reroll_type": rerollType.rawValue]
        request.httpBody = try JSONEncoder().encode(body)

        // Reroll operations may take time
        request.timeoutInterval = 120

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(RerollResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("RerollResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Retry API

    /// Retry a failed preview render via DLQ
    func retryPreview(trackId: String, versionNum: Int) async throws -> RenderPreviewResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "retryPreview") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/retry")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = "{}".data(using: .utf8)

            let (data, _) = try await executeWithAuthRetry(request: request)

            return try Self.jsonDecoder.decode(RenderPreviewResponse.self, from: data)
        }
    }

    /// Retry a failed full render via DLQ
    func retryFullRender(trackId: String, versionNum: Int) async throws -> RenderPreviewResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "retryFullRender") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/retry")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)

            let body = ["render_type": "full"]
            request.httpBody = try JSONEncoder().encode(body)

            let (data, _) = try await executeWithAuthRetry(request: request)

            return try Self.jsonDecoder.decode(RenderPreviewResponse.self, from: data)
        }
    }

    // MARK: - Delete Track

    /// Delete a track
    func deleteTrack(trackId: String) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try await applyAuthHeaders(&request)

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    // MARK: - Update Track Voice Mode

    /// Update the voice mode for a track (user_voice or ai_voice)
    /// Called after lyrics approval to set the voice mode before rendering
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - voiceMode: The voice mode ("user_voice" or "ai_voice")
    func updateVoiceMode(trackId: String, voiceMode: String) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/voice_mode")!

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body = ["voice_mode": voiceMode]
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await executeWithAuthRetry(request: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIClientError.serverError(message: "Failed to update voice mode", code: nil, details: nil)
        }
    }
}
