//
//  StoryFlowCoordinator.swift
//  PorizoApp
//
//  Owns story-specific flow transitions that bridge setup, engine, and downstream flow state.
//

import Foundation

struct StoryFlowStartResult {
    let nextState: CreateFlowState
    let errorMessage: String?
}

struct StoryFlowCompletionResult {
    let nextState: CreateFlowState
    let songFlow: SongFlowCoordinator
    let poemFlow: PoemFlowCoordinator
    let errorMessage: String?
}

@MainActor
struct StoryFlowCoordinator {
    func conversationEntryState() -> CreateFlowState {
        .storyConversation
    }

    func startConversation(
        setup: StorySetup,
        songFlow: SongFlowCoordinator,
        engine: V2StoryEngine,
        asyncService: CreateFlowAsyncService
    ) async -> StoryFlowStartResult {
        do {
            try await asyncService.startStorySession(
                engine: engine,
                setup: setup,
                initialPrompt: songFlow.buildInitialPrompt()
            )
            return StoryFlowStartResult(nextState: .storyConversation, errorMessage: nil)
        } catch {
            return StoryFlowStartResult(
                nextState: .simpleCreate,
                errorMessage: error.localizedDescription
            )
        }
    }

    func completeFlow(
        selectedType: CreateFlowKind?,
        setup: StorySetup,
        songFlow: SongFlowCoordinator,
        poemFlow: PoemFlowCoordinator,
        engine: V2StoryEngine
    ) -> StoryFlowCompletionResult {
        guard let storyId = engine.storyId else {
            return StoryFlowCompletionResult(
                nextState: .storyConversation,
                songFlow: songFlow,
                poemFlow: poemFlow,
                errorMessage: "Story session could not be found. Please try again."
            )
        }

        if selectedType == .poem {
            var updatedPoemFlow = poemFlow
            let nextState = updatedPoemFlow.storeStoryCompletion(storyId: storyId)
            return StoryFlowCompletionResult(
                nextState: nextState,
                songFlow: songFlow,
                poemFlow: updatedPoemFlow,
                errorMessage: nil
            )
        }

        guard let context = engine.buildStoryContext(style: setup.style) else {
            return StoryFlowCompletionResult(
                nextState: .storyConversation,
                songFlow: songFlow,
                poemFlow: poemFlow,
                errorMessage: "Story context was not captured. Please try again."
            )
        }

        var updatedSongFlow = songFlow
        let nextState = updatedSongFlow.storeStoryCompletion(context: context)
        return StoryFlowCompletionResult(
            nextState: nextState,
            songFlow: updatedSongFlow,
            poemFlow: poemFlow,
            errorMessage: nil
        )
    }
}
