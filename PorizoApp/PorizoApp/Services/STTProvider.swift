//
//  STTProvider.swift
//  PorizoApp
//
//  Protocol and models for multi-provider Speech-to-Text system.
//  Supports: Apple SpeechAnalyzer (iOS 26+), WhisperKit (on-device), OpenAI Whisper (cloud)
//

import Foundation

// MARK: - STT Provider Protocol

/// Protocol for speech-to-text providers
/// Each provider is an actor to ensure thread-safe transcription
protocol STTProvider: Actor {
    /// Unique identifier for this provider (matches backend config)
    static var providerId: String { get }

    /// Whether this provider is available on the current device
    static var isAvailable: Bool { get }

    /// Transcribe audio data to text
    /// - Parameters:
    ///   - audioData: Audio data (WAV format preferred)
    ///   - language: Optional language hint (ISO 639-1 code, e.g., "en")
    /// - Returns: Transcription result
    func transcribe(audioData: Data, language: String?) async throws -> STTResult

    /// Cancel any ongoing transcription
    func cancel() async
}

// MARK: - STT Result

/// Result from a successful transcription
struct STTResult: Sendable, Equatable {
    /// Transcribed text
    let text: String

    /// Detected or specified language (ISO 639-1 code)
    let language: String?

    /// Confidence score (0.0 to 1.0), if available
    let confidence: Float?

    /// Audio duration in seconds, if available
    let duration: TimeInterval?

    /// Provider that produced this result
    let provider: String

    init(text: String, language: String? = nil, confidence: Float? = nil, duration: TimeInterval? = nil, provider: String) {
        self.text = text
        self.language = language
        self.confidence = confidence
        self.duration = duration
        self.provider = provider
    }
}

// MARK: - STT Error

/// Errors that can occur during speech-to-text transcription
enum STTError: Error, LocalizedError, Sendable {
    /// Provider is not available on this device
    case providerUnavailable(String)

    /// Audio format is not supported
    case unsupportedFormat(String)

    /// Transcription failed
    case transcriptionFailed(String)

    /// No speech detected in audio
    case noSpeechDetected

    /// Operation was cancelled
    case cancelled

    /// Network error (for cloud providers)
    case networkError(String)

    /// Model not downloaded (for WhisperKit)
    case modelNotDownloaded(String)

    /// Permission denied (microphone access)
    case permissionDenied

    /// Rate limit exceeded
    case rateLimitExceeded

    /// Unknown error
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .providerUnavailable(let provider):
            return "STT provider '\(provider)' is not available on this device"
        case .unsupportedFormat(let format):
            return "Audio format '\(format)' is not supported"
        case .transcriptionFailed(let reason):
            return "Transcription failed: \(reason)"
        case .noSpeechDetected:
            return "No speech detected in audio"
        case .cancelled:
            return "Transcription was cancelled"
        case .networkError(let reason):
            return "Network error: \(reason)"
        case .modelNotDownloaded(let model):
            return "Model '\(model)' needs to be downloaded first"
        case .permissionDenied:
            return "Microphone permission denied"
        case .rateLimitExceeded:
            return "Rate limit exceeded, please try again later"
        case .unknown(let reason):
            return "Unknown error: \(reason)"
        }
    }
}

// MARK: - STT Configuration

/// Configuration for STT system fetched from backend
struct STTConfig: Codable, Sendable, Equatable {
    let primaryProvider: String
    let fallbackProvider: String
    let whisperkitModel: String
    let providerStatus: [String: String]

    enum CodingKeys: String, CodingKey {
        case primaryProvider = "primary_provider"
        case fallbackProvider = "fallback_provider"
        case whisperkitModel = "whisperkit_model"
        case providerStatus = "provider_status"
    }

    /// Default configuration when backend is unreachable
    static let `default` = STTConfig(
        primaryProvider: "whisperkit",
        fallbackProvider: "openai",
        whisperkitModel: "small",
        providerStatus: [:]
    )

    /// Check if a provider is enabled
    func isProviderEnabled(_ providerId: String) -> Bool {
        let status = providerStatus["stt_\(providerId)"] ?? "active"
        return status == "active"
    }
}

/// Response from /app/config endpoint
struct AppConfigResponse: Codable, Sendable {
    let stt: STTConfig
}
