//
//  STTRouter.swift
//  PorizoApp
//
//  Routes STT requests to the appropriate provider based on backend config.
//  Implements graceful fallback when primary provider fails.
//

import Foundation
import Combine

/// Routes STT requests to configured providers with fallback support
@MainActor
final class STTRouter: ObservableObject {
    /// Current configuration from backend
    @Published private(set) var config: STTConfig = .default

    /// Whether config has been loaded from backend
    @Published private(set) var configLoaded = false

    /// Loading state for model downloads
    @Published private(set) var isLoadingModel = false

    private let apiClient: APIClient

    // Provider instances (lazy initialized)
    private var appleProvider: AppleSpeechProvider?
    private var whisperKitProvider: WhisperKitProvider?
    private var openAIProvider: OpenAIWhisperProvider?

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Fetch configuration from backend
    /// Call this at app launch
    func fetchConfig() async {
        do {
            let response = try await apiClient.getAppConfig()
            await MainActor.run {
                self.config = response.stt
                self.configLoaded = true
            }
            print("[STTRouter] Config loaded: primary=\(config.primaryProvider), fallback=\(config.fallbackProvider)")
        } catch {
            print("[STTRouter] Failed to fetch config, using defaults: \(error.localizedDescription)")
            await MainActor.run {
                self.config = .default
                self.configLoaded = true
            }
        }
    }

    /// Transcribe audio using configured providers with fallback
    /// - Parameters:
    ///   - audioData: Audio data (WAV format)
    ///   - storyId: Story session ID for context (optional - required for OpenAI backend fallback)
    ///   - filename: Original filename with extension
    /// - Returns: Transcription result
    func transcribe(audioData: Data, storyId: String?, filename: String = "audio.wav") async throws -> STTResult {
        // Ensure config is loaded
        if !configLoaded {
            await fetchConfig()
        }

        // Try primary provider
        let primaryId = config.primaryProvider
        if config.isProviderEnabled(primaryId) {
            do {
                print("[STTRouter] Trying primary provider: \(primaryId)")
                return try await transcribeWith(providerId: primaryId, audioData: audioData, storyId: storyId, filename: filename)
            } catch {
                print("[STTRouter] Primary provider \(primaryId) failed: \(error.localizedDescription)")
                // Fall through to fallback
            }
        } else {
            print("[STTRouter] Primary provider \(primaryId) is disabled")
        }

        // Try fallback provider
        let fallbackId = config.fallbackProvider
        if config.isProviderEnabled(fallbackId) && fallbackId != primaryId {
            do {
                print("[STTRouter] Trying fallback provider: \(fallbackId)")
                return try await transcribeWith(providerId: fallbackId, audioData: audioData, storyId: storyId, filename: filename)
            } catch {
                print("[STTRouter] Fallback provider \(fallbackId) failed: \(error.localizedDescription)")
                // Fall through to last resort
            }
        }

        // Last resort: OpenAI backend API
        if primaryId != "openai" && fallbackId != "openai" {
            do {
                if let storyId = storyId, !storyId.isEmpty {
                    print("[STTRouter] Trying last resort: openai (with storyId)")
                    return try await transcribeWith(providerId: "openai", audioData: audioData, storyId: storyId, filename: filename)
                } else {
                    // Use standalone endpoint when no storyId available
                    print("[STTRouter] Trying last resort: openai (standalone)")
                    if openAIProvider == nil {
                        openAIProvider = OpenAIWhisperProvider(apiClient: apiClient)
                    }
                    return try await openAIProvider!.transcribeStandalone(audioData: audioData, filename: filename)
                }
            } catch {
                print("[STTRouter] OpenAI fallback failed: \(error.localizedDescription)")
            }
        }

        // All providers failed
        throw STTError.transcriptionFailed("All STT providers failed. Check network connection and try again.")
    }

    /// Transcribe with a specific provider
    private func transcribeWith(providerId: String, audioData: Data, storyId: String?, filename: String) async throws -> STTResult {
        switch providerId {
        case "apple":
            guard AppleSpeechProvider.isAvailable else {
                throw STTError.providerUnavailable("apple")
            }
            if appleProvider == nil {
                appleProvider = AppleSpeechProvider()
            }
            return try await appleProvider!.transcribe(audioData: audioData, language: nil)

        case "whisperkit":
            guard WhisperKitProvider.isAvailable else {
                throw STTError.providerUnavailable("whisperkit")
            }
            if whisperKitProvider == nil {
                whisperKitProvider = WhisperKitProvider(modelName: config.whisperkitModel)
            }
            return try await whisperKitProvider!.transcribe(audioData: audioData, language: nil)

        case "openai":
            // OpenAI uses backend API
            if openAIProvider == nil {
                openAIProvider = OpenAIWhisperProvider(apiClient: apiClient)
            }
            // Use story-context endpoint if storyId available, otherwise standalone
            if let storyId = storyId, !storyId.isEmpty {
                return try await openAIProvider!.transcribe(audioData: audioData, storyId: storyId, filename: filename)
            } else {
                return try await openAIProvider!.transcribeStandalone(audioData: audioData, filename: filename)
            }

        default:
            throw STTError.providerUnavailable(providerId)
        }
    }

    /// Cancel any ongoing transcription
    func cancel() async {
        await appleProvider?.cancel()
        await whisperKitProvider?.cancel()
        await openAIProvider?.cancel()
    }

    /// Preload WhisperKit model (call during app initialization for better UX)
    func preloadWhisperKitModel() async {
        guard WhisperKitProvider.isAvailable else { return }
        guard config.primaryProvider == "whisperkit" || config.fallbackProvider == "whisperkit" else { return }

        await MainActor.run { isLoadingModel = true }
        defer { Task { @MainActor in isLoadingModel = false } }

        if whisperKitProvider == nil {
            whisperKitProvider = WhisperKitProvider(modelName: config.whisperkitModel)
        }

        do {
            try await whisperKitProvider?.preloadModel()
            print("[STTRouter] WhisperKit model preloaded: \(config.whisperkitModel)")
        } catch {
            print("[STTRouter] Failed to preload WhisperKit model: \(error.localizedDescription)")
        }
    }
}
