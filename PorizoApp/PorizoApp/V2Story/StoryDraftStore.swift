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
}
