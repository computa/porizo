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

    @MainActor
    mutating func storeStoryCompletion(
        storyId: String,
        setup: StorySetup,
        engine: V2StoryEngine
    ) -> CreateFlowState {
        let resolvedPrompt = messagePrompt.isEmpty ? (engine.initialPrompt ?? "") : messagePrompt
        let context = StoryContext(
            storyId: storyId,
            recipientName: setup.recipientName,
            occasion: setup.occasion,
            specificMemory: resolvedPrompt,
            memoryAnswers: buildMemoryAnswers(from: engine.messages),
            specialPhrases: nil,
            whatMakesThemSpecial: engine.soulOfStory,
            style: setup.style,
            narrativeVersion: engine.narrativeVersion,
            finalNotes: engine.finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : engine.finalNotesDraft.trimmingCharacters(in: .whitespacesAndNewlines),
            storyProvenance: engine.storyProvenance
        )
        storyContext = context
        currentStoryId = storyId
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

    mutating func prepareLyricsEdit(terms: [String]) -> CreateFlowState {
        renderPolicyTerms = terms
        initialLyrics = nil
        return .lyricsReview
    }

    func buildMemoryAnswers(from messages: [V2Message]) -> [MemoryAnswer] {
        var answers: [MemoryAnswer] = []
        var currentQuestion: String?
        var questionIndex = 0

        for message in messages {
            if message.role == .ai {
                currentQuestion = message.content
            } else if message.role == .user, let question = currentQuestion {
                questionIndex += 1
                answers.append(
                    MemoryAnswer(
                        questionId: "q\(questionIndex)",
                        question: question,
                        answer: message.content
                    )
                )
                currentQuestion = nil
            }
        }

        return answers
    }
}
