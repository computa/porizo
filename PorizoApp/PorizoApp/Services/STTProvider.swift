import Foundation

protocol STTProvider: Actor {
    static var providerId: String { get }
    static var isAvailable: Bool { get }
    func transcribe(audioData: Data, language: String?) async throws -> STTResult
    func cancel() async
}
