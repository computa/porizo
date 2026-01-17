//
//  V2StoryEngine.swift
//  PorizoApp
//
//  Production V2 Story Engine that connects to the real backend API.
//  Replaces V2MockEngine with actual API integration.
//

import Foundation
import SwiftUI
import Combine

// MARK: - V2 Story Engine

@MainActor
class V2StoryEngine: ObservableObject {
    @Published var session: V2Session
    @Published var isLoading: Bool = false
    @Published var error: String?

    private let apiClient: APIClient

    init(apiClient: APIClient, recipientName: String = "", occasion: String = "birthday", style: String? = nil) {
        self.apiClient = apiClient
        self.session = V2Session(recipientName: recipientName, occasion: occasion, style: style)
    }

    // MARK: - Public Methods

    /// Start a new story session with an initial prompt
    /// - Parameter initialPrompt: The user's initial memory/description
    func startSession(initialPrompt: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        print("[V2StoryEngine] Starting session with prompt: \(initialPrompt.prefix(50))...")
        print("[V2StoryEngine] Recipient: \(session.recipientName), Occasion: \(session.occasion)")

        do {
            let response = try await apiClient.startStoryV2(
                initialPrompt: initialPrompt,
                recipientName: session.recipientName,
                occasion: session.occasion,
                style: session.style
            )

            session.storyId = response.storyId

            // Convert API response to engine response
            let engineResponse = convertStartResponse(response)
            session.currentResponse = engineResponse
            session.currentTurn = 1  // Always start at turn 1

            // Add AI message
            let aiMessage = V2Message(
                role: .ai,
                content: response.question,
                action: engineResponse.action
            )
            session.messages.append(aiMessage)
            print("[V2StoryEngine] Session started successfully. StoryId: \(response.storyId)")

        } catch {
            print("[V2StoryEngine] ERROR: \(error)")
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Submit a user answer and get the next question
    /// - Parameter answer: The user's response to the current question
    func submitAnswer(_ answer: String) async throws {
        guard let storyId = session.storyId else {
            throw V2StoryEngineError.noActiveSession
        }

        guard !session.isComplete else { return }

        isLoading = true
        error = nil

        // Add user message immediately
        let userMessage = V2Message(role: .user, content: answer)
        session.messages.append(userMessage)

        defer { isLoading = false }

        do {
            let response = try await apiClient.continueStoryV2(
                storyId: storyId,
                answer: answer
            )

            // Convert API response to engine response
            let engineResponse = convertContinueResponse(response, storyId: storyId)
            session.currentResponse = engineResponse
            session.currentTurn = response.turnCount ?? (session.currentTurn + 1)

            // Store summary if available
            if let summary = response.storySummary {
                session.storySummary = summary
            }
            if let soul = response.soulOfStory {
                session.soulOfStory = soul
            }

            // Add AI message
            let aiContent = response.nextQuestion ?? response.narrative
            let aiMessage = V2Message(
                role: .ai,
                content: aiContent,
                action: engineResponse.action
            )
            session.messages.append(aiMessage)

            // Mark complete if action is STOP
            if engineResponse.action == .stop {
                session.isComplete = true
            }

        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Confirm the story and get the final result
    /// - Parameter additionalNotes: Optional additional notes from user
    /// - Returns: V2ConfirmResult with all story data
    func confirmStory(additionalNotes: String? = nil) async throws -> V2ConfirmResult {
        guard let storyId = session.storyId else {
            throw V2StoryEngineError.noActiveSession
        }

        isLoading = true
        error = nil

        defer { isLoading = false }

        do {
            let response = try await apiClient.confirmStoryV2(
                storyId: storyId,
                additionalNotes: additionalNotes
            )

            session.isComplete = true

            return V2ConfirmResult(
                storyId: storyId,
                confirmed: response.confirmed,
                narrative: response.narrative ?? session.currentResponse?.narrative ?? "",
                soulOfStory: response.soulOfStory ?? session.soulOfStory,
                storySummary: response.storySummary ?? session.storySummary,
                beats: response.beats?.map(convertBeat) ?? session.currentResponse?.beats ?? [],
                completionScore: response.completionScore ?? session.currentResponse?.completionScore ?? 0
            )

        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Reset the engine to start a new session
    func reset() {
        session = V2Session(
            recipientName: session.recipientName,
            occasion: session.occasion,
            style: session.style
        )
        error = nil
    }

    /// Update session basics (before starting)
    func updateBasics(recipientName: String, occasion: String, style: String?) {
        session.recipientName = recipientName
        session.occasion = occasion
        session.style = style
    }

    // MARK: - Response Conversion

    private func convertStartResponse(_ response: StartStoryV2Response) -> V2EngineResponse {
        // Backend returns simpler response - provide defaults for V2 engine fields
        V2EngineResponse(
            sessionId: response.storyId,
            action: .ask,  // Start response is always asking
            question: response.question,
            confirmation: nil,
            narrative: "You're creating a song for \(session.recipientName).",
            completionScore: response.progress ?? 0,
            beats: [],  // Backend doesn't return beats on start
            userModel: .initial,
            turnCount: 1,
            fallback: false
        )
    }

    private func convertContinueResponse(_ response: ContinueStoryV2Response, storyId: String) -> V2EngineResponse {
        // Backend returns simple response - derive V2 action from complete flag
        let action: V2Action = response.complete ? .stop : .ask

        // Question is the next_question when not complete
        let question: String? = response.complete ? nil : response.nextQuestion
        // Confirmation/narrative when complete
        let confirmation: String? = response.complete ? response.storySummary : nil

        return V2EngineResponse(
            sessionId: storyId,
            action: action,
            question: question,
            confirmation: confirmation,
            narrative: response.storySummary ?? "",
            completionScore: response.progress ?? 0,
            beats: [],  // Backend doesn't return beats
            userModel: .initial,
            turnCount: response.questionsAsked ?? session.currentTurn,
            fallback: false
        )
    }

    private func convertBeat(_ beat: V2BeatResponse) -> V2Beat {
        V2Beat(
            id: beat.id,
            name: beat.name ?? beat.id,
            displayName: beat.displayName,
            purpose: beat.purpose,
            strength: beat.strength,
            isRequired: beat.isRequired
        )
    }

    private func convertUserModel(_ model: V2UserModelResponse) -> V2UserModel {
        V2UserModel(
            style: V2UserModel.UserStyle(rawValue: model.style) ?? .unknown,
            fatigueSignals: model.fatigueSignals ?? 0,
            tonePreference: model.tonePreference ?? "neutral"
        )
    }
}

// MARK: - Errors

enum V2StoryEngineError: LocalizedError {
    case noActiveSession
    case sessionExpired
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .noActiveSession:
            return "No active story session. Please start a new session."
        case .sessionExpired:
            return "Your session has expired. Please start over."
        case .invalidResponse:
            return "Received an invalid response from the server."
        }
    }
}

// MARK: - Convenience Computed Properties

extension V2StoryEngine {
    /// Whether the engine is ready for the user to start
    var canStart: Bool {
        !session.recipientName.isEmpty && session.storyId == nil
    }

    /// Whether there's an active session
    var hasActiveSession: Bool {
        session.storyId != nil && !session.isComplete
    }

    /// Current completion percentage (0-100)
    var completionScore: Int {
        session.currentResponse?.completionScore ?? 0
    }

    /// Current beats for display
    var currentBeats: [V2Beat] {
        session.currentResponse?.beats ?? []
    }

    /// Current narrative for display
    var currentNarrative: String {
        session.currentResponse?.narrative ?? ""
    }

    /// Current action type
    var currentAction: V2Action? {
        session.currentResponse?.action
    }
}
