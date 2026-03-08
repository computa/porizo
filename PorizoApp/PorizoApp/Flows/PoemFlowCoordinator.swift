//
//  PoemFlowCoordinator.swift
//  PorizoApp
//
//  Owns poem-specific creation state after shared setup.
//

import Foundation

struct PoemFlowCoordinator {
    var storyId: String?
    var currentPoem: Poem?
    var gaps: [StoryPoemGap] = []
    var gapQuestion: String?

    mutating func reset() {
        self = PoemFlowCoordinator()
    }
}
