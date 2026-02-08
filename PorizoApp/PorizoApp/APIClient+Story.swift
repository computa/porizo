//
//  APIClient+Story.swift
//  PorizoApp
//
//  Story Q&A flow and memory questions API methods.
//

import Foundation
import UIKit  // For BackgroundTaskManager

extension APIClient {

    /// Story start endpoint enforces maxLength=500 on `initial_prompt`.
    /// Normalize client payload so we don't fail with a server-side 400.
    private func normalizedStoryInitialPrompt(
        _ initialPrompt: String,
        occasion: String,
        recipientName: String
    ) -> String {
        let trimmed = initialPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackPrompt = "A heartfelt \(occasion) story for \(recipientName)."
        let base = trimmed.isEmpty ? fallbackPrompt : trimmed
        if base.count <= StoryPromptBudget.initialPromptHardLimit {
            return base
        }
        #if DEBUG
        print("[APIClient+Story] Truncating initial_prompt from \(base.count) to \(StoryPromptBudget.initialPromptHardLimit) chars")
        #endif
        return String(base.prefix(StoryPromptBudget.initialPromptHardLimit))
    }

    // MARK: - Memory Questions API

    /// Generate contextual follow-up questions based on a memory
    /// Used by the story wizard to extract emotional essence for personalized songs
    func generateMemoryQuestions(memory: String, occasion: String?, recipientName: String?) async throws -> MemoryQuestionsResponse {
        let url = URL(string: "\(baseURL)/memory/questions")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let requestBody = MemoryQuestionsRequest(
            memory: memory,
            occasion: occasion,
            recipientName: recipientName
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        // Question generation may take a few seconds
        request.timeoutInterval = 120

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(MemoryQuestionsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("MemoryQuestionsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Story API (Dynamic Q&A Flow)

    /// Start a new story extraction session
    /// - Parameters:
    ///   - initialPrompt: The user's initial memory/prompt
    ///   - occasion: The occasion (determines arc: love, gratitude, celebration)
    ///   - recipientName: Who the song is for
    ///   - style: Music style (optional)
    /// - Returns: StartStoryV2Response with story_id and first question
    func startStory(initialPrompt: String, occasion: String, recipientName: String, style: String? = nil) async throws -> StartStoryV2Response {
        let url = URL(string: "\(baseURL)/story/start")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120  // Story reasoning can take longer than 30s

        let normalizedPrompt = normalizedStoryInitialPrompt(
            initialPrompt,
            occasion: occasion,
            recipientName: recipientName
        )

        let requestBody = StartStoryV2Request(
            initialPrompt: normalizedPrompt,
            occasion: occasion,
            recipientName: recipientName,
            style: style
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            let response = try Self.jsonDecoder.decode(StartStoryV2Response.self, from: data)
            if response.initialPromptTruncated == true {
                #if DEBUG
                let originalLength = response.initialPromptOriginalLength ?? -1
                let usedLength = response.initialPromptUsedLength ?? StoryPromptBudget.initialPromptHardLimit
                print("[APIClient+Story] Server condensed initial_prompt from \(originalLength) to \(usedLength) chars")
                #endif
            }
            return response
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StartStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Continue the story by submitting an answer
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - answer: User's answer to the current question
    /// - Returns: ContinueStoryV2Response with next question or completion status
    func continueStory(storyId: String, answer: String) async throws -> ContinueStoryV2Response {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "continueStory") { [self] in
            let url = URL(string: "\(baseURL)/story/\(storyId)/continue")!

            var request = try await makeRequest(url: url, method: "POST")
            request.timeoutInterval = 120

            let requestBody = ContinueStoryRequest(answer: answer)
            request.httpBody = try JSONEncoder().encode(requestBody)

            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get the story summary for user confirmation
    /// - Parameter storyId: The story session ID
    /// - Returns: StorySummaryV2Response with summary and soul of the story
    func getStorySummary(storyId: String) async throws -> StorySummaryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/summary")!

        let request = try await makeRequest(url: url, method: "GET")

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StorySummaryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StorySummaryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Confirm the story and mark ready for lyrics generation
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - additionalNotes: Optional additional notes from user
    /// - Returns: ConfirmStoryV2Response
    func confirmStory(storyId: String, additionalNotes: String? = nil) async throws -> ConfirmStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/confirm")!

        var request = try await makeRequest(url: url, method: "POST")

        let requestBody = ConfirmStoryRequest(additionalNotes: additionalNotes)
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ConfirmStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ConfirmStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Generate lyrics from a confirmed story
    /// - Parameter storyId: The story session ID (must be confirmed)
    /// - Returns: StoryLyricsResponse with lyrics and quality score
    func generateStoryLyrics(storyId: String) async throws -> StoryLyricsResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)/lyrics")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 60  // Lyrics generation takes longer
        request.httpBody = "{}".data(using: .utf8)  // Empty body for Fastify JSON parser

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryLyricsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryLyricsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Create a track from a confirmed story
    /// - Parameter storyId: The story session ID (must be confirmed)
    /// - Returns: StoryToTrackResponse with track_id and version info
    func storyToTrack(storyId: String) async throws -> StoryToTrackResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)/to-track")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)  // Empty body for Fastify JSON parser

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryToTrackResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryToTrackResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Cancel a story session
    /// - Parameter storyId: The story session ID
    func cancelStory(storyId: String) async throws {
        let url = URL(string: "\(baseURL)/story/\(storyId)")!

        let request = try await makeRequest(url: url, method: "DELETE")

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    /// Get story module info (occasions, styles, arcs)
    /// - Returns: StoryInfoResponse with available options
    func getStoryInfo() async throws -> StoryInfoResponse {
        let url = URL(string: "\(baseURL)/story/info")!

        let request = try await makeRequest(url: url, method: "GET")

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryInfoResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryInfoResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - V2 Story API (Enhanced Reasoning Engine)

    /// Start a new V2 story session with enhanced reasoning engine
    /// - Parameters:
    ///   - initialPrompt: The user's initial memory/prompt
    ///   - recipientName: Who the song is for
    ///   - occasion: The occasion type
    ///   - style: Music style (optional)
    /// - Returns: StartStoryV2Response with first question and beats
    func startStoryV2(
        initialPrompt: String,
        recipientName: String,
        occasion: String,
        style: String? = nil
    ) async throws -> StartStoryV2Response {
        let url = URL(string: "\(baseURL)/story/start")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120  // Story reasoning can take longer than 30s

        let normalizedPrompt = normalizedStoryInitialPrompt(
            initialPrompt,
            occasion: occasion,
            recipientName: recipientName
        )

        let requestBody = StartStoryV2Request(
            initialPrompt: normalizedPrompt,
            occasion: occasion,
            recipientName: recipientName,
            style: style
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            let response = try Self.jsonDecoder.decode(StartStoryV2Response.self, from: data)
            if response.initialPromptTruncated == true {
                #if DEBUG
                let originalLength = response.initialPromptOriginalLength ?? -1
                let usedLength = response.initialPromptUsedLength ?? StoryPromptBudget.initialPromptHardLimit
                print("[APIClient+Story] Server condensed initial_prompt from \(originalLength) to \(usedLength) chars")
                #endif
            }
            return response
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StartStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Continue a V2 story session by submitting an answer
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - answer: User's answer to the current question
    /// - Returns: ContinueStoryV2Response with next question or completion
    func continueStoryV2(storyId: String, answer: String) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/continue")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120

        let requestBody = ContinueStoryRequest(answer: answer)
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Confirm a V2 story and mark ready for lyrics generation
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - additionalNotes: Optional additional notes from user
    /// - Returns: ConfirmStoryV2Response with confirmation and final state
    func confirmStoryV2(storyId: String, additionalNotes: String? = nil) async throws -> ConfirmStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/confirm")!

        var request = try await makeRequest(url: url, method: "POST")

        let requestBody = ConfirmStoryRequest(additionalNotes: additionalNotes)
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ConfirmStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ConfirmStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Add more detail to a story after review
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - detail: The detail to add
    /// - Returns: ContinueStoryV2Response with updated narrative/question
    func addStoryDetails(storyId: String, detail: String) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/add-details")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(StoryAddDetailsRequest(detail: detail))

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Generate a poem from a confirmed story
    /// - Parameters:
    ///   - storyId: The confirmed story ID
    ///   - tone: Optional tone override
    ///   - style: Optional style override
    /// - Returns: Poem generation result with poem or missing details
    func createPoemFromStory(
        storyId: String,
        tone: String? = nil,
        style: String? = nil
    ) async throws -> StoryPoemGenerationResult {
        let url = URL(string: "\(baseURL)/story/\(storyId)/to-poem")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120
        request.httpBody = try JSONEncoder().encode(StoryToPoemRequest(tone: tone, style: style))

        let (data, response) = try await executeWithAuthRetry(
            request: request,
            allowedStatusCodes: Set([422])
        )

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if httpResponse.statusCode == 200 {
            do {
                let payload = try Self.jsonDecoder.decode(StoryToPoemResponse.self, from: data)
                return .poem(payload)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("StoryToPoemResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }

        if httpResponse.statusCode == 422 {
            do {
                let payload = try Self.jsonDecoder.decode(StoryPoemGapResponse.self, from: data)
                return .gaps(payload)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("StoryPoemGapResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }

        try validateResponse(response, data: data)
        throw APIClientError.invalidResponse
    }

    /// Get the current story session state (resume)
    /// - Parameter storyId: The story session ID
    /// - Returns: StorySessionStateResponse with session details
    func getStorySession(storyId: String) async throws -> StorySessionStateResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)")!

        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StorySessionStateResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StorySessionStateResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Transcribe audio for a story session
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - audioData: Audio data (m4a, mp3, wav, webm supported)
    ///   - filename: Original filename with extension (for format detection)
    /// - Returns: Transcription response with text
    func transcribeAudio(storyId: String, audioData: Data, filename: String) async throws -> SpeechTranscriptionResponse {
        let url = URL(string: "\(baseURL)/v2/story/\(storyId)/audio")!

        // Create multipart/form-data request
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request)

        // Transcription timeout - 60s is sufficient for typical audio clips
        // (Reduced from 120s for better UX on failure)
        request.timeoutInterval = 60

        // Build multipart body
        var body = Data()

        // Determine MIME type from filename extension
        let mimeType: String
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "m4a":
            mimeType = "audio/mp4"
        case "mp3":
            mimeType = "audio/mpeg"
        case "wav":
            mimeType = "audio/wav"
        case "webm":
            mimeType = "audio/webm"
        default:
            mimeType = "application/octet-stream"
        }

        // Add audio file field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SpeechTranscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SpeechTranscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Transcribe audio without story context (standalone endpoint)
    /// Use this when no story session exists yet (e.g., Simple create flow)
    /// - Parameters:
    ///   - audioData: Audio data (m4a, mp3, wav, webm supported)
    ///   - filename: Original filename with extension (for format detection)
    /// - Returns: Transcription response with text
    func transcribeAudioStandalone(audioData: Data, filename: String) async throws -> SpeechTranscriptionResponse {
        let url = URL(string: "\(baseURL)/v2/audio/transcribe")!

        // Create multipart/form-data request
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request)

        // Transcription timeout - 60s is sufficient for typical audio clips
        request.timeoutInterval = 60

        // Build multipart body
        var body = Data()

        // Determine MIME type from filename extension
        let mimeType: String
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "m4a":
            mimeType = "audio/mp4"
        case "mp3":
            mimeType = "audio/mpeg"
        case "wav":
            mimeType = "audio/wav"
        case "webm":
            mimeType = "audio/webm"
        default:
            mimeType = "application/octet-stream"
        }

        // Add audio file field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SpeechTranscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SpeechTranscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }
}
