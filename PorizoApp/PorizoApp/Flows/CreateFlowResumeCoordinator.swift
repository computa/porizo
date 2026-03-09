//
//  CreateFlowResumeCoordinator.swift
//  PorizoApp
//
//  Owns create-flow resume persistence and restored-story hydration.
//

import Foundation

struct RestoredStoryFlowState {
    let kind: CreateFlowKind
    let setup: StorySetup
    let songFlow: SongFlowCoordinator
}

@MainActor
struct CreateFlowResumeCoordinator {
    private let flowStore: CreateFlowStore

    init(flowStore: CreateFlowStore = .shared) {
        self.flowStore = flowStore
    }

    func persistResumeState(
        flowState: CreateFlowState,
        selectedType: CreateFlowKind?,
        songFlow: SongFlowCoordinator,
        poemFlow: PoemFlowCoordinator,
        storyId: String?
    ) {
        switch flowState {
        case .lyricsReview, .trackPlayer, .creatingTrack:
            if let state = songFlow.makeResumeState(flowState: flowState) {
                flowStore.save(state)
            }
        case .poemCreating, .poemGap, .poemPreview:
            if let state = poemFlow.makeResumeState(flowState: flowState) {
                flowStore.save(state)
            }
        case .storyConversation:
            guard let kind = selectedType, let storyId else { return }
            flowStore.save(.storyConversation(kind: kind, storyId: storyId))
        default:
            break
        }
    }

    func restoreStorySession(
        kind: CreateFlowKind,
        session: V2Session,
        engine: V2StoryEngine
    ) -> RestoredStoryFlowState {
        var setup = StorySetup()
        setup.applySession(session)

        var songFlow = SongFlowCoordinator()
        songFlow.restoreSessionPrompt(session.initialPrompt)

        engine.restoreSession(session)

        return RestoredStoryFlowState(
            kind: kind,
            setup: setup,
            songFlow: songFlow
        )
    }

    func refreshRestoredStorySession(
        engine: V2StoryEngine,
        fallbackPrompt: String
    ) async -> (setup: StorySetup, restoredPrompt: String)? {
        do {
            try await engine.refreshSessionFromServer()
            var setup = StorySetup()
            setup.applyEngine(engine)
            return (setup, engine.initialPrompt ?? fallbackPrompt)
        } catch {
            #if DEBUG
            print("[CreateFlowView] Story session refresh failed, keeping cached session: \(error.localizedDescription)")
            #endif
            return nil
        }
    }
}
