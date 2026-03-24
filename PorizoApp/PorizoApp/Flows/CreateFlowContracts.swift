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
}

struct StorySetup: Sendable, Equatable {
    var recipientName: String = ""
    var occasion: Occasion? = nil
    var style: String? = nil
    var tone: PoemTone = .heartfelt

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
    let preselectedOccasion: Occasion?
    let preselectedType: CreateFlowKind?
    let resumeTrackId: String?
    let resumeVersionNum: Int?
    let resumeTarget: CreateFlowResumeTarget?
    let variationSourcePoem: Poem?
}

enum CreateFlowBootstrapAction {
    case resumeTrack(trackId: String, versionNum: Int, storyId: String?, target: CreateFlowResumeTarget?)
    case variationSourcePoem(StorySetup)
    case restoredStory(kind: CreateFlowKind, session: V2Session)
    case restoredPoem(storyId: String)
    case freshStart(initialSetup: StorySetup, forcedType: CreateFlowKind?)

    static func resolve(
        preselectedOccasion: Occasion?,
        preselectedType: CreateFlowKind?,
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
            return .restoredPoem(storyId: storyId)
        }

        var setup = StorySetup()
        setup.applyPreselectedOccasion(preselectedOccasion)
        return .freshStart(initialSetup: setup, forcedType: preselectedType)
    }
}
