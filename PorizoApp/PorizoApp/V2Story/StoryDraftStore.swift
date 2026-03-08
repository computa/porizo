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
}
