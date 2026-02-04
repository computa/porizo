//
//  WhisperKitProvider.swift
//  PorizoApp
//
//  WhisperKit on-device transcription provider.
//  Requires WhisperKit SPM package: https://github.com/argmaxinc/WhisperKit
//  Highest accuracy (~2.2% WER) but requires model download.
//

import Foundation

#if canImport(WhisperKit)
import WhisperKit
#endif

/// WhisperKit on-device transcription provider
/// Provides highest accuracy for diverse accents
actor WhisperKitProvider: STTProvider {
    static let providerId = "whisperkit"

    /// Check if WhisperKit is available (compiled with the framework)
    static var isAvailable: Bool {
        #if canImport(WhisperKit)
        return true
        #else
        return false
        #endif
    }

    private var whisperKit: Any? // WhisperKit instance (typed as Any to avoid compile errors when not imported)
    private var currentTask: Task<STTResult, Error>?
    private let modelName: String

    /// Initialize with model name
    /// - Parameter modelName: WhisperKit model name (tiny, small, medium, large)
    init(modelName: String = "small") {
        self.modelName = modelName
    }

    func transcribe(audioData: Data, language: String?) async throws -> STTResult {
        #if canImport(WhisperKit)
        // Ensure WhisperKit is initialized
        if whisperKit == nil {
            do {
                // Initialize WhisperKit with specified model
                let kit = try await WhisperKit(model: "openai_whisper-\(modelName)")
                whisperKit = kit
            } catch {
                throw STTError.modelNotDownloaded(modelName)
            }
        }

        guard let kit = whisperKit as? WhisperKit else {
            throw STTError.providerUnavailable(Self.providerId)
        }

        // Write audio to temporary file
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("whisperkit_\(UUID().uuidString).wav")

        do {
            try audioData.write(to: tempURL)
        } catch {
            throw STTError.transcriptionFailed("Failed to write audio file: \(error.localizedDescription)")
        }

        defer {
            try? FileManager.default.removeItem(at: tempURL)
        }

        // Perform transcription
        let transcriptionTask = Task {
            let results = try await kit.transcribe(audioPath: tempURL.path, decodeOptions: DecodingOptions(
                language: language
            ))

            guard let result = results.first else {
                throw STTError.noSpeechDetected
            }

            let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty {
                throw STTError.noSpeechDetected
            }

            return STTResult(
                text: text,
                language: result.language ?? language,
                confidence: nil, // WhisperKit doesn't provide confidence scores directly
                duration: nil,
                provider: Self.providerId
            )
        }

        currentTask = transcriptionTask
        return try await transcriptionTask.value
        #else
        throw STTError.providerUnavailable(Self.providerId)
        #endif
    }

    func cancel() async {
        currentTask?.cancel()
        currentTask = nil
    }

    /// Pre-download the model (call during app initialization if desired)
    func preloadModel() async throws {
        #if canImport(WhisperKit)
        if whisperKit == nil {
            do {
                let kit = try await WhisperKit(model: "openai_whisper-\(modelName)")
                whisperKit = kit
            } catch {
                throw STTError.modelNotDownloaded(modelName)
            }
        }
        #else
        throw STTError.providerUnavailable(Self.providerId)
        #endif
    }
}
