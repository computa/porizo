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
    var occasion: Occasion = .birthday
    var style: MusicStyle = .pop
    var tone: PoemTone = .heartfelt

    mutating func applyPreselectedOccasion(_ occasion: Occasion?) {
        guard let occasion else { return }
        self.occasion = occasion
    }

    mutating func applySession(_ session: V2Session) {
        recipientName = session.recipientName
        occasion = Occasion(rawValue: session.occasion) ?? .birthday
        if let style = session.style, let parsedStyle = MusicStyle(rawValue: style) {
            self.style = parsedStyle
        } else {
            self.style = .pop
        }
    }

    @MainActor
    mutating func applyEngine(_ engine: V2StoryEngine) {
        recipientName = engine.recipientName
        occasion = Occasion(rawValue: engine.occasion) ?? occasion
        if let style = engine.style, let parsedStyle = MusicStyle(rawValue: style) {
            self.style = parsedStyle
        }
    }

    static func variationSource(_ poem: Poem) -> StorySetup {
        var setup = StorySetup()
        setup.recipientName = poem.recipientName
        setup.occasion = Occasion(rawValue: poem.occasion) ?? .birthday
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
