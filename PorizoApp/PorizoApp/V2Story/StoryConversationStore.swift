//
//  StoryConversationStore.swift
//  PorizoApp
//
//  Conversation and flow-facing state for the V2 story flow.
//

import Foundation

struct StoryConversationStore {
    var currentTurn: Int = 0
    var isComplete: Bool = false
    var isEditingFromReview: Bool = false
    var messages: [V2Message] = []
    var currentResponse: V2EngineResponse?
    var resumeNotice: String?
}
