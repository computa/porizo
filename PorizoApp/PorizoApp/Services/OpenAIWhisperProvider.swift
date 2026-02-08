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
        print("[OpenAIWhisperProvider] Starting transcription, storyId=\(storyId), audioData size=\(audioData.count) bytes")
        let task = Task {
            do {
                let response = try await apiClient.transcribeAudio(
                    storyId: storyId,
                    audioData: audioData,
                    filename: filename
                )
                return try self.processResponse(response)
            } catch {
                print("[OpenAIWhisperProvider] Transcription failed: \(error.localizedDescription)")
                throw error
            }
        }

        currentTask = task
        return try await task.value
    }

    /// Transcribe without story context (standalone endpoint)
    func transcribeStandalone(audioData: Data, filename: String) async throws -> STTResult {
        print("[OpenAIWhisperProvider] Starting standalone transcription, audioData size=\(audioData.count) bytes")
        let task = Task {
            do {
                let response = try await apiClient.transcribeAudioStandalone(
                    audioData: audioData,
                    filename: filename
                )
                return try self.processResponse(response)
            } catch {
                print("[OpenAIWhisperProvider] Transcription failed: \(error.localizedDescription)")
                throw error
            }
        }

        currentTask = task
        return try await task.value
    }

    /// Process transcription response into STTResult
    private func processResponse(_ response: SpeechTranscriptionResponse) throws -> STTResult {
        print("[OpenAIWhisperProvider] Backend response: success=\(response.success)")

        if !response.success {
            throw STTError.transcriptionFailed("Backend returned failure")
        }

        if response.exceedsStoryStartLimit == true {
            #if DEBUG
            let textLength = response.textLength ?? response.transcription.count
            let budget = response.storyStartLimit ?? StoryPromptBudget.initialPromptHardLimit
            print("[OpenAIWhisperProvider] Transcription exceeds story prompt limit: \(textLength)/\(budget)")
            #endif
        }

        let text = response.transcription.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            print("[OpenAIWhisperProvider] No speech detected in response")
            throw STTError.noSpeechDetected
        }

        print("[OpenAIWhisperProvider] Transcription successful: \(text.prefix(50))...")
        return STTResult(
            text: text,
            language: response.language,
            confidence: nil,
            duration: nil,
            provider: Self.providerId
        )
    }

    func cancel() async {
        currentTask?.cancel()
        currentTask = nil
    }
}
