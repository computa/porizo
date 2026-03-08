//
//  V2StoryEngine.swift
//  PorizoApp
//
//  V2 Story Engine - connects to the backend API for guided story collection.
//  Uses @Observable with flat properties for per-property SwiftUI tracking.
//

import Foundation
import SwiftUI

// MARK: - V2 Story Engine

@MainActor
@Observable
class V2StoryEngine {
    // -- Flow state --
    var storyId: String?
    var recipientName: String
    var occasion: String
    var style: String?
    var initialPrompt: String?
    var currentTurn: Int = 0
    var isComplete: Bool = false
    var isEditingFromReview: Bool = false
    var isLoading: Bool = false
    var error: String?
    var resumeNotice: String?

    // -- Transcript (hot during chat) --
    var messages: [V2Message] = []

    // -- Draft content --
    var narrative: String?
    var soulOfStory: String?
    var narrativeVersion: Int = 0
    var lastIntegrationDelta: StoryNarrativeIntegrationDelta?
    var draftLifecycle: String = "drafting"
    var currentResponse: V2EngineResponse?

    // -- Editor drafts (hottest — typing every keystroke) --
    var localReviewDraft: String = ""
    var finalNotesDraft: String = ""

    // -- Review metadata (cold — changes on API response only) --
    var factInventory: [StorySessionFact] = []
    var openConflicts: [StoryDraftConflict] = []
    var revisionHistory: [StoryRevisionHistoryEntry] = []
    var draftDiff: StoryDraftDiff?
    var pendingRevision: StoryPendingRevision?
    var storyProvenance: StoryProvenance?
    var lastServerUpdatedAt: String?

    // -- Infrastructure (not observed) --
    private let apiClient: APIClient
    private let sessionStore = V2SessionStore.shared
    @ObservationIgnored private var persistTask: Task<Void, Never>?

    init(apiClient: APIClient, recipientName: String = "", occasion: String = "birthday", style: String? = nil) {
        self.apiClient = apiClient
        self.recipientName = recipientName
        self.occasion = occasion
        self.style = style
    }

    // MARK: - Persistence

