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

    mutating func storeStoryCompletion(storyId: String) -> CreateFlowState {
        self.storyId = storyId
        return .poemCreating
    }

    mutating func restoreResume(storyId: String) -> CreateFlowState {
        self.storyId = storyId
        return .poemCreating
    }

    mutating func storeGeneratedPoem(_ poem: Poem) -> CreateFlowState {
        currentPoem = poem
        return .poemPreview
    }

    mutating func storeGap(gaps: [StoryPoemGap], question: String?) -> CreateFlowState {
        self.gaps = gaps
        self.gapQuestion = question
        return .poemGap
    }

    mutating func clearGapAndResumeCreation() -> CreateFlowState {
        gapQuestion = nil
        gaps = []
        return .poemCreating
    }

    func submitGapDetail(detail: String, using asyncService: CreateFlowAsyncService) async -> (nextState: CreateFlowState?, errorMessage: String?) {
        guard let storyId else {
            return (nil, "Story session could not be found. Please try again.")
        }

        do {
            try await asyncService.addStoryDetail(storyId: storyId, detail: detail)
            return (.poemCreating, nil)
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    func regenerateState() -> CreateFlowState {
        .poemCreating
    }

    func makeResumeState(flowState: CreateFlowState) -> CreateFlowResumeState? {
        guard let storyId else { return nil }
        return CreateFlowResumeState(
            kind: .poem,
            step: flowState,
            storyId: storyId,
            trackId: nil,
            versionNum: nil,
            updatedAt: .now
        )
    }
}
