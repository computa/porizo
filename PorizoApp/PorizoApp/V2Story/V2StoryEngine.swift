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
    // -- Draft / conversation stores --
    private var draftStore: StoryDraftStore
    private var conversationStore = StoryConversationStore()

    // -- Flow state --
    var isLoading: Bool = false
    var error: String?

    // -- Infrastructure (not observed) --
    private let syncService: StorySyncService
    @ObservationIgnored private var persistTask: Task<Void, Never>?

    init(apiClient: APIClient, recipientName: String = "", occasion: String = "birthday", style: String? = nil) {
        self.syncService = StorySyncService(apiClient: apiClient)
        self.draftStore = StoryDraftStore(recipientName: recipientName, occasion: occasion, style: style)
    }

    var storyId: String? {
        get { draftStore.storyId }
        set { draftStore.storyId = newValue }
    }

    var recipientName: String {
        get { draftStore.recipientName }
        set { draftStore.recipientName = newValue }
    }

    var occasion: String {
        get { draftStore.occasion }
        set { draftStore.occasion = newValue }
    }

    var style: String? {
        get { draftStore.style }
        set { draftStore.style = newValue }
    }

    var initialPrompt: String? {
        get { draftStore.initialPrompt }
        set { draftStore.initialPrompt = newValue }
    }

    var currentTurn: Int {
        get { conversationStore.currentTurn }
        set { conversationStore.currentTurn = newValue }
    }

    var isComplete: Bool {
        get { conversationStore.isComplete }
        set { conversationStore.isComplete = newValue }
    }

    var isEditingFromReview: Bool {
        get { conversationStore.isEditingFromReview }
        set { conversationStore.isEditingFromReview = newValue }
    }

    var messages: [V2Message] {
        get { conversationStore.messages }
        set { conversationStore.messages = newValue }
    }

    var currentResponse: V2EngineResponse? {
        get { conversationStore.currentResponse }
        set { conversationStore.currentResponse = newValue }
    }

    var resumeNotice: String? {
        get { conversationStore.resumeNotice }
        set { conversationStore.resumeNotice = newValue }
    }

    var narrative: String? {
        get { draftStore.narrative }
        set { draftStore.narrative = newValue }
    }

    var soulOfStory: String? {
        get { draftStore.soulOfStory }
        set { draftStore.soulOfStory = newValue }
    }

    var narrativeVersion: Int {
        get { draftStore.narrativeVersion }
        set { draftStore.narrativeVersion = newValue }
    }

    var lastIntegrationDelta: StoryNarrativeIntegrationDelta? {
        get { draftStore.lastIntegrationDelta }
        set { draftStore.lastIntegrationDelta = newValue }
    }

    var draftLifecycle: String {
        get { draftStore.draftLifecycle }
        set { draftStore.draftLifecycle = newValue }
    }

    var localReviewDraft: String {
        get { draftStore.localReviewDraft }
        set { draftStore.localReviewDraft = newValue }
    }

    var finalNotesDraft: String {
        get { draftStore.finalNotesDraft }
        set { draftStore.finalNotesDraft = newValue }
    }

    var factInventory: [StorySessionFact] {
        get { draftStore.factInventory }
        set { draftStore.factInventory = newValue }
    }

    var openConflicts: [StoryDraftConflict] {
        get { draftStore.openConflicts }
        set { draftStore.openConflicts = newValue }
    }

    var revisionHistory: [StoryRevisionHistoryEntry] {
        get { draftStore.revisionHistory }
        set { draftStore.revisionHistory = newValue }
    }

    var draftDiff: StoryDraftDiff? {
        get { draftStore.draftDiff }
        set { draftStore.draftDiff = newValue }
    }

    var pendingRevision: StoryPendingRevision? {
        get { draftStore.pendingRevision }
        set { draftStore.pendingRevision = newValue }
    }

    var storyProvenance: StoryProvenance? {
        get { draftStore.storyProvenance }
        set { draftStore.storyProvenance = newValue }
    }

    var lastServerUpdatedAt: String? {
        get { draftStore.lastServerUpdatedAt }
        set { draftStore.lastServerUpdatedAt = newValue }
    }

    // MARK: - Persistence

    func schedulePersistence() {
        persistTask?.cancel()
        persistTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            syncService.savePersistedSession(buildSessionSnapshot())
        }
    }

    private func buildSessionSnapshot() -> V2Session {
        draftStore.makeSessionSnapshot(conversation: conversationStore)
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
            let response = try await syncService.startStory(
                initialPrompt: initialPrompt,
                recipientName: recipientName,
                occasion: occasion,
                style: style
            )

            self.initialPrompt = initialPrompt
            storyId = response.storyId

            conversationStore.ensureInitialPromptMessage(initialPrompt)

            let engineResponse = convertStartResponse(response)
            currentResponse = engineResponse
            currentTurn = 1
            draftStore.applyNarrative(
                summary: nil,
                narrative: response.narrative,
                soul: nil
            )
            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            draftStore.applyMetadata(
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

            conversationStore.appendAssistantMessage(
                content: response.question,
                action: engineResponse.action,
                suggestions: response.suggestions,
                slotGuidance: engineResponse.slotGuidance
            )
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

        conversationStore.appendUserMessage(answer)

        defer { isLoading = false }

        do {
            let response = try await syncService.continueStory(storyId: storyId, answer: answer)

            let engineResponse = convertContinueResponse(response, storyId: storyId)
            currentResponse = engineResponse
            currentTurn = response.turnCount ?? (currentTurn + 1)

            draftStore.applyNarrative(
                summary: response.storySummary,
                narrative: response.complete ? response.narrative : nil,
                soul: response.soulOfStory
            )
            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            draftStore.applyMetadata(
                draftLifecycle: response.draftLifecycle,
                factInventory: response.factInventory,
                openConflicts: response.openConflicts,
                revisionHistory: response.revisionHistory,
                draftDiff: response.draftDiff,
                pendingRevision: response.pendingRevision,
                storyProvenance: response.storyProvenance,
                updatedAt: nil
            )

            conversationStore.appendAssistantMessage(
                content: response.nextQuestion ?? response.narrative ?? "",
                action: engineResponse.action,
                suggestions: response.suggestions,
                slotGuidance: engineResponse.slotGuidance
            )

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
            conversationStore.appendAssistantMessage(
                content: prompt,
                action: .clarify
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
        Task { [syncService] in
            do {
                _ = try await syncService.prepareStoryReview(storyId: storyId)
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
            let response = try await syncService.prepareStoryReview(storyId: storyId)

            let engineResponse = convertContinueResponse(response, storyId: storyId)
            currentResponse = engineResponse
            currentTurn = response.turnCount ?? currentTurn
            isComplete = true
            isEditingFromReview = false

            draftStore.applyNarrative(
                summary: response.storySummary,
                narrative: response.narrative,
                soul: response.soulOfStory
            )

            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            draftStore.applyMetadata(
                draftLifecycle: response.draftLifecycle,
                factInventory: response.factInventory,
                openConflicts: response.openConflicts,
                revisionHistory: response.revisionHistory,
                draftDiff: response.draftDiff,
                pendingRevision: response.pendingRevision,
                storyProvenance: response.storyProvenance,
                updatedAt: nil
            )

            conversationStore.appendAssistantMessageIfNeeded(
                content: response.storySummary ?? response.narrative ?? "Your story is ready!",
                action: engineResponse.action
            )

            schedulePersistence()
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    /// Reset the engine to start a new session
    func reset() {
        draftStore.resetPreservingBasics()
        conversationStore.reset()
        error = nil
        syncService.clearPersistedSession()
    }

    /// Update session basics (before starting)
    func updateBasics(recipientName: String, occasion: String, style: String?) {
        draftStore.updateBasics(recipientName: recipientName, occasion: occasion, style: style)
        schedulePersistence()
    }

    /// Restore a locally persisted session (used for resume)
    func restoreSession(_ persisted: V2Session) {
        draftStore.restore(from: persisted)
        conversationStore.restore(from: persisted)
        conversationStore.ensureInitialPromptMessage(initialPrompt)
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
            response = try await syncService.getStorySession(storyId: storyId)
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
        draftStore.applyMetadata(
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
        resumeNotice = StoryConversationStore.buildResumeNotice(
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
        conversationStore.ensureInitialPromptMessage(initialPrompt)

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

        let userMessage = conversationStore.appendUserMessage(detail)

        defer { isLoading = false }

        do {
            let response = try await syncService.reviseStory(
                storyId: storyId,
                revisionRequest: detail,
                source: source,
                operation: operation
            )

            let engineResponse = convertContinueResponse(response, storyId: storyId)
            currentResponse = engineResponse
            currentTurn = response.turnCount ?? (currentTurn + 1)

            draftStore.applyNarrative(
                summary: response.storySummary,
                narrative: response.narrative,
                soul: response.soulOfStory
            )

            narrativeVersion = engineResponse.narrativeVersion
            lastIntegrationDelta = engineResponse.integrationDelta
            resumeNotice = nil
            draftStore.applyMetadata(
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

            conversationStore.appendAssistantMessage(
                content: response.nextQuestion ?? response.narrative ?? narrative ?? "",
                action: engineResponse.action,
                suggestions: response.suggestions,
                slotGuidance: engineResponse.slotGuidance
            )

            if !keepConfirmationVisible && (engineResponse.action == .stop || engineResponse.action == .confirm) {
                isComplete = true
            }

            schedulePersistence()
        } catch {
            self.error = error.localizedDescription
            conversationStore.removeMessage(id: userMessage.id)
            schedulePersistence()
            throw error
        }
    }

    func loadPersistedSession() -> V2Session? {
        syncService.loadPersistedSession()
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
        draftStore.makeDraftSnapshot(
            conversation: conversationStore,
            currentResponse: currentResponse,
            completionScore: completionScore
        )
    }

    var currentBeats: [V2Beat] {
        draftStore.currentBeats(
            currentResponse: currentResponse,
            currentTurn: currentTurn,
            completionScore: completionScore
        )
    }

    var currentNarrative: String {
        draftStore.currentNarrative(
            currentResponse: currentResponse,
            completionAction: currentResponse?.action
        )
    }

    var currentAction: V2Action? {
        currentResponse?.action
    }

    func buildStoryContext(style: MusicStyle) -> StoryContext? {
        draftStore.buildStoryContext(
            style: style,
            conversation: conversationStore,
            currentResponse: currentResponse,
            completionScore: completionScore
        )
    }
}
