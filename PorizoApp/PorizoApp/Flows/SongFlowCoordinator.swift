//
//  SongFlowCoordinator.swift
//  PorizoApp
//
//  Owns song-specific creation state after shared setup.
//

import Foundation

struct SongFlowCoordinator {
    var voiceMode: VoiceMode = .aiVoice
    var messagePrompt: String = ""
    var customSongRequest: CustomSongRequest?
    var isInstrumental: Bool = false
    var hasOwnLyrics: Bool = false
    var storyContext: StoryContext?
    var currentTrackId: String?
    var currentVersionNum: Int?
    var currentStoryId: String?
    var initialLyrics: Lyrics?
    var renderPolicyTerms: [String] = []
    var lyricsOriginState: CreateFlowState = .createMode

    var activeStoryId: String? {
        storyContext?.storyId ?? currentStoryId
    }

    mutating func resetDraftingInputs() {
        messagePrompt = ""
        customSongRequest = nil
    }

    mutating func clearAll() {
        self = SongFlowCoordinator()
    }

    func buildInitialPrompt() -> String {
        if let desc = customSongRequest?.description, !desc.isEmpty {
            return desc
        }
        if let lyrics = customSongRequest?.lyrics, !lyrics.isEmpty {
            if customSongRequest?.isInstrumental == true {
                return "Create an instrumental track with style: \(customSongRequest?.styles.joined(separator: ", ") ?? "")"
            }
            return lyrics
        }
        return ""
    }

    mutating func resume(trackId: String, versionNum: Int, storyId: String?, target: CreateFlowResumeTarget?) -> CreateFlowState {
        currentTrackId = trackId
        currentVersionNum = versionNum
        currentStoryId = storyId
        return target == .trackPlayer ? .trackPlayer : .lyricsReview
    }

    func mergedContinueState() -> CreateFlowState {
        hasOwnLyrics ? .createMode : .simpleCreate
    }

    func customCreateCancelState() -> CreateFlowState {
        .typeSelection
    }

    mutating func restoreSessionPrompt(_ prompt: String?) {
        messagePrompt = prompt ?? ""
    }

    mutating func storeCreatedTrack(
        trackId: String,
        versionNum: Int,
        storyId: String?,
        lyrics: Lyrics?,
        originState: CreateFlowState
    ) {
        currentTrackId = trackId
        currentVersionNum = versionNum
        currentStoryId = storyId
        initialLyrics = lyrics
        renderPolicyTerms = []
        lyricsOriginState = originState
    }

    mutating func storeCreatedTrackAndAdvance(
        trackId: String,
        versionNum: Int,
        storyId: String?,
        lyrics: Lyrics?,
        originState: CreateFlowState
    ) -> CreateFlowState {
        storeCreatedTrack(
            trackId: trackId,
            versionNum: versionNum,
            storyId: storyId,
            lyrics: lyrics,
            originState: originState
        )
        return .lyricsReview
    }

    mutating func storeStoryCompletion(context: StoryContext) -> CreateFlowState {
        storyContext = context
        currentStoryId = context.storyId
        return .creatingTrack
    }

    func makeResumeState(flowState: CreateFlowState) -> CreateFlowResumeState? {
        guard let trackId = currentTrackId, let versionNum = currentVersionNum else {
            return nil
        }
        return CreateFlowResumeState(
            kind: .song,
            step: flowState,
            storyId: activeStoryId,
            trackId: trackId,
            versionNum: versionNum,
            updatedAt: Date()
        )
    }

    func lyricsApprovalState(for kind: CreateFlowKind?) -> CreateFlowState {
        kind == .song ? .voice : .trackPlayer
    }

    func cancelTrackCreationState() -> CreateFlowState {
        .storyConversation
    }

    func voiceSelectionBackState() -> CreateFlowState {
        .lyricsReview
    }

    func voiceSelectionCompleteState() -> CreateFlowState {
        .trackPlayer
    }

    func applyVoiceSelection(using asyncService: CreateFlowAsyncService) async -> CreateFlowState {
        if let trackId = currentTrackId {
            do {
                try await asyncService.updateVoiceMode(trackId: trackId, mode: voiceMode)
                print("[CreateFlowView] Updated track voice_mode to \(voiceMode.rawValue)")
            } catch {
                print("[CreateFlowView] Failed to update voice_mode: \(error.localizedDescription)")
            }
        }
        return voiceSelectionCompleteState()
    }

    mutating func prepareLyricsEdit(terms: [String]) -> CreateFlowState {
        renderPolicyTerms = terms
        initialLyrics = nil
        return .lyricsReview
    }

    mutating func approveLyrics(for kind: CreateFlowKind?) -> CreateFlowState {
        renderPolicyTerms = []
        return lyricsApprovalState(for: kind)
    }

    func lyricsReviewBackState() -> CreateFlowState {
        lyricsOriginState
    }

    mutating func updateCurrentVersion(_ versionNum: Int) {
        currentVersionNum = versionNum
    }
}
