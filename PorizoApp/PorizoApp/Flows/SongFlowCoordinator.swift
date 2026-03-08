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
