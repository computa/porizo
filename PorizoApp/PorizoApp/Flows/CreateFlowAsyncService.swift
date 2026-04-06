//
//  CreateFlowAsyncService.swift
//  PorizoApp
//
//  Owns shared create-flow async calls so the UI layer stays out of background-task orchestration.
//

import Foundation

struct CreateFlowAsyncService {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    @MainActor
    func startStorySession(
        engine: V2StoryEngine,
        setup: StorySetup,
        initialPrompt: String
    ) async throws {
        engine.updateBasics(
            recipientName: setup.recipientName,
            occasion: setup.occasion?.rawValue ?? "custom",
            style: setup.style
        )
        try await engine.startSession(initialPrompt: initialPrompt)
    }

    func updateVoiceMode(trackId: String, mode: VoiceMode) async throws {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "updateVoiceMode") {
            try await apiClient.updateVoiceMode(trackId: trackId, voiceMode: mode.rawValue)
        }
    }

    func addStoryDetail(storyId: String, detail: String) async throws {
        _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "addStoryDetails") {
            try await apiClient.addStoryDetails(storyId: storyId, detail: detail)
        }
    }
}
