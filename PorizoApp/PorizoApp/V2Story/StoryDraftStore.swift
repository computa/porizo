//
//  StoryDraftStore.swift
//  PorizoApp
//
//  Canonical draft state for the V2 story flow.
//

import Foundation

struct StoryDraftStore {
    var storyId: String?
    var recipientName: String
    var occasion: String
    var style: String?
    var initialPrompt: String?
    var narrative: String?
    var soulOfStory: String?
    var narrativeVersion: Int = 0
    var lastIntegrationDelta: StoryNarrativeIntegrationDelta?
    var draftLifecycle: String = "drafting"
    var localReviewDraft: String = ""
    var finalNotesDraft: String = ""
    var factInventory: [StorySessionFact] = []
    var openConflicts: [StoryDraftConflict] = []
    var revisionHistory: [StoryRevisionHistoryEntry] = []
    var draftDiff: StoryDraftDiff?
    var pendingRevision: StoryPendingRevision?
    var storyProvenance: StoryProvenance?
    var lastServerUpdatedAt: String?

    init(recipientName: String = "", occasion: String = "birthday", style: String? = nil) {
        self.recipientName = recipientName
        self.occasion = occasion
        self.style = style
    }

    mutating func updateBasics(recipientName: String, occasion: String, style: String?) {
        self.recipientName = recipientName
        self.occasion = occasion
        self.style = style
    }

    mutating func resetPreservingBasics() {
        let keepRecipient = recipientName
        let keepOccasion = occasion
        let keepStyle = style
        self = StoryDraftStore(recipientName: keepRecipient, occasion: keepOccasion, style: keepStyle)
    }

    mutating func restore(from session: V2Session) {
        recipientName = session.recipientName
        occasion = session.occasion
        style = session.style
        initialPrompt = session.initialPrompt
        storyId = session.storyId
        narrative = session.storySummary
        soulOfStory = session.soulOfStory
        narrativeVersion = session.narrativeVersion
        lastIntegrationDelta = session.lastIntegrationDelta
        draftLifecycle = session.draftLifecycle
        factInventory = session.factInventory
        openConflicts = session.openConflicts
        revisionHistory = session.revisionHistory
        draftDiff = session.draftDiff
        pendingRevision = session.pendingRevision
        storyProvenance = session.storyProvenance
        lastServerUpdatedAt = session.lastServerUpdatedAt
        localReviewDraft = session.localReviewDraft
        finalNotesDraft = session.finalNotesDraft
    }

