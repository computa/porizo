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
    private let sessionStore = V2SessionStore.shared
    private var cancellables = Set<AnyCancellable>()

    init(apiClient: APIClient, recipientName: String = "", occasion: String = "birthday", style: String? = nil) {
        self.apiClient = apiClient
        self.session = V2Session(recipientName: recipientName, occasion: occasion, style: style)

        $session
            .dropFirst()
            .sink { [weak self] updatedSession in
                self?.sessionStore.save(updatedSession)
            }
            .store(in: &cancellables)
    }

    // MARK: - Public Methods

    /// Start a new story session with an initial prompt
    /// - Parameter initialPrompt: The user's initial memory/description
    func startSession(initialPrompt: String) async throws {
        // Prevent duplicate submissions while loading
        guard !isLoading else { return }

        isLoading = true
        error = nil

        defer { isLoading = false }

        print("[V2StoryEngine] Starting session with prompt: \(initialPrompt.prefix(50))...")
        print("[V2StoryEngine] Recipient: \(session.recipientName), Occasion: \(session.occasion)")

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "startStoryV2") { [self] in
                try await apiClient.startStoryV2(
                    initialPrompt: initialPrompt,
                    recipientName: session.recipientName,
                    occasion: session.occasion,
                    style: session.style
                )
            }

            session.initialPrompt = initialPrompt
            session.storyId = response.storyId

            // Ensure the user's seed prompt appears in the conversation
            ensureInitialPromptMessage()

            // Convert API response to engine response
            let engineResponse = convertStartResponse(response)
            session.currentResponse = engineResponse
            session.currentTurn = 1  // Always start at turn 1
            if let narrative = response.narrative, !narrative.isEmpty {
                session.storySummary = narrative
            }
            if engineResponse.action == .stop {
                session.isComplete = true
            }

            // Add AI message with suggestions
            let aiMessage = V2Message(
                role: .ai,
                content: response.question,
                action: engineResponse.action,
                suggestions: response.suggestions
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
        // Prevent duplicate submissions while loading
        guard !isLoading else { return }

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
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "continueStoryV2") { [self] in
                try await apiClient.continueStoryV2(
                    storyId: storyId,
                    answer: answer
                )
            }

            // Convert API response to engine response
            let engineResponse = convertContinueResponse(response, storyId: storyId)
            session.currentResponse = engineResponse
            session.currentTurn = response.turnCount ?? (session.currentTurn + 1)

            // Store summary if available
            if let summary = response.storySummary {
                session.storySummary = summary
            }
            if response.complete,
               (response.storySummary == nil || response.storySummary?.isEmpty == true),
               let narrative = response.narrative,
               !narrative.isEmpty {
                session.storySummary = narrative
            }
            if let soul = response.soulOfStory {
                session.soulOfStory = soul
            }

            // Add AI message with suggestions
            let aiContent = response.nextQuestion ?? response.narrative ?? ""
            let aiMessage = V2Message(
                role: .ai,
                content: aiContent,
                action: engineResponse.action,
                suggestions: response.suggestions
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
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "confirmStoryV2") { [self] in
                try await apiClient.confirmStoryV2(
                    storyId: storyId,
                    additionalNotes: additionalNotes
                )
            }

            session.isComplete = true

            return V2ConfirmResult(
                storyId: storyId,
                confirmed: response.confirmed,
                narrative: response.narrative ?? session.currentResponse?.narrative ?? "",
                soulOfStory: response.soulOfStory ?? session.soulOfStory,
                storySummary: response.storySummary ?? session.storySummary ?? response.narrative,
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

        // Prefer backend narrative if available; avoid append-style local synthesis
        let narrative = session.storySummary ?? session.currentResponse?.narrative ?? ""
        let fallbackNarrative = "Your story is evolving as you share more."

        // Create a completion response with current data
        let completionResponse = V2EngineResponse(
            sessionId: session.storyId ?? "",
            action: .stop,
            question: nil,
            confirmation: "Your story is ready!",
            narrative: narrative.isEmpty ? fallbackNarrative : narrative,
            completionScore: max(session.currentResponse?.completionScore ?? 0, 50), // At least 50% if finishing early
            beats: currentBeats,
            userModel: session.currentResponse?.userModel ?? .initial,
            turnCount: session.currentTurn,
            fallback: false
        )
        session.currentResponse = completionResponse
    }

    /// Reset the engine to start a new session
    func reset() {
        session = V2Session(
            recipientName: session.recipientName,
            occasion: session.occasion,
            style: session.style
        )
        error = nil
        sessionStore.clear()
    }

    /// Update session basics (before starting)
    func updateBasics(recipientName: String, occasion: String, style: String?) {
        session.recipientName = recipientName
        session.occasion = occasion
        session.style = style
    }

    /// Restore a locally persisted session (used for resume)
    func restoreSession(_ persisted: V2Session) {
        session = persisted
        ensureInitialPromptMessage()
    }

    /// Refresh session state from the server (authoritative)
    func refreshSessionFromServer() async throws {
        guard let storyId = session.storyId else { return }
        let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "refreshStorySession") { [self] in
            try await apiClient.getStorySession(storyId: storyId)
        }

        session.recipientName = response.recipientName ?? session.recipientName
        session.occasion = response.occasion ?? session.occasion
        session.initialPrompt = response.initialPrompt ?? session.initialPrompt
        session.storySummary = response.narrative ?? session.storySummary
        session.currentTurn = response.turnCount ?? session.currentTurn
        session.isComplete = response.status == "confirmed" || response.status == "ready_for_confirm"

        let mappedMessages = response.conversation?.map { entry -> V2Message in
            let role: V2Message.Role = entry.role == "assistant" ? .ai : .user
            return V2Message(
                role: role,
                content: entry.content,
                action: nil
            )
        } ?? session.messages
        session.messages = mappedMessages
        ensureInitialPromptMessage()

        let beats = response.beats?.map(convertBeat) ?? session.currentResponse?.beats ?? []
        let userModel = response.userModel.map(convertUserModel) ?? session.currentResponse?.userModel ?? .initial
        let action: V2Action = response.status == "ready_for_confirm" ? .confirm : (response.status == "confirmed" ? .stop : .ask)

        let refreshed = V2EngineResponse(
            sessionId: storyId,
            action: action,
            question: response.currentQuestion,
            confirmation: nil,
            narrative: response.narrative ?? session.currentResponse?.narrative ?? "",
            completionScore: response.completionScore ?? session.currentResponse?.completionScore ?? 0,
            beats: beats,
            userModel: userModel,
            turnCount: response.turnCount ?? session.currentTurn,
            fallback: false
        )
        session.currentResponse = refreshed
    }

    // MARK: - Response Conversion

    private func convertStartResponse(_ response: StartStoryV2Response) -> V2EngineResponse {
        // Backend can return ask/confirm/stop from the first turn.
        let action: V2Action
        switch response.action?.uppercased() {
        case "CONFIRM":
            action = .confirm
        case "STOP":
            action = .stop
        default:
            action = response.complete == true ? .confirm : .ask
        }

        let question: String? = action == .ask ? response.question : nil
        let confirmation: String? = action == .ask ? nil : (response.confirmationMessage ?? response.firstQuestion)
        let narrative = response.narrative ?? "You're creating a song for \(session.recipientName)."

        return V2EngineResponse(
            sessionId: response.storyId,
            action: action,
            question: question,
            confirmation: confirmation,
            narrative: narrative,
            completionScore: response.progress ?? 0,
            beats: [],  // Backend doesn't return beats on start
            userModel: .initial,
            turnCount: 1,
            fallback: false
        )
    }

    private func ensureInitialPromptMessage() {
        guard let rawPrompt = session.initialPrompt else { return }
        let prompt = rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        let normalizedPrompt = normalizeMessage(prompt)
        let hasPrompt = session.messages.contains { message in
            guard message.role == .user else { return false }
            return normalizeMessage(message.content) == normalizedPrompt
        }
        guard !hasPrompt else { return }
        session.messages.insert(V2Message(role: .user, content: prompt), at: 0)
    }

    private func normalizeMessage(_ text: String) -> String {
        text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private func convertContinueResponse(_ response: ContinueStoryV2Response, storyId: String) -> V2EngineResponse {
        // Backend returns complete=true when ready for confirmation.
        let action: V2Action
        if response.complete {
            action = response.readyForConfirmation == true ? .confirm : .stop
        } else {
            action = .ask
        }

        // Question is the next_question when not complete
        let question: String? = response.complete ? nil : response.nextQuestion
        // Confirmation/narrative when complete
        let confirmation: String? = response.complete ? response.storySummary : nil

        return V2EngineResponse(
            sessionId: storyId,
            action: action,
            question: question,
            confirmation: confirmation,
            narrative: response.narrative ?? response.storySummary ?? session.currentResponse?.narrative ?? "",
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
        if let summary = session.storySummary, !summary.isEmpty,
           session.currentResponse?.action == .confirm || session.currentResponse?.action == .stop {
            return summary
        }
        return "Your story is evolving as you share more."
    }

    /// Current action type
    var currentAction: V2Action? {
        session.currentResponse?.action
    }
}
