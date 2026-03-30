//
//  StorySyncService.swift
//  PorizoApp
//
//  Owns story API calls and persisted session I/O for the V2 story flow.
//

import Foundation

struct StorySyncService {
    private let apiClient: APIClient
    private let sessionStore: V2SessionStore

    init(apiClient: APIClient, sessionStore: V2SessionStore = .shared) {
        self.apiClient = apiClient
        self.sessionStore = sessionStore
    }

    func startStory(
        initialPrompt: String,
        recipientName: String,
        occasion: String,
        style: String?
    ) async throws -> StartStoryV2Response {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "startStoryV2") {
            try await apiClient.startStoryV2(
                initialPrompt: initialPrompt,
                recipientName: recipientName,
                occasion: occasion,
                style: style
            )
        }
    }

    func continueStory(
        storyId: String,
        answer: String,
        expectedSessionVersion: Int? = nil
    ) async throws -> ContinueStoryV2Response {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "continueStoryV2") {
            try await apiClient.continueStoryV2(
                storyId: storyId,
                answer: answer,
                expectedSessionVersion: expectedSessionVersion
            )
        }
    }

    func updateStoryStyle(storyId: String, style: String?) async throws -> StoryStyleUpdateResponse {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "updateStoryStyle") {
            try await apiClient.updateStoryStyle(storyId: storyId, style: style)
        }
    }

    func reviseStory(
        storyId: String,
        revisionRequest: String,
        source: String,
        operation: StoryRevisionOperation?
    ) async throws -> ContinueStoryV2Response {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "reviseStory") {
            try await apiClient.reviseStory(
                storyId: storyId,
                revisionRequest: revisionRequest,
                source: source,
                operation: operation
            )
        }
    }

    func prepareStoryReview(storyId: String) async throws -> ContinueStoryV2Response {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "prepareStoryReview") {
            try await apiClient.prepareStoryReview(storyId: storyId)
        }
    }

    func getStorySession(storyId: String) async throws -> StorySessionStateResponse {
        try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "refreshStorySession") {
            try await apiClient.getStorySession(storyId: storyId)
        }
    }

    func fetchElementGuidance(storyId: String, elementId: String) async throws -> ElementGuidance {
        try await apiClient.fetchElementGuidance(storyId: storyId, elementId: elementId)
    }

    func loadPersistedSession() -> V2Session? {
        sessionStore.load()
    }

    func savePersistedSession(_ session: V2Session) {
        sessionStore.save(session)
    }

    func clearPersistedSession() {
        sessionStore.clear()
    }
}
