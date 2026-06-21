//
//  CreateFlowContracts.swift
//  PorizoApp
//
//  Shared contracts for create flow launch, setup, and resume.
//

import Foundation

enum CreateFlowKind: String, Codable, Sendable {
    case song
    case poem
}

enum CreateFlowResumeTarget: String, Codable, Sendable {
    case lyricsReview
    case trackPlayer
}

enum CreateFlowState: String, Codable, Sendable {
    case typeSelection
    case createMerged
    case simpleCreate
    case voice
    case createMode
    case storyConversation
    case creatingTrack
    case lyricsReview
    case trackPlayer
    case poemCreating
    case poemGap
    case poemPreview
    // Warm Canvas redesign: new flow states
    case waitPulse
    case revealBloom
    case sharePostcard

    /// Backward-compatible decoding: unknown values fall back to .typeSelection
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = CreateFlowState(rawValue: rawValue) ?? .typeSelection
    }
}

struct StorySetup: Sendable, Equatable {
    var recipientName: String = ""
    var occasion: Occasion? = nil
    var style: String? = nil
    var tone: PoemTone = .heartfelt
    var emotionalSeed: String? = nil
    var relationshipType: String? = nil
    var recipientPhone: String? = nil
    var recipientChannel: String? = nil   // "imessage" | "whatsapp" | nil

    mutating func applyPreselectedRecipientName(_ recipientName: String?) {
        guard let recipientName else { return }
        let trimmed = recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.recipientName = trimmed
    }

    mutating func applyPreselectedOccasion(_ occasion: Occasion?) {
        guard let occasion else { return }
        self.occasion = occasion
    }

    mutating func applySession(_ session: V2Session) {
        recipientName = session.recipientName
        occasion = Occasion(rawValue: session.occasion)
        self.style = session.style
    }

    @MainActor
    mutating func applyEngine(_ engine: V2StoryEngine) {
        recipientName = engine.recipientName
        if let engineOccasion = Occasion(rawValue: engine.occasion) {
            occasion = engineOccasion
        }
        if let style = engine.style {
            self.style = style
        }
    }

    static func variationSource(_ poem: Poem) -> StorySetup {
        var setup = StorySetup()
        setup.recipientName = poem.recipientName
        setup.occasion = Occasion(rawValue: poem.occasion)
        return setup
    }
}

struct CreateFlowLaunch: Identifiable, Sendable {
    let id = UUID()
    let initialRecipientName: String?
    let preselectedOccasion: Occasion?
    let preselectedType: CreateFlowKind?
    let initialEmotionalSeed: String?
    let initialRelationshipType: String?
    let resumeTrackId: String?
    let resumeVersionNum: Int?
    let resumeTarget: CreateFlowResumeTarget?
    let variationSourcePoem: Poem?
}

enum CreateFlowBootstrapAction {
    case resumeTrack(trackId: String, versionNum: Int, storyId: String?, target: CreateFlowResumeTarget?)
    case variationSourcePoem(StorySetup)
    case restoredStory(kind: CreateFlowKind, session: V2Session)
    case restoredPoem(storyId: String, step: CreateFlowState)
    case freshStart(initialSetup: StorySetup, forcedType: CreateFlowKind?)

    static func resolve(
        initialRecipientName: String?,
        preselectedOccasion: Occasion?,
        preselectedType: CreateFlowKind?,
        initialEmotionalSeed: String?,
        initialRelationshipType: String?,
        resumeTrackId: String?,
        resumeVersionNum: Int?,
        resumeTarget: CreateFlowResumeTarget?,
        variationSourcePoem: Poem?,
        persisted: CreateFlowResumeState?,
        persistedSession: V2Session?
    ) -> CreateFlowBootstrapAction {
        if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
            return .resumeTrack(
                trackId: trackId,
                versionNum: versionNum,
                storyId: persisted?.storyId,
                target: resumeTarget
            )
        }

        if let sourcePoem = variationSourcePoem {
            return .variationSourcePoem(.variationSource(sourcePoem))
        }

        if let persisted,
           let storyId = persisted.storyId,
           let persistedSession,
           persistedSession.storyId == storyId {
            return .restoredStory(kind: persisted.kind, session: persistedSession)
        }

        if let persisted, persisted.kind == .poem, let storyId = persisted.storyId {
            return .restoredPoem(storyId: storyId, step: persisted.step)
        }

        var setup = StorySetup()
        setup.applyPreselectedRecipientName(initialRecipientName)
        setup.applyPreselectedOccasion(preselectedOccasion)
        setup.emotionalSeed = initialEmotionalSeed
        setup.relationshipType = initialRelationshipType
        return .freshStart(initialSetup: setup, forcedType: preselectedType)
    }
}
