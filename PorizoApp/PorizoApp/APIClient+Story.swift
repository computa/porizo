//
//  APIClient+Story.swift
//  PorizoApp
//
//  Story Q&A flow and memory questions API methods.
//

import Foundation
import UIKit  // For BackgroundTaskManager

extension APIClient {

    /// Normalize empty prompts without truncating user content.
    /// Long prompts are condensed server-side for reasoning while raw text is preserved.
    private func normalizedStoryInitialPrompt(
        _ initialPrompt: String,
        occasion: String,
        recipientName: String
    ) -> String {
        let trimmed = initialPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackPrompt = "A heartfelt \(occasion) story for \(recipientName)."
        let base = trimmed.isEmpty ? fallbackPrompt : trimmed
        return base
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
    func storyToTrack(
        storyId: String,
        voiceMode: String? = nil,
        voiceGender: String? = nil,
        style: String? = nil,
        giftReservationId: String? = nil
    ) async throws -> StoryToTrackResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)/to-track")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(
            StoryToTrackRequest(
                voiceMode: voiceMode,
                voiceGender: voiceGender,
                style: style,
                giftReservationId: giftReservationId
            )
        )

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryToTrackResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryToTrackResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func updateStoryStyle(
        storyId: String,
        style: String?
    ) async throws -> StoryStyleUpdateResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)/style")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(
            StoryStyleUpdateRequest(style: style)
        )

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryStyleUpdateResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryStyleUpdateResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
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
    func continueStoryV2(
        storyId: String,
        answer: String,
        expectedSessionVersion: Int? = nil
    ) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/continue")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120

        let requestBody = ContinueStoryRequest(
            answer: answer,
            expectedSessionVersion: expectedSessionVersion
        )
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
    func confirmStoryV2(
        storyId: String,
        additionalNotes: String? = nil,
        forceConfirm: Bool = false
    ) async throws -> StoryConfirmResult {
        let url = URL(string: "\(baseURL)/story/\(storyId)/confirm")!

        var request = try await makeRequest(url: url, method: "POST")

        let requestBody = ConfirmStoryRequest(
            additionalNotes: additionalNotes,
            forceConfirm: forceConfirm ? true : nil
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, response) = try await executeWithAuthRetry(
            request: request,
            allowedStatusCodes: Set([422])
        )

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if httpResponse.statusCode == 422 {
            do {
                let payload = try Self.jsonDecoder.decode(StoryGuidanceResponse.self, from: data)
                return .needsInput(payload)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("StoryGuidanceResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }

        do {
            let payload = try Self.jsonDecoder.decode(ConfirmStoryV2Response.self, from: data)
            return .confirmed(payload)
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

    /// Apply an explicit revision request to a review-ready story draft.
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - revisionRequest: What to change in the draft
    ///   - source: Revision source for server-side semantics
    /// - Returns: ContinueStoryV2Response with updated draft/question
    func reviseStory(
        storyId: String,
        revisionRequest: String,
        source: String? = nil,
        operation: StoryRevisionOperation? = nil
    ) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/revise")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(
            StoryRevisionRequest(
                revisionRequest: revisionRequest,
                source: source,
                operation: operation
            )
        )

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Prepare the current story draft for review without confirming it.
    /// - Parameter storyId: The story session ID
    /// - Returns: ContinueStoryV2Response with canonical review-ready state
    func prepareStoryReview(storyId: String) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/review")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)

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
        style: String? = nil,
        giftReservationId: String? = nil,
        force: Bool = false
    ) async throws -> StoryPoemGenerationResult {
        let url = URL(string: "\(baseURL)/story/\(storyId)/to-poem")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120
        request.httpBody = try JSONEncoder().encode(
            StoryToPoemRequest(
                tone: tone,
                style: style,
                giftReservationId: giftReservationId,
                force: force ? true : nil
            )
        )

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

    /// Fetch on-demand element guidance for a specific story element.
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - elementId: Element to get guidance for (e.g. "moment", "feeling")
    /// - Returns: ElementGuidance with diagnosis, suggestion, and examples
    func fetchElementGuidance(storyId: String, elementId: String) async throws -> ElementGuidance {
        let url = URL(string: "\(baseURL)/story/\(storyId)/element-guidance/\(elementId)")!

        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ElementGuidance.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ElementGuidance: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Build a multipart/form-data body for an audio file upload.
    private func buildAudioMultipartBody(audioData: Data, filename: String, boundary: String) -> Data {
        let ext = (filename as NSString).pathExtension.lowercased()
        let mimeType: String
        switch ext {
        case "m4a":  mimeType = "audio/mp4"
        case "mp3":  mimeType = "audio/mpeg"
        case "wav":  mimeType = "audio/wav"
        case "webm": mimeType = "audio/webm"
        default:     mimeType = "application/octet-stream"
        }

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        return body
    }

    /// Transcribe audio for a story session
    func transcribeAudio(storyId: String, audioData: Data, filename: String) async throws -> SpeechTranscriptionResponse {
        let url = URL(string: "\(baseURL)/v2/story/\(storyId)/audio")!
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request)
        request.timeoutInterval = 60
        request.httpBody = buildAudioMultipartBody(audioData: audioData, filename: filename, boundary: boundary)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SpeechTranscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SpeechTranscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Transcribe audio without story context (standalone endpoint)
    func transcribeAudioStandalone(audioData: Data, filename: String) async throws -> SpeechTranscriptionResponse {
        let url = URL(string: "\(baseURL)/v2/audio/transcribe")!
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request)
        request.timeoutInterval = 60
        request.httpBody = buildAudioMultipartBody(audioData: audioData, filename: filename, boundary: boundary)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SpeechTranscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SpeechTranscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }
}
