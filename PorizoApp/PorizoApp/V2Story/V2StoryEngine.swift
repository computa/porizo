//
//  V2StoryEngine.swift
//  PorizoApp
//
//  V2 Story Engine - connects to the backend API for guided story collection.
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

    /// Finish the story early (user chooses to complete)
    func finishEarly() {
        // Mark as complete with current progress
        session.isComplete = true

        // Build narrative from conversation if not available from backend
        let narrative = session.storySummary ?? buildNarrativeFromConversation()

        // Create a completion response with current data
        let completionResponse = V2EngineResponse(
            sessionId: session.storyId ?? "",
            action: .stop,
            question: nil,
            confirmation: "Your story is ready!",
            narrative: narrative.isEmpty ? "You're creating a \(session.occasion) song for \(session.recipientName)." : narrative,
            completionScore: max(session.currentResponse?.completionScore ?? 0, 50), // At least 50% if finishing early
            beats: currentBeats,
            userModel: session.currentResponse?.userModel ?? .initial,
            turnCount: session.currentTurn,
            fallback: false
        )
        session.currentResponse = completionResponse
    }

    /// Build a narrative from conversation when backend doesn't provide one
    private func buildNarrativeFromConversation() -> String {
        // Extract user messages to build a narrative
        let userMessages = session.messages.filter { $0.role == .user }

        guard !userMessages.isEmpty else {
            return ""
        }

        // Build a simple narrative from user's shared content
        let occasion = session.occasion.isEmpty ? "celebration" : session.occasion
        let recipient = session.recipientName.isEmpty ? "someone special" : session.recipientName

        // Take key content from user messages (first 2-3 messages capture the core story)
        let keyContent = userMessages.prefix(3)
            .map { $0.content }
            .joined(separator: " ")

        // Truncate if too long but keep meaningful content
        let maxLength = 300
        let truncatedContent = keyContent.count > maxLength
            ? String(keyContent.prefix(maxLength)) + "..."
            : keyContent

        return "You're creating a \(occasion) song for \(recipient). \(truncatedContent)"
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

    /// Current beats for display (uses defaults if backend doesn't provide)
    var currentBeats: [V2Beat] {
        let beats = session.currentResponse?.beats ?? []
        if beats.isEmpty {
            return V2Beat.defaultBeats(turnCount: session.currentTurn, completionScore: completionScore)
        }
        return beats
    }

    /// Current narrative for display
    var currentNarrative: String {
        // Priority: 1) Backend narrative, 2) Story summary, 3) Built from conversation
        if let narrative = session.currentResponse?.narrative, !narrative.isEmpty {
            return narrative
        }
        if let summary = session.storySummary, !summary.isEmpty {
            return summary
        }
        return buildNarrativeFromConversation()
    }

    /// Current action type
    var currentAction: V2Action? {
        session.currentResponse?.action
    }
}
