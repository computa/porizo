//
//  AppleSpeechProvider.swift
//  PorizoApp
//
//  Apple's on-device Speech framework provider.
//  Uses SFSpeechRecognizer for transcription - available iOS 10+.
//  Note: iOS 18+ has improved accuracy with SpeechAnalyzer APIs.
//

import Foundation
import Speech
import AVFoundation

/// Apple Speech framework provider for on-device transcription
actor AppleSpeechProvider: STTProvider {
    static let providerId = "apple"

    /// Check if Speech recognition is available
    static var isAvailable: Bool {
        SFSpeechRecognizer.authorizationStatus() != .denied &&
        SFSpeechRecognizer()?.isAvailable == true
    }

    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer: SFSpeechRecognizer?

    init() {
        // Use default locale, or English as fallback
        self.speechRecognizer = SFSpeechRecognizer() ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    func transcribe(audioData: Data, language: String?) async throws -> STTResult {
        // Check availability
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            throw STTError.providerUnavailable(Self.providerId)
        }

        // Request authorization if needed
        let authStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }

        guard authStatus == .authorized else {
            throw STTError.permissionDenied
        }

        // Write audio data to temporary file (SFSpeechRecognizer needs a URL)
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("stt_\(UUID().uuidString).wav")

        do {
            try audioData.write(to: tempURL)
        } catch {
            throw STTError.transcriptionFailed("Failed to write audio file: \(error.localizedDescription)")
        }

        defer {
            try? FileManager.default.removeItem(at: tempURL)
        }

        // Create recognition request
        let request = SFSpeechURLRecognitionRequest(url: tempURL)
        request.shouldReportPartialResults = false

        // Set language if specified
        if let language = language {
            // Try to use specified locale
            if let localizedRecognizer = SFSpeechRecognizer(locale: Locale(identifier: language)),
               localizedRecognizer.isAvailable {
                return try await performRecognition(with: localizedRecognizer, request: request)
            }
        }

        return try await performRecognition(with: recognizer, request: request)
    }

    private func performRecognition(with recognizer: SFSpeechRecognizer, request: SFSpeechURLRecognitionRequest) async throws -> STTResult {
        return try await withCheckedThrowingContinuation { continuation in
            recognitionTask = recognizer.recognitionTask(with: request) { result, error in
                if let error = error {
                    let nsError = error as NSError
                    if nsError.domain == "kAFAssistantErrorDomain" && nsError.code == 1110 {
                        continuation.resume(throwing: STTError.noSpeechDetected)
                    } else {
                        continuation.resume(throwing: STTError.transcriptionFailed(error.localizedDescription))
                    }
                    return
                }

                guard let result = result else {
                    continuation.resume(throwing: STTError.transcriptionFailed("No result returned"))
                    return
                }

                if result.isFinal {
                    let text = result.bestTranscription.formattedString
                    if text.isEmpty {
                        continuation.resume(throwing: STTError.noSpeechDetected)
                    } else {
                        // Calculate confidence from segments
                        let segments = result.bestTranscription.segments
                        let avgConfidence: Float? = segments.isEmpty ? nil : Float(segments.map { $0.confidence }.reduce(0, +)) / Float(segments.count)

                        let sttResult = STTResult(
                            text: text,
                            language: recognizer.locale.identifier,
                            confidence: avgConfidence,
                            duration: result.bestTranscription.segments.last?.timestamp,
                            provider: Self.providerId
                        )
                        continuation.resume(returning: sttResult)
                    }
                }
            }
        }
    }

    func cancel() async {
        recognitionTask?.cancel()
        recognitionTask = nil
    }
}
