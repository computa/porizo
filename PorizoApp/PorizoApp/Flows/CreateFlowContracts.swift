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
