import Foundation

enum STTError: Error, LocalizedError, Sendable {
    case providerUnavailable(String)
    case unsupportedFormat(String)
    case transcriptionFailed(String)
    case noSpeechDetected
    case cancelled
    case networkError(String)
    case modelNotDownloaded(String)
    case permissionDenied
    case rateLimitExceeded
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
