import Foundation

struct STTResult: Sendable, Equatable {
    let text: String
    let language: String?
    let confidence: Float?
    let duration: TimeInterval?
    let provider: String

    init(text: String, language: String? = nil, confidence: Float? = nil, duration: TimeInterval? = nil, provider: String) {
        self.text = text
        self.language = language
        self.confidence = confidence
        self.duration = duration
        self.provider = provider
    }
}
