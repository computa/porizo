//
//  StoryDraftSnapshot.swift
//  PorizoApp
//
//  Canonical client-side story draft snapshot derived from V2StoryEngine.
//

import Foundation

struct StoryDraftSnapshot: Sendable, Equatable {
    let storyId: String?
    let recipientName: String
    let occasion: String
    let initialPrompt: String?
    let currentTurn: Int
    let narrative: String?
    let currentNarrative: String
    let soulOfStory: String?
    let narrativeVersion: Int
    let completionScore: Int
    let readiness: StoryReadinessResponse?
    let beats: [V2Beat]
    let draftLifecycle: String
    let factInventory: [StorySessionFact]
    let openConflicts: [StoryDraftConflict]
    let revisionHistory: [StoryRevisionHistoryEntry]
    let draftDiff: StoryDraftDiff?
    let pendingRevision: StoryPendingRevision?
    let storyProvenance: StoryProvenance?
    let lastIntegrationDelta: StoryNarrativeIntegrationDelta?
    let resumeNotice: String?

    var displayNarrative: String {
        if let narrative, !narrative.isEmpty {
            return narrative
        }
        if !currentNarrative.isEmpty {
            return currentNarrative
        }
        return "You're creating a \(occasion) song for \(recipientName)."
    }

    var hasReviewableDraft: Bool {
        let trimmedNarrative = displayNarrative.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = initialPrompt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmedNarrative.count >= 160 || trimmedPrompt.count >= 160 || currentTurn >= 2
    }

    var provenanceNarrativeVersion: Int {
        storyProvenance?.narrativeVersion ?? narrativeVersion
    }

    var lifecycleLabel: String {
        draftLifecycle.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