    mutating func applyMetadata(
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

    mutating func applyNarrative(
        summary: String?,
        narrative fallbackNarrative: String?,
        soul: String?,
        preferSummary: Bool = true
    ) {
        if preferSummary, let summary, !summary.isEmpty {
            narrative = summary
        } else if let fallbackNarrative, !fallbackNarrative.isEmpty {
            narrative = fallbackNarrative
        }
        if let soul {
            soulOfStory = soul
        }
    }

    func makeSessionSnapshot(conversation: StoryConversationStore) -> V2Session {
        var session = V2Session(
            recipientName: recipientName,
            occasion: occasion,
            style: style,
            initialPrompt: initialPrompt
        )
        session.storyId = storyId
        session.currentTurn = conversation.currentTurn
        session.messages = conversation.messages
        session.currentResponse = conversation.currentResponse
        session.isComplete = conversation.isComplete
        session.storySummary = narrative
        session.soulOfStory = soulOfStory
        session.narrativeVersion = narrativeVersion
        session.lastIntegrationDelta = lastIntegrationDelta
        session.draftLifecycle = draftLifecycle
        session.factInventory = factInventory
        session.openConflicts = openConflicts
        session.revisionHistory = revisionHistory
        session.draftDiff = draftDiff
        session.pendingRevision = pendingRevision
        session.storyProvenance = storyProvenance
        session.lastServerUpdatedAt = lastServerUpdatedAt
        session.resumeNotice = conversation.resumeNotice
        session.localReviewDraft = localReviewDraft
        session.finalNotesDraft = finalNotesDraft
        session.isEditingFromReview = conversation.isEditingFromReview
        return session
    }

    func currentNarrative(
        currentResponse: V2EngineResponse?,
        completionAction: V2Action?
    ) -> String {
        if let responseNarrative = currentResponse?.narrative, !responseNarrative.isEmpty {
            return responseNarrative
        }
        if let narrative, !narrative.isEmpty,
           completionAction == .confirm || completionAction == .stop {
            return narrative
        }
        return "Your story is evolving as you share more."
    }

    func currentBeats(
        currentResponse: V2EngineResponse?,
        currentTurn: Int,
        completionScore: Int
    ) -> [V2Beat] {
        let elements = currentResponse?.storyElements ?? []
        if !elements.isEmpty {
            return elements
        }

        let readinessElements = (currentResponse?.readiness?.elementScores ?? []).map { beat in
            V2Beat(
                id: beat.id,
                name: beat.name ?? beat.id,
                displayName: beat.displayName,
                purpose: beat.purpose,
                strength: beat.strength,
                isRequired: beat.isRequired
            )
        }
        if !readinessElements.isEmpty {
            return readinessElements
        }

        let beats = currentResponse?.beats ?? []
        if beats.isEmpty {
            return V2Beat.defaultBeats(turnCount: currentTurn, completionScore: completionScore)
        }
        return beats
    }

    func makeDraftSnapshot(
        conversation: StoryConversationStore,
        currentResponse: V2EngineResponse?,
        completionScore: Int
    ) -> StoryDraftSnapshot {
        let resolvedNarrative = currentNarrative(
            currentResponse: currentResponse,
            completionAction: currentResponse?.action
        )
        return StoryDraftSnapshot(
            storyId: storyId,
            recipientName: recipientName,
            occasion: occasion,
            initialPrompt: initialPrompt,
            currentTurn: conversation.currentTurn,
            narrative: narrative,
            currentNarrative: resolvedNarrative,
            soulOfStory: soulOfStory,
            narrativeVersion: narrativeVersion,
            completionScore: completionScore,
            readiness: currentResponse?.readiness,
            beats: currentBeats(
                currentResponse: currentResponse,
                currentTurn: conversation.currentTurn,
                completionScore: completionScore
            ),
            draftLifecycle: draftLifecycle,
            factInventory: factInventory,
            openConflicts: openConflicts,
            revisionHistory: revisionHistory,
            draftDiff: draftDiff,
            pendingRevision: pendingRevision,
            storyProvenance: storyProvenance,
            lastIntegrationDelta: lastIntegrationDelta,
            resumeNotice: conversation.resumeNotice
        )
    }

    func buildStoryContext(
        style: MusicStyle,
        conversation: StoryConversationStore,
        currentResponse: V2EngineResponse?,
        completionScore: Int
    ) -> StoryContext? {
        guard let storyId else { return nil }

        let draft = makeDraftSnapshot(
            conversation: conversation,
            currentResponse: currentResponse,
            completionScore: completionScore
        )
        let resolvedPrompt = draft.initialPrompt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? (draft.initialPrompt ?? "")
            : draft.currentNarrative
        let trimmedFinalNotes = finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines)

        return StoryContext(
            storyId: storyId,
            recipientName: recipientName,
            occasion: Occasion(rawValue: occasion) ?? .birthday,
            specificMemory: resolvedPrompt,
            memoryAnswers: conversation.buildMemoryAnswers(),
            specialPhrases: nil,
            whatMakesThemSpecial: soulOfStory,
            style: style,
            narrativeVersion: narrativeVersion,
            finalNotes: trimmedFinalNotes.isEmpty ? nil : trimmedFinalNotes,
            storyProvenance: storyProvenance
        )
    }
}
