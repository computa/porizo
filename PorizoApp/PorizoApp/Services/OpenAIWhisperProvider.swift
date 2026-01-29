//
//  OpenAIWhisperProvider.swift
//  PorizoApp
//
//  OpenAI Whisper cloud provider - wraps the existing backend API.
//  Always available as fallback since it uses the server-side implementation.
//

import Foundation

/// OpenAI Whisper cloud provider via backend API
/// This is a wrapper around the existing /v2/story/:id/audio endpoint
actor OpenAIWhisperProvider: STTProvider {
    static let providerId = "openai"

    /// Always available (uses backend)
    static var isAvailable: Bool { true }

    private let apiClient: APIClient
    private var currentTask: Task<STTResult, Error>?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func transcribe(audioData: Data, language: String?) async throws -> STTResult {
        // This provider requires a storyId context - it's handled by STTRouter
        // which calls the backend API directly. This is a fallback implementation.
        throw STTError.transcriptionFailed("OpenAI provider requires story context - use STTRouter instead")
    }

    /// Transcribe with story context (used by STTRouter)
    func transcribe(audioData: Data, storyId: String, filename: String) async throws -> STTResult {
        let task = Task {
            let response = try await apiClient.transcribeAudio(
                storyId: storyId,
                audioData: audioData,
                filename: filename
            )

            if !response.success {
                throw STTError.transcriptionFailed("Backend returned failure")
            }

            let text = response.transcription.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                throw STTError.noSpeechDetected
            }

            return STTResult(
                text: text,
                language: response.language,
                confidence: nil,
                duration: nil,
                provider: Self.providerId
            )
        }

        currentTask = task
        return try await task.value
    }

    func cancel() async {
        currentTask?.cancel()
        currentTask = nil
    }
}
