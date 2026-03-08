//
//  CreateFlowLifecycleCoordinator.swift
//  PorizoApp
//
//  Owns create-flow lifecycle policy: reset, unwind, retry, and dismissal cleanup.
//

import Foundation

@MainActor
struct CreateFlowLifecycleCoordinator {
    private let flowStore: CreateFlowStore

    init(flowStore: CreateFlowStore = .shared) {
        self.flowStore = flowStore
    }

    func retryState(for selectedType: CreateFlowKind?) -> CreateFlowState {
        selectedType == .poem ? .poemCreating : .storyConversation
    }

    func presentError(
        _ message: String,
        errorMessage: inout String,
        showError: inout Bool
    ) {
        errorMessage = message
        showError = true
    }

    func clearError(
        errorMessage: inout String,
        showError: inout Bool
    ) {
        errorMessage = ""
        showError = false
    }

    func startFlow(
        type: CreateFlowKind,
        selectedType: inout CreateFlowKind?,
        flowState: inout CreateFlowState,
        songFlow: inout SongFlowCoordinator,
        engine: V2StoryEngine
    ) {
        selectedType = type
        resetStoryStateKeepingBasics(songFlow: &songFlow, engine: engine)
        flowState = .createMerged
    }

    func applyPreselectedType(
        _ forcedType: CreateFlowKind,
        selectedType: inout CreateFlowKind?,
        flowState: inout CreateFlowState,
        songFlow: inout SongFlowCoordinator,
        engine: V2StoryEngine
    ) {
        startFlow(
            type: forcedType,
            selectedType: &selectedType,
            flowState: &flowState,
            songFlow: &songFlow,
            engine: engine
        )
    }

    func resetStoryStateKeepingBasics(
        songFlow: inout SongFlowCoordinator,
        engine: V2StoryEngine
    ) {
        engine.reset()
        songFlow.resetDraftingInputs()
    }

    func clearStoryState(
        songFlow: inout SongFlowCoordinator,
        engine: V2StoryEngine
    ) {
        engine.reset()
        songFlow.clearAll()
    }

    func resetPoemState(poemFlow: inout PoemFlowCoordinator) {
        poemFlow.reset()
    }

    func restartAtTypeSelection(
        preselectedOccasion: Occasion?,
        flowState: inout CreateFlowState,
        selectedType: inout CreateFlowKind?,
        setup: inout StorySetup,
        songFlow: inout SongFlowCoordinator,
        poemFlow: inout PoemFlowCoordinator,
        errorMessage: inout String,
        showError: inout Bool,
        engine: V2StoryEngine
    ) {
        clearAll(
            preselectedOccasion: preselectedOccasion,
            selectedType: &selectedType,
            setup: &setup,
            songFlow: &songFlow,
            poemFlow: &poemFlow,
            errorMessage: &errorMessage,
            showError: &showError,
            engine: engine
        )
        flowState = .typeSelection
    }

    func cancelPoemFlow(
        flowState: inout CreateFlowState,
        songFlow: inout SongFlowCoordinator,
        poemFlow: inout PoemFlowCoordinator,
        errorMessage: inout String,
        showError: inout Bool,
        engine: V2StoryEngine
    ) {
        resetPoemState(poemFlow: &poemFlow)
        clearStoryState(songFlow: &songFlow, engine: engine)
        flowStore.clear()
        clearError(errorMessage: &errorMessage, showError: &showError)
        flowState = .typeSelection
    }

    func finishPoemFlow(
        songFlow: inout SongFlowCoordinator,
        poemFlow: inout PoemFlowCoordinator,
        errorMessage: inout String,
        showError: inout Bool,
        engine: V2StoryEngine
    ) {
        resetPoemState(poemFlow: &poemFlow)
        clearStoryState(songFlow: &songFlow, engine: engine)
        flowStore.clear()
        clearError(errorMessage: &errorMessage, showError: &showError)
    }

    func clearAll(
        preselectedOccasion: Occasion?,
        selectedType: inout CreateFlowKind?,
        setup: inout StorySetup,
        songFlow: inout SongFlowCoordinator,
        poemFlow: inout PoemFlowCoordinator,
        errorMessage: inout String,
        showError: inout Bool,
        engine: V2StoryEngine
    ) {
        flowStore.clear()
        clearStoryState(songFlow: &songFlow, engine: engine)
        resetPoemState(poemFlow: &poemFlow)
        selectedType = nil
        setup = StorySetup()
        setup.applyPreselectedOccasion(preselectedOccasion)
        clearError(errorMessage: &errorMessage, showError: &showError)
    }
}