    func schedulePersistence() {
        persistTask?.cancel()
        persistTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            sessionStore.save(buildSessionSnapshot())
        }
    }

    private func buildSessionSnapshot() -> V2Session {
        var s = V2Session(recipientName: recipientName, occasion: occasion, style: style, initialPrompt: initialPrompt)
        s.storyId = storyId
        s.currentTurn = currentTurn
        s.messages = messages
        s.currentResponse = currentResponse
        s.isComplete = isComplete
        s.storySummary = narrative
        s.soulOfStory = soulOfStory
        s.narrativeVersion = narrativeVersion
        s.lastIntegrationDelta = lastIntegrationDelta
        s.draftLifecycle = draftLifecycle
        s.factInventory = factInventory
        s.openConflicts = openConflicts
        s.revisionHistory = revisionHistory
        s.draftDiff = draftDiff
        s.pendingRevision = pendingRevision
        s.storyProvenance = storyProvenance
        s.lastServerUpdatedAt = lastServerUpdatedAt
        s.resumeNotice = resumeNotice
        s.localReviewDraft = localReviewDraft
        s.finalNotesDraft = finalNotesDraft
        s.isEditingFromReview = isEditingFromReview
        return s
    }

    // MARK: - Public Methods

    /// Start a new story session with an initial prompt
    func startSession(initialPrompt: String) async throws {
        guard !isLoading else { return }

        isLoading = true
        error = nil

        defer { isLoading = false }

        print("[V2StoryEngine] Starting session with prompt: \(initialPrompt.prefix(50))...")
        print("[V2StoryEngine] Recipient: \(recipientName), Occasion: \(occasion)")

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "startStoryV2") { [self] in
                try await apiClient.startStoryV2(
                    initialPrompt: initialPrompt,
                    recipientName: recipientName,
                    occasion: occasion,
                    style: style
                )
            }

            self.initialPrompt = initialPrompt
            storyId = response.storyId

            ensureInitialPromptMessage()

            let engineResponse = convertStartResponse(response)
            currentResponse = engineResponse
            currentTurn = 1
            if let responseNarrative = response.narrative, !responseNarrative.isEmpty {
                narrative = responseNarrative
            }
            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            applyDraftMetadata(
                draftLifecycle: response.draftLifecycle,
                factInventory: response.factInventory,
                openConflicts: response.openConflicts,
                revisionHistory: response.revisionHistory,
                draftDiff: response.draftDiff,
                pendingRevision: response.pendingRevision,
                storyProvenance: response.storyProvenance,
                updatedAt: nil
            )
            if engineResponse.action == .stop || engineResponse.action == .confirm {
                isComplete = true
            }

            let aiMessage = V2Message(
                role: .ai,
                content: response.question,
                action: engineResponse.action,
                suggestions: response.suggestions,
                slotGuidance: engineResponse.slotGuidance
            )
            messages.append(aiMessage)
            print("[V2StoryEngine] Session started successfully. StoryId: \(response.storyId)")

            schedulePersistence()

        } catch {
            print("[V2StoryEngine] ERROR: \(error)")
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Submit a user answer and get the next question
    func submitAnswer(_ answer: String) async throws {
        guard !isLoading else { return }

        guard let storyId else {
            throw V2StoryEngineError.noActiveSession
        }

        guard !isComplete else {
            if isEditingFromReview {
                error = "Your story is complete. Tap 'Return to review' below."
            } else {
                error = "Your story is ready for review."
            }
            return
        }
        if isEditingFromReview {
            try await submitReviewEdit(answer, storyId: storyId)
            return
        }
        if let action = currentResponse?.action, action == .confirm || action == .stop {
            error = "Story is ready to confirm. Please review and continue from the confirmation screen."
            return
        }

        isLoading = true
        error = nil

        let userMessage = V2Message(role: .user, content: answer)
        messages.append(userMessage)

        defer { isLoading = false }

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "continueStoryV2") { [self] in
                try await apiClient.continueStoryV2(
                    storyId: storyId,
                    answer: answer
                )
            }

            let engineResponse = convertContinueResponse(response, storyId: storyId)
            currentResponse = engineResponse
            currentTurn = response.turnCount ?? (currentTurn + 1)

            if let summary = response.storySummary {
                narrative = summary
            }
            if response.complete,
               (response.storySummary == nil || response.storySummary?.isEmpty == true),
               let responseNarrative = response.narrative,
               !responseNarrative.isEmpty {
                narrative = responseNarrative
            }
            if let soul = response.soulOfStory {
                soulOfStory = soul
            }
            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            applyDraftMetadata(
                draftLifecycle: response.draftLifecycle,
                factInventory: response.factInventory,
                openConflicts: response.openConflicts,
                revisionHistory: response.revisionHistory,
                draftDiff: response.draftDiff,
                pendingRevision: response.pendingRevision,
                storyProvenance: response.storyProvenance,
                updatedAt: nil
            )

            let aiContent = response.nextQuestion ?? response.narrative ?? ""
            let aiMessage = V2Message(
                role: .ai,
                content: aiContent,
                action: engineResponse.action,
                suggestions: response.suggestions,
                slotGuidance: engineResponse.slotGuidance
            )
            messages.append(aiMessage)

            if engineResponse.action == .stop || engineResponse.action == .confirm {
                isComplete = true
            }

            schedulePersistence()

        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Re-enter the conversation from review mode using the server-backed edit path.
    func enterReviewEditMode() {
        guard let storyId else { return }

        let prompt = reviewEditPrompt()
        isComplete = false
        isEditingFromReview = true
        error = nil

        currentResponse = V2EngineResponse(
            sessionId: storyId,
            action: .clarify,
            question: prompt,
            confirmation: nil,
            narrative: narrative ?? currentResponse?.narrative ?? "",
            completionScore: currentResponse?.completionScore ?? completionScore,
            beats: currentBeats,
            userModel: currentResponse?.userModel ?? .initial,
            turnCount: currentTurn,
            fallback: false,
            slotGuidance: nil,
            readiness: currentResponse?.readiness,
            narrativeVersion: narrativeVersion,
            integrationDelta: lastIntegrationDelta,
            storyElements: currentResponse?.storyElements ?? []
        )

        let shouldAppendPrompt = messages.last?.role != .ai || messages.last?.content != prompt
        if shouldAppendPrompt {
            messages.append(
                V2Message(
                    role: .ai,
                    content: prompt,
                    action: .clarify
                )
            )
        }

        schedulePersistence()
    }

    /// Exit review-edit mode and return to the confirmation screen
    func exitReviewEditMode() {
        isComplete = true
        isEditingFromReview = false
        pendingRevision = nil
        localReviewDraft = ""
        error = nil

        guard let storyId else {
            schedulePersistence()
            return
        }

        currentResponse = V2EngineResponse(
            sessionId: storyId,
            action: .confirm,
            question: nil,
            confirmation: narrative ?? currentResponse?.narrative ?? "",
            narrative: narrative ?? currentResponse?.narrative ?? "",
            completionScore: currentResponse?.completionScore ?? completionScore,
            beats: currentBeats,
            userModel: currentResponse?.userModel ?? .initial,
            turnCount: currentTurn,
            fallback: false,
            slotGuidance: nil,
            readiness: currentResponse?.readiness,
            narrativeVersion: narrativeVersion,
            integrationDelta: lastIntegrationDelta,
            storyElements: currentResponse?.storyElements ?? []
        )

        schedulePersistence()

        // Sync server state in background so refreshSessionFromServer()
        // won't flip isComplete back to false
        Task { [apiClient] in
            do {
                _ = try await apiClient.prepareStoryReview(storyId: storyId)
            } catch {
                print("[V2StoryEngine] Background prepareStoryReview failed: \(error)")
            }
        }
    }

    /// Finish the story early (user chooses to complete)
    func finishEarly() async throws {
        guard !isLoading else { return }
        guard let storyId else {
            throw V2StoryEngineError.noActiveSession
        }

        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "prepareStoryReview") { [self] in
                try await apiClient.prepareStoryReview(storyId: storyId)
            }

            let engineResponse = convertContinueResponse(response, storyId: storyId)
            currentResponse = engineResponse
            currentTurn = response.turnCount ?? currentTurn
            isComplete = true
            isEditingFromReview = false

            if let summary = response.storySummary, !summary.isEmpty {
                narrative = summary
            } else if let responseNarrative = response.narrative, !responseNarrative.isEmpty {
                narrative = responseNarrative
            }
            if let soul = response.soulOfStory {
                soulOfStory = soul
            }

            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            applyDraftMetadata(
                draftLifecycle: response.draftLifecycle,
                factInventory: response.factInventory,
                openConflicts: response.openConflicts,
                revisionHistory: response.revisionHistory,
                draftDiff: response.draftDiff,
                pendingRevision: response.pendingRevision,
                storyProvenance: response.storyProvenance,
                updatedAt: nil
            )

            let aiContent = response.storySummary ?? response.narrative ?? "Your story is ready!"
            let shouldAppendSummary = messages.last?.role != .ai || messages.last?.content != aiContent
            if shouldAppendSummary {
                messages.append(
                    V2Message(
                        role: .ai,
                        content: aiContent,
                        action: engineResponse.action
                    )
                )
            }

            schedulePersistence()
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Reset the engine to start a new session
    func reset() {
        let keepRecipient = recipientName
        let keepOccasion = occasion
        let keepStyle = style

        storyId = nil
        initialPrompt = nil
        currentTurn = 0
        messages = []
        currentResponse = nil
        isComplete = false
        isEditingFromReview = false
        narrative = nil
        soulOfStory = nil
        narrativeVersion = 0
        lastIntegrationDelta = nil
        draftLifecycle = "drafting"
        factInventory = []
        openConflicts = []
        revisionHistory = []
        draftDiff = nil
        pendingRevision = nil
        storyProvenance = nil
        lastServerUpdatedAt = nil
        resumeNotice = nil
        localReviewDraft = ""
        finalNotesDraft = ""
        error = nil

        recipientName = keepRecipient
        occasion = keepOccasion
        style = keepStyle

        sessionStore.clear()
    }

    /// Update session basics (before starting)
    func updateBasics(recipientName: String, occasion: String, style: String?) {
        self.recipientName = recipientName
        self.occasion = occasion
        self.style = style
        schedulePersistence()
    }

    /// Restore a locally persisted session (used for resume)
    func restoreSession(_ persisted: V2Session) {
        recipientName = persisted.recipientName
        occasion = persisted.occasion
        style = persisted.style
        initialPrompt = persisted.initialPrompt
        storyId = persisted.storyId
        currentTurn = persisted.currentTurn
        messages = persisted.messages
        currentResponse = persisted.currentResponse
        isComplete = persisted.isComplete
        narrative = persisted.storySummary
        soulOfStory = persisted.soulOfStory
        narrativeVersion = persisted.narrativeVersion
        lastIntegrationDelta = persisted.lastIntegrationDelta
        draftLifecycle = persisted.draftLifecycle
        factInventory = persisted.factInventory
        openConflicts = persisted.openConflicts
        revisionHistory = persisted.revisionHistory
        draftDiff = persisted.draftDiff
        pendingRevision = persisted.pendingRevision
        storyProvenance = persisted.storyProvenance
        lastServerUpdatedAt = persisted.lastServerUpdatedAt
        resumeNotice = persisted.resumeNotice
        localReviewDraft = persisted.localReviewDraft
        finalNotesDraft = persisted.finalNotesDraft
        isEditingFromReview = persisted.isEditingFromReview
        ensureInitialPromptMessage()
    }

    /// Refresh session state from the server (authoritative)
    func refreshSessionFromServer() async throws {
        guard let storyId else { return }
        guard !isLoading else { return }

        let cachedNarrativeVersion = narrativeVersion
        let cachedUpdatedAt = lastServerUpdatedAt
        let hadLocalReviewDraft = !localReviewDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

        isLoading = true
        error = nil
        defer { isLoading = false }

        let response: StorySessionStateResponse
        do {
            response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "refreshStorySession") { [self] in
                try await apiClient.getStorySession(storyId: storyId)
            }
        } catch {
            self.error = error.localizedDescription
            throw error
        }

        recipientName = response.recipientName ?? recipientName
        occasion = response.occasion ?? occasion
        initialPrompt = response.initialPrompt ?? initialPrompt
        narrative = response.narrative ?? narrative
        currentTurn = response.turnCount ?? currentTurn
        // If we just exited review-edit mode locally, don't let a stale server
        // status flip isComplete back to false before the background sync lands.
        let serverComplete = response.status == "confirmed" || response.status == "ready_for_confirm"
        if !isComplete || serverComplete {
            isComplete = serverComplete
        }
        narrativeVersion = response.narrativeVersion ?? narrativeVersion
        lastIntegrationDelta = response.integrationDelta ?? lastIntegrationDelta
        applyDraftMetadata(
            draftLifecycle: response.draftLifecycle,
            factInventory: response.facts,
            openConflicts: response.openConflicts,
            revisionHistory: response.revisionHistory,
            draftDiff: response.draftDiff,
            pendingRevision: response.pendingRevision,
            storyProvenance: response.storyProvenance,
            updatedAt: response.updatedAt
        )
        isEditingFromReview = false
        resumeNotice = buildResumeNotice(
            cachedNarrativeVersion: cachedNarrativeVersion,
            serverNarrativeVersion: response.narrativeVersion,
            cachedUpdatedAt: cachedUpdatedAt,
            serverUpdatedAt: response.updatedAt,
            hadLocalReviewDraft: hadLocalReviewDraft
        )

        let mappedMessages = response.conversation?.map { entry -> V2Message in
            let role: V2Message.Role = entry.role == "assistant" ? .ai : .user
            return V2Message(
                role: role,
                content: entry.content,
                action: nil
            )
        } ?? messages
        messages = mappedMessages
        ensureInitialPromptMessage()

        let beats = response.beats?.map(convertBeat) ?? currentResponse?.beats ?? []
        let userModel = response.userModel.map(convertUserModel) ?? currentResponse?.userModel ?? .initial
        let action: V2Action = response.status == "ready_for_confirm" ? .confirm : (response.status == "confirmed" ? .stop : .ask)
        let elements = (response.storyElements ?? []).map(convertBeat)

        let refreshed = V2EngineResponse(
            sessionId: storyId,
            action: action,
            question: response.currentQuestion,
            confirmation: nil,
            narrative: response.narrative ?? currentResponse?.narrative ?? "",
            completionScore: response.completionScore ?? currentResponse?.completionScore ?? 0,
            beats: beats,
            userModel: userModel,
            turnCount: response.turnCount ?? currentTurn,
            fallback: false,
            slotGuidance: nil,
            readiness: response.readiness ?? currentResponse?.readiness,
            narrativeVersion: response.narrativeVersion ?? currentResponse?.narrativeVersion ?? narrativeVersion,
            integrationDelta: response.integrationDelta ?? currentResponse?.integrationDelta ?? lastIntegrationDelta,
            storyElements: elements.isEmpty ? (currentResponse?.storyElements ?? []) : elements
        )
        currentResponse = refreshed

        schedulePersistence()
    }

    // MARK: - Response Conversion

    private func convertStartResponse(_ response: StartStoryV2Response) -> V2EngineResponse {
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
        let responseNarrative = response.narrative ?? "You're creating a song for \(recipientName)."

        return V2EngineResponse(
            sessionId: response.storyId,
            action: action,
            question: question,
            confirmation: confirmation,
            narrative: responseNarrative,
            completionScore: response.progress ?? 0,
            beats: [],
            userModel: .initial,
            turnCount: 1,
            fallback: false,
            slotGuidance: response.slotGuidance,
            readiness: response.readiness,
            narrativeVersion: response.narrativeVersion ?? 0,
            integrationDelta: response.integrationDelta,
            storyElements: (response.storyElements ?? []).map(convertBeat)
        )
    }

    private func ensureInitialPromptMessage() {
        guard let rawPrompt = initialPrompt else { return }
        let prompt = rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        let normalizedPrompt = normalizeMessage(prompt)
        let hasPrompt = messages.contains { message in
            guard message.role == .user else { return false }
            return normalizeMessage(message.content) == normalizedPrompt
        }
        guard !hasPrompt else { return }
        messages.insert(V2Message(role: .user, content: prompt), at: 0)
    }

    private func normalizeMessage(_ text: String) -> String {
        text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private func reviewEditPrompt() -> String {
        "Tell me what to change, correct, or add, and I'll update the story."
    }

    func reviseFromConfirmation(_ detail: String, operation: StoryRevisionOperation? = nil) async throws {
        guard let storyId else {
            throw V2StoryEngineError.noActiveSession
        }

        try await submitRevisionRequest(
            detail,
            storyId: storyId,
            source: "review_edit",
            operation: operation,
            keepConfirmationVisible: true
        )
    }

    private func submitReviewEdit(_ detail: String, storyId: String) async throws {
        try await submitRevisionRequest(
            detail,
            storyId: storyId,
            source: "review_edit",
            operation: nil,
            keepConfirmationVisible: false
        )
    }

    private func submitRevisionRequest(
        _ detail: String,
        storyId: String,
        source: String,
        operation: StoryRevisionOperation?,
        keepConfirmationVisible: Bool
    ) async throws {
        isLoading = true
        error = nil

        let userMessage = V2Message(role: .user, content: detail)
        messages.append(userMessage)

        defer { isLoading = false }

        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "reviseStory") { [self] in
                try await apiClient.reviseStory(
                    storyId: storyId,
                    revisionRequest: detail,
                    source: source,
                    operation: operation
                )
            }

            let engineResponse = convertContinueResponse(response, storyId: storyId)
            currentResponse = engineResponse
            currentTurn = response.turnCount ?? (currentTurn + 1)

            if let summary = response.storySummary, !summary.isEmpty {
                narrative = summary
            } else if let responseNarrative = response.narrative, !responseNarrative.isEmpty {
                narrative = responseNarrative
            }
            if let soul = response.soulOfStory {
                soulOfStory = soul
            }

            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            applyDraftMetadata(
                draftLifecycle: response.draftLifecycle,
                factInventory: response.factInventory,
                openConflicts: response.openConflicts,
                revisionHistory: response.revisionHistory,
                draftDiff: response.draftDiff,
                pendingRevision: response.pendingRevision ?? response.revisionRequest,
                storyProvenance: response.storyProvenance,
                updatedAt: nil
            )
            if keepConfirmationVisible {
                isComplete = true
                isEditingFromReview = false
            } else {
                isEditingFromReview = !(engineResponse.action == .stop || engineResponse.action == .confirm)
            }

            let aiContent = response.nextQuestion ?? response.narrative ?? narrative ?? ""
            messages.append(
                V2Message(
                    role: .ai,
                    content: aiContent,
                    action: engineResponse.action,
                    suggestions: response.suggestions,
                    slotGuidance: engineResponse.slotGuidance
                )
            )

            if !keepConfirmationVisible && (engineResponse.action == .stop || engineResponse.action == .confirm) {
                isComplete = true
            }

            schedulePersistence()
        } catch {
            self.error = error.localizedDescription
            if messages.last?.id == userMessage.id {
                messages.removeLast()
            }
            schedulePersistence()
            throw error
        }
    }

    private func convertContinueResponse(_ response: ContinueStoryV2Response, storyId: String) -> V2EngineResponse {
        let action: V2Action
        switch response.action?.uppercased() {
        case "CONFIRM":
            action = .confirm
        case "STOP":
            action = .stop
        case "CLARIFY":
            action = .clarify
        case "ASK":
            action = .ask
        default:
            if response.complete {
                action = response.readyForConfirmation == true ? .confirm : .stop
            } else {
                action = .ask
            }
        }

        let question: String? = response.complete ? nil : response.nextQuestion
        let confirmation: String? = response.complete ? response.storySummary : nil

        return V2EngineResponse(
            sessionId: storyId,
            action: action,
            question: question,
            confirmation: confirmation,
            narrative: response.narrative ?? response.storySummary ?? currentResponse?.narrative ?? "",
            completionScore: response.progress ?? 0,
            beats: [],
            userModel: .initial,
            turnCount: response.questionsAsked ?? currentTurn,
            fallback: false,
            slotGuidance: response.slotGuidance,
            readiness: response.readiness ?? currentResponse?.readiness,
            narrativeVersion: response.narrativeVersion ?? narrativeVersion,
            integrationDelta: response.integrationDelta ?? lastIntegrationDelta,
            storyElements: (response.storyElements ?? []).map(convertBeat)
        )
    }

    private func applyDraftMetadata(
        draftLifecycle newLifecycle: String?,
        factInventory newFacts: [StorySessionFact]?,
        openConflicts newConflicts: [StoryDraftConflict]?,
        revisionHistory newHistory: [StoryRevisionHistoryEntry]?,
        draftDiff newDiff: StoryDraftDiff?,
        pendingRevision newPending: StoryPendingRevision?,
        storyProvenance newProvenance: StoryProvenance?,
        updatedAt newUpdatedAt: String?
    ) {
        draftLifecycle = newLifecycle ?? draftLifecycle
        if let newFacts {
            factInventory = newFacts
        }
        if let newConflicts {
            openConflicts = newConflicts
        }
        if let newHistory {
            revisionHistory = newHistory
        }
        if let newDiff {
            draftDiff = newDiff
        }
        pendingRevision = newPending
        if let newProvenance {
            storyProvenance = newProvenance
        }
        if let newUpdatedAt {
            lastServerUpdatedAt = newUpdatedAt
        }
    }

    private func buildResumeNotice(
        cachedNarrativeVersion: Int,
        serverNarrativeVersion: Int?,
        cachedUpdatedAt: String?,
        serverUpdatedAt: String?,
        hadLocalReviewDraft: Bool
    ) -> String? {
        let serverVersion = serverNarrativeVersion ?? cachedNarrativeVersion
        if serverVersion > cachedNarrativeVersion && hadLocalReviewDraft {
            return "Server draft advanced to v\(serverVersion). Your unsent review note was restored, but check the updated draft before applying it."
        }
        if serverVersion > cachedNarrativeVersion {
            return "Server draft updated to v\(serverVersion) while you were away."
        }
        if hadLocalReviewDraft && cachedUpdatedAt != nil && serverUpdatedAt != nil && cachedUpdatedAt != serverUpdatedAt {
            return "Your unsent review note was restored, but the server draft changed. Recheck it before applying."
        }
        return hadLocalReviewDraft ? "Your unsent review note was restored." : nil
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
    var canStart: Bool {
        !recipientName.isEmpty && storyId == nil
    }

    var hasActiveSession: Bool {
        storyId != nil && !isComplete
    }

    var completionScore: Int {
        currentResponse?.completionScore ?? 0
    }

    var readiness: StoryReadinessResponse? {
        currentResponse?.readiness
    }

    var draft: StoryDraftSnapshot {
        StoryDraftSnapshot(
            storyId: storyId,
            recipientName: recipientName,
            occasion: occasion,
            initialPrompt: initialPrompt,
            currentTurn: currentTurn,
            narrative: narrative,
            currentNarrative: currentNarrative,
            soulOfStory: soulOfStory,
            narrativeVersion: narrativeVersion,
            completionScore: completionScore,
            readiness: readiness,
            beats: currentBeats,
            draftLifecycle: draftLifecycle,
            factInventory: factInventory,
            openConflicts: openConflicts,
            revisionHistory: revisionHistory,
            draftDiff: draftDiff,
            pendingRevision: pendingRevision,
            storyProvenance: storyProvenance,
            lastIntegrationDelta: lastIntegrationDelta,
            resumeNotice: resumeNotice
        )
    }

    var currentBeats: [V2Beat] {
        let elements = currentResponse?.storyElements ?? []
        if !elements.isEmpty {
            return elements
        }
        let readinessElements = (currentResponse?.readiness?.elementScores ?? []).map(convertBeat)
        if !readinessElements.isEmpty {
            return readinessElements
        }
        let beats = currentResponse?.beats ?? []
        if beats.isEmpty {
            return V2Beat.defaultBeats(turnCount: currentTurn, completionScore: completionScore)
        }
        return beats
    }

    var currentNarrative: String {
        if let responseNarrative = currentResponse?.narrative, !responseNarrative.isEmpty {
            return responseNarrative
        }
        if let narrative, !narrative.isEmpty,
           currentResponse?.action == .confirm || currentResponse?.action == .stop {
            return narrative
        }
        return "Your story is evolving as you share more."
    }

    var currentAction: V2Action? {
        currentResponse?.action
    }
}
